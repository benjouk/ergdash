// Create / correct / revert / delete workouts. These are the user-driven
// counterparts to sync.js's insertWorkout: manual and imported rows are
// user-owned (source != 'c2'), while corrections to synced rows are tracked
// per-field in workouts.edited_fields so sync stops overwriting them.
import { getDb } from './db.js';
import {
  c2ColumnValues,
  writeIntervals,
  recomputeWorkoutAnalytics,
  runPostSyncAnalytics,
} from './sync.js';
import { reconcilePbDistances } from './pbDetection.js';
import { tagAllWorkouts, computeFitnessLog, computePredictions } from './analytics.js';
import {
  parseEditedFields,
  serializeEditedFields,
  computePaceMs,
} from './workoutFields.js';

export const WORKOUT_TYPES = [
  'JustRow',
  'FixedDistanceSplits',
  'FixedTimeSplits',
  'FixedCalorie',
  'FixedWattMinutes',
  'FixedDistanceInterval',
  'FixedTimeInterval',
  'FixedCalorieInterval',
  'VariableInterval',
  'VariableIntervalUndefinedRest',
  'unknown',
];

// C2 result IDs are always positive, so user-created rows live in the
// negative range and can never collide with a future sync.
export function allocateManualId(db) {
  const minId = db.prepare('SELECT COALESCE(MIN(id), 0) AS m FROM workouts WHERE id < 0').get().m;
  return minId - 1;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;

function isValidDate(value) {
  return typeof value === 'string'
    && DATE_PATTERN.test(value)
    && !Number.isNaN(new Date(value).getTime());
}

function intInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function numInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// Editable summary fields shared by POST (create) and PATCH (correct).
// Each rule returns an error string or null; nullable fields accept null.
const FIELD_RULES = {
  date: { validate: v => isValidDate(v) ? null : 'date must be YYYY-MM-DD[THH:MM:SS]', nullable: false },
  workout_type: { validate: v => WORKOUT_TYPES.includes(v) ? null : `workout_type must be one of: ${WORKOUT_TYPES.join(', ')}`, nullable: false },
  distance: { validate: v => intInRange(v, 1, 1000000) ? null : 'distance must be an integer between 1 and 1,000,000 meters', nullable: false },
  time_ms: { validate: v => intInRange(v, 1, 86400000) ? null : 'time_ms must be an integer between 1 and 86,400,000', nullable: false },
  stroke_rate: { validate: v => numInRange(v, 10, 60) ? null : 'stroke_rate must be between 10 and 60', nullable: true },
  stroke_count: { validate: v => intInRange(v, 1, 100000) ? null : 'stroke_count must be a positive integer', nullable: true },
  calories: { validate: v => intInRange(v, 0, 100000) ? null : 'calories must be a non-negative integer', nullable: true },
  heart_rate_avg: { validate: v => intInRange(v, 20, 250) ? null : 'heart_rate_avg must be an integer between 20 and 250', nullable: true },
  heart_rate_max: { validate: v => intInRange(v, 20, 250) ? null : 'heart_rate_max must be an integer between 20 and 250', nullable: true },
  drag_factor: { validate: v => intInRange(v, 60, 250) ? null : 'drag_factor must be an integer between 60 and 250', nullable: true },
  comments: { validate: v => (typeof v === 'string' && v.length <= 5000) ? null : 'comments must be a string of 5000 characters or fewer', nullable: true },
};

export const EDITABLE_FIELDS = Object.keys(FIELD_RULES);

// Validates the editable summary fields present in `body`. With
// requireCore=true (create), date/distance/time_ms must be present.
// Returns { fields, errors } — fields only contains validated values.
export function validateWorkoutFields(body, { requireCore = false } = {}) {
  const fields = {};
  const errors = [];

  for (const [name, rule] of Object.entries(FIELD_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(body, name)) continue;
    const value = body[name];
    if (value === null) {
      if (rule.nullable) fields[name] = null;
      else errors.push(`${name} cannot be null`);
      continue;
    }
    const error = rule.validate(value);
    if (error) errors.push(error);
    else fields[name] = value;
  }

  if (fields.heart_rate_avg != null && fields.heart_rate_max != null
      && fields.heart_rate_max < fields.heart_rate_avg) {
    errors.push('heart_rate_max cannot be lower than heart_rate_avg');
  }

  if (requireCore) {
    for (const name of ['date', 'distance', 'time_ms']) {
      if (fields[name] == null) errors.push(`${name} is required`);
    }
  }

  return { fields, errors };
}

// Validates an intervals array (work/rest rows for manual splits).
// Returns { intervals, errors } with intervals in writeIntervals' expected
// shape (times in tenths of seconds, matching the C2 convention).
export function validateIntervals(body) {
  const errors = [];
  if (!Object.prototype.hasOwnProperty.call(body, 'intervals')) {
    return { intervals: null, errors };
  }
  const raw = body.intervals;
  if (raw === null) return { intervals: null, errors };
  if (!Array.isArray(raw)) {
    return { intervals: null, errors: ['intervals must be an array'] };
  }
  if (raw.length > 200) {
    return { intervals: null, errors: ['intervals cannot exceed 200 entries'] };
  }

  const intervals = [];
  raw.forEach((iv, idx) => {
    const label = `intervals[${idx}]`;
    if (!iv || typeof iv !== 'object') {
      errors.push(`${label} must be an object`);
      return;
    }
    const type = iv.type === 'rest' ? 'rest' : iv.type === 'work' || iv.type == null ? 'work' : null;
    if (type === null) {
      errors.push(`${label}.type must be 'work' or 'rest'`);
      return;
    }
    const distance = iv.distance ?? 0;
    const timeMs = iv.time_ms ?? null;
    if (!Number.isInteger(distance) || distance < 0 || distance > 1000000) {
      errors.push(`${label}.distance must be a non-negative integer`);
      return;
    }
    if (timeMs !== null && !intInRange(timeMs, 1, 86400000)) {
      errors.push(`${label}.time_ms must be a positive integer`);
      return;
    }
    if (type === 'work' && distance === 0 && timeMs === null) {
      errors.push(`${label} needs a distance or time_ms`);
      return;
    }
    intervals.push({
      type,
      distance,
      time: timeMs !== null ? timeMs / 100 : null, // writeIntervals expects tenths
      stroke_rate: numInRange(iv.stroke_rate, 10, 60) ? iv.stroke_rate : null,
      stroke_count: intInRange(iv.stroke_count, 1, 100000) ? iv.stroke_count : null,
      calories_total: intInRange(iv.calories, 0, 100000) ? iv.calories : null,
      heart_rate: (intInRange(iv.heart_rate_avg, 20, 250) || intInRange(iv.heart_rate_max, 20, 250))
        ? {
          average: intInRange(iv.heart_rate_avg, 20, 250) ? iv.heart_rate_avg : null,
          max: intInRange(iv.heart_rate_max, 20, 250) ? iv.heart_rate_max : null,
        }
        : null,
    });
  });

  return { intervals, errors };
}

// Cross-checks that never reject — the athlete's file/memory wins — but are
// surfaced to the UI so obvious typos get a second look.
export function intervalWarnings(fields, intervals) {
  const warnings = [];
  if (!intervals || intervals.length === 0) return warnings;

  const work = intervals.filter(iv => iv.type === 'work');
  const workDist = work.reduce((sum, iv) => sum + (iv.distance || 0), 0);
  const workTimeMs = work.reduce((sum, iv) => sum + (iv.time ? Math.round(iv.time * 100) : 0), 0);

  if (fields.distance && workDist > 0 && Math.abs(workDist - fields.distance) > Math.max(10, fields.distance * 0.02)) {
    warnings.push(`work intervals sum to ${workDist}m but the workout distance is ${fields.distance}m`);
  }
  if (fields.time_ms && workTimeMs > 0 && Math.abs(workTimeMs - fields.time_ms) > Math.max(2000, fields.time_ms * 0.02)) {
    warnings.push(`work intervals sum to ${Math.round(workTimeMs / 1000)}s but the workout time is ${Math.round(fields.time_ms / 1000)}s`);
  }
  return warnings;
}

// Inserts a user-owned workout row (manual entry or file import commit).
// Caller is responsible for running post-insert analytics — imports batch
// many inserts into one analytics pass.
export function insertUserWorkout(db, {
  fields,
  intervals = null,
  source = 'manual',
  notes = null,
  importFingerprint = null,
  userId = null,
}) {
  const paceMs = computePaceMs(fields.time_ms, fields.distance);
  let id;
  db.transaction(() => {
    id = allocateManualId(db);
    db.prepare(`
      INSERT INTO workouts (
        id, user_id, date, timezone, type, workout_type,
        distance, time_ms, pace_ms, stroke_rate, stroke_count,
        calories, heart_rate_avg, heart_rate_max, drag_factor,
        comments, notes, source, import_fingerprint, raw_json, synced_at
      ) VALUES (?, ?, ?, NULL, 'rower', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))
    `).run(
      id, userId ?? 0, fields.date,
      fields.workout_type || 'JustRow',
      fields.distance, fields.time_ms, paceMs,
      fields.stroke_rate ?? null, fields.stroke_count ?? null,
      fields.calories ?? null, fields.heart_rate_avg ?? null, fields.heart_rate_max ?? null,
      fields.drag_factor ?? null, fields.comments ?? null, notes,
      source, importFingerprint,
    );
    if (intervals && intervals.length > 0) {
      writeIntervals(db, id, intervals);
    }
  })();
  return id;
}

// Applies a validated correction to an existing workout. Returns
// { workoutId, changedFields, perfChanged } — analytics/PB recompute happens
// here so every caller (PATCH route) gets consistent behavior.
export function applyWorkoutCorrection(db, workout, fields) {
  const changedFields = Object.keys(fields).filter(name => workout[name] !== fields[name]);
  if (changedFields.length === 0) {
    return { workoutId: workout.id, changedFields, perfChanged: false };
  }

  const effDistance = fields.distance ?? workout.distance;
  const effTimeMs = fields.time_ms ?? workout.time_ms;
  const perfChanged = changedFields.includes('distance') || changedFields.includes('time_ms');
  // date moves the workout in the fitness log; workout_type feeds tag
  // classification (and PB history is tag-partitioned), so both need the
  // full retag/reconcile pass below.
  const classificationChanged = changedFields.includes('date')
    || changedFields.includes('workout_type');
  const updates = { ...fields };
  if (perfChanged) {
    updates.pace_ms = computePaceMs(effTimeMs, effDistance);
  }

  db.transaction(() => {
    if (workout.source === 'c2') {
      // Record the override so sync stops updating these columns. pace_ms is
      // derived, and pinned/notes are already user-owned — never tracked.
      const edited = new Set(parseEditedFields(workout.edited_fields));
      changedFields.forEach(name => edited.add(name));
      updates.edited_fields = serializeEditedFields([...edited]);
    }

    const setClause = Object.keys(updates).map(name => `${name} = ?`).join(', ');
    db.prepare(`UPDATE workouts SET ${setClause} WHERE id = ?`)
      .run(...Object.values(updates), workout.id);

    if (perfChanged && workout.source === 'c2') {
      // Same semantics as sync corrections: stale per-stroke data is wiped and
      // refetched by the enrichment cron. Manual/imported strokes have no
      // upstream copy, so those are kept as-is.
      db.prepare('DELETE FROM strokes WHERE workout_id = ?').run(workout.id);
      db.prepare('UPDATE workouts SET has_stroke_data = 0 WHERE id = ?').run(workout.id);
    }
  })();

  recomputeWorkoutAnalytics(workout.id);
  if (perfChanged || classificationChanged) {
    tagAllWorkouts();
    reconcilePbDistances([workout.distance, effDistance]);
    computeFitnessLog();
    computePredictions();
  }

  return { workoutId: workout.id, changedFields, perfChanged };
}

// Restores Concept2 values from raw_json for the given fields (or all
// overridden fields when none are named) and clears their override marks.
export function revertWorkoutToC2(db, workout, fieldNames = null) {
  if (workout.source !== 'c2' || !workout.raw_json) {
    return { error: 'Only Concept2-synced workouts can be reverted' };
  }
  const edited = parseEditedFields(workout.edited_fields);
  const targets = fieldNames === null
    ? edited
    : fieldNames.filter(name => edited.includes(name));
  if (targets.length === 0) {
    return { workoutId: workout.id, revertedFields: [] };
  }

  const cols = c2ColumnValues(JSON.parse(workout.raw_json));
  const remaining = edited.filter(name => !targets.includes(name));
  const updates = {};
  for (const name of targets) {
    if (name in cols) updates[name] = cols[name];
  }

  const effDistance = 'distance' in updates ? updates.distance : workout.distance;
  const effTimeMs = 'time_ms' in updates ? updates.time_ms : workout.time_ms;
  const perfChanged = ('distance' in updates && updates.distance !== workout.distance)
    || ('time_ms' in updates && updates.time_ms !== workout.time_ms);
  if (perfChanged) {
    updates.pace_ms = computePaceMs(effTimeMs, effDistance);
  }
  updates.edited_fields = serializeEditedFields(remaining);

  db.transaction(() => {
    const setClause = Object.keys(updates).map(name => `${name} = ?`).join(', ');
    db.prepare(`UPDATE workouts SET ${setClause} WHERE id = ?`)
      .run(...Object.values(updates), workout.id);
    if (perfChanged) {
      db.prepare('DELETE FROM strokes WHERE workout_id = ?').run(workout.id);
      db.prepare('UPDATE workouts SET has_stroke_data = 0 WHERE id = ?').run(workout.id);
    }
  })();

  recomputeWorkoutAnalytics(workout.id);
  if (perfChanged || targets.includes('date') || targets.includes('workout_type')) {
    tagAllWorkouts();
    reconcilePbDistances([workout.distance, effDistance]);
    computeFitnessLog();
    computePredictions();
  }

  return { workoutId: workout.id, revertedFields: targets };
}

// Deletes a user-owned workout. C2 rows are refused — deleting them just
// makes the next sync re-create the row, so it would silently "un-delete".
export function deleteUserWorkout(db, workout) {
  if (workout.source === 'c2') {
    return { error: 'Concept2-synced workouts cannot be deleted' };
  }

  db.transaction(() => {
    // Free any plan match so the plan can match a future workout.
    db.prepare(`
      UPDATE planned_workouts
      SET completed_workout_id = NULL, status = 'planned', match_type = NULL,
          updated_at = datetime('now')
      WHERE completed_workout_id = ?
    `).run(workout.id);
    // pb_history has no ON DELETE CASCADE — clean it explicitly.
    db.prepare('DELETE FROM pb_history WHERE workout_id = ?').run(workout.id);
    db.prepare('DELETE FROM workouts WHERE id = ?').run(workout.id);
  })();

  reconcilePbDistances([workout.distance]);
  computeFitnessLog();
  computePredictions();

  return { ok: true };
}

// Full create path for POST /api/workouts: validate, insert, run the same
// post-insert analytics chain sync uses (PB detection, plan matching, etc.).
export function createManualWorkout(body, userId) {
  const { fields, errors: fieldErrors } = validateWorkoutFields(body, { requireCore: true });
  const { intervals, errors: intervalErrors } = validateIntervals(body);
  const errors = [...fieldErrors, ...intervalErrors];

  if (Object.prototype.hasOwnProperty.call(body, 'notes')
      && body.notes !== null
      && (typeof body.notes !== 'string' || body.notes.length > 5000)) {
    errors.push('notes must be a string of 5000 characters or fewer');
  }
  if (errors.length > 0) return { errors };

  const db = getDb();
  const id = insertUserWorkout(db, {
    fields,
    intervals,
    source: 'manual',
    notes: typeof body.notes === 'string' ? body.notes : null,
    userId,
  });

  runPostSyncAnalytics([id], [], []);

  return { id, warnings: intervalWarnings(fields, intervals) };
}
