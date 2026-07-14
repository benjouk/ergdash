import { Router } from 'express';
import { getDb } from '../db.js';
import { enrichSingleWorkout } from '../sync.js';
import { buildWorkoutInsight } from '../insights.js';
import { parseEditedFields } from '../workoutFields.js';
import { classifyComparison, rankComparisonCandidates } from '../workoutComparison.js';
import {
  createManualWorkout,
  validateWorkoutFields,
  applyWorkoutCorrection,
  revertWorkoutToC2,
  deleteUserWorkout,
} from '../workoutMutations.js';
import {
  validateDateRange,
  validatePaginationParams,
  validateTag,
  validateDistanceRange,
  validateSearchQuery,
  validatePinnedFlag,
  escapeLikePattern,
} from '../middleware/validate.js';

const router = Router();

router.use(validateDateRange);
router.use(validatePaginationParams);
router.use(validateTag);
router.use(validateDistanceRange);
router.use(validateSearchQuery);
router.use(validatePinnedFlag);

const SORT_ALLOWLIST = {
  date_desc: 'w.date DESC',
  date_asc: 'w.date ASC',
  distance_desc: 'w.distance DESC',
  distance_asc: 'w.distance ASC',
  pace_asc: 'w.pace_ms ASC',
  pace_desc: 'w.pace_ms DESC',
  time_desc: 'w.time_ms DESC',
};

router.get('/', (req, res) => {
  const db = getDb();
  const {
    from, to, type, tag, min_distance, max_distance,
    pinned, q,
    sort = 'date_desc', limit = '20', offset = '0',
  } = req.query;

  const conditions = ['w.profile_id = ?'];
  const params = [req.profileId];

  if (from) { conditions.push('w.date >= ?'); params.push(from); }
  if (to) { conditions.push('w.date <= ?'); params.push(to); }
  if (type) { conditions.push('w.type = ?'); params.push(type); }
  if (tag) { addTagCondition(conditions, params, tag); }
  if (min_distance) { conditions.push('w.distance >= ?'); params.push(Number(min_distance)); }
  if (max_distance) { conditions.push('w.distance <= ?'); params.push(Number(max_distance)); }
  if (isPinnedQuery(pinned)) { conditions.push('w.pinned = 1'); }
  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    conditions.push("(w.notes LIKE ? ESCAPE '\\' OR w.comments LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  const where = conditions.join(' AND ');
  const orderBy = SORT_ALLOWLIST[sort] || 'w.date DESC';
  const lim = Math.min(100, Math.max(1, Number(limit)));
  const off = Math.max(0, Number(offset));

  const total = db.prepare(`SELECT COUNT(*) as count FROM workouts w WHERE ${where}`).get(...params).count;

  const totals = db.prepare(`
    SELECT COALESCE(SUM(w.distance), 0) as distance,
           COALESCE(SUM(w.time_ms), 0) as time_ms,
           AVG(NULLIF(w.pace_ms, 0)) as avg_pace_ms
    FROM workouts w WHERE ${where}
  `).get(...params);

  const rows = db.prepare(`
    SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score, cm.drag_delta,
           cm.distance_per_stroke, cm.watts_per_beat, cm.hr_drift_pct,
           cm.rate_discipline, cm.hr_recovery_avg,
           pw.id as plan_id, pw.date as plan_date, pw.type as plan_type,
           pw.target_distance as plan_target_distance,
           pw.target_duration_ms as plan_target_duration_ms,
           pw.match_type as plan_match_type,
           pw.program_id as plan_program_id,
           pw.program_week as plan_program_week,
           prog.name as plan_program_name
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    LEFT JOIN planned_workouts pw ON pw.id = (
      SELECT pw2.id FROM planned_workouts pw2
      WHERE pw2.completed_workout_id = w.id LIMIT 1
    )
    LEFT JOIN programs prog ON prog.id = pw.program_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  res.json({
    data: rows.map(row => {
      const summary = normalizeWorkoutTag(row.inferred_tag) === 'interval'
        ? computeIntervalSummary(db, row.id) : null;
      return {
        ...formatWorkout(row, summary),
        pb_distances: getCurrentPbDistances(db, row.id),
        pace_profile: getPaceProfile(db, row.id),
      };
    }),
    meta: {
      total,
      limit: lim,
      offset: off,
      totals: {
        distance: totals.distance,
        time_ms: totals.time_ms,
        avg_pace_ms: totals.avg_pace_ms ? Math.round(totals.avg_pace_ms) : null,
      },
    },
  });
});

// Create a manual workout (rows not in the Concept2 Logbook). Gets a
// negative id so it can never collide with a synced result.
router.post('/', (req, res) => {
  const db = getDb();
  const result = createManualWorkout(req.body || {}, req.profileId);
  if (result.errors) {
    return res.status(400).json({ error: 'Validation failed', details: result.errors });
  }

  const workout = getWorkoutWithMetrics(db, result.id);
  const summary = normalizeWorkoutTag(workout.inferred_tag) === 'interval'
    ? computeIntervalSummary(db, result.id) : null;
  res.status(201).json({
    ...formatWorkout(workout, summary),
    pb_distances: getCurrentPbDistances(db, result.id),
    warnings: result.warnings,
  });
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const body = req.body || {};
  const updates = [];
  const params = [];
  const errors = [];

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid workout id' });
  }

  // pinned/notes are user-owned columns on every workout; they update
  // directly and never count as corrections.
  if (Object.prototype.hasOwnProperty.call(body, 'pinned')) {
    if (typeof body.pinned !== 'boolean') {
      errors.push('pinned must be a boolean');
    } else {
      updates.push('pinned = ?');
      params.push(body.pinned ? 1 : 0);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    if (typeof body.notes !== 'string' || body.notes.length > 5000) {
      errors.push('notes must be a string of 5000 characters or fewer');
    } else {
      updates.push('notes = ?');
      params.push(body.notes);
    }
  }

  const { fields, errors: fieldErrors } = validateWorkoutFields(body);
  errors.push(...fieldErrors);

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  if (updates.length === 0 && Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  const existing = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
  if (!existing || existing.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE workouts SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
  }
  if (Object.keys(fields).length > 0) {
    // Corrections: tracked in edited_fields on c2 rows (so sync preserves
    // them) and trigger pace/PB/analytics recomputes.
    applyWorkoutCorrection(db, existing, fields);
  }

  const workout = getWorkoutWithMetrics(db, id);
  const patchSummary = normalizeWorkoutTag(workout.inferred_tag) === 'interval'
    ? computeIntervalSummary(db, id) : null;

  res.json({
    ...formatWorkout(workout, patchSummary),
    pb_distances: getCurrentPbDistances(db, id),
  });
});

// Restore Concept2 values from raw_json for the named fields (or every
// overridden field when the body names none).
router.post('/:id/revert', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid workout id' });
  }

  const fields = req.body?.fields;
  if (fields !== undefined && fields !== null
      && (!Array.isArray(fields) || fields.some(f => typeof f !== 'string'))) {
    return res.status(400).json({ error: 'fields must be an array of field names' });
  }

  const existing = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
  if (!existing || existing.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  const result = revertWorkoutToC2(db, existing, fields ?? null);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const workout = getWorkoutWithMetrics(db, id);
  const summary = normalizeWorkoutTag(workout.inferred_tag) === 'interval'
    ? computeIntervalSummary(db, id) : null;
  res.json({
    ...formatWorkout(workout, summary),
    pb_distances: getCurrentPbDistances(db, id),
    reverted_fields: result.revertedFields,
  });
});

// Delete a manual/imported workout. C2-synced rows are refused: the next
// sync would just re-create them.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid workout id' });
  }

  const existing = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
  if (!existing || existing.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  const result = deleteUserWorkout(db, existing);
  if (result.error) {
    return res.status(403).json({ error: result.error });
  }
  res.json({ ok: true });
});

router.get('/:id/comparison-candidates', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const scope = req.query.scope || 'recommended';
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid workout id' });
  if (!['recommended', 'all'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be recommended or all' });
  }

  const current = getWorkoutWithMetrics(db, id);
  if (!current || current.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  const currentIntervals = getComparisonIntervals(db, id);
  const rows = db.prepare(`
    SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score, cm.drag_delta,
           cm.distance_per_stroke, cm.watts_per_beat, cm.hr_drift_pct,
           cm.rate_discipline, cm.hr_recovery_avg
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    WHERE w.profile_id = ? AND w.type = ? AND w.id != ?
  `).all(req.profileId, current.type, id);

  let candidates = rows.map(row => {
    const intervals = getComparisonIntervals(db, row.id);
    const summary = normalizeWorkoutTag(row.inferred_tag) === 'interval'
      ? computeIntervalSummaryFromRows(intervals) : null;
    return {
      ...formatWorkout(row, summary),
      pb_distances: getCurrentPbDistances(db, row.id),
      comparison_match: classifyComparison(current, row, currentIntervals, intervals),
    };
  });
  if (scope === 'recommended') {
    candidates = candidates.filter(candidate => candidate.comparison_match.level !== 'other');
  }
  candidates = rankComparisonCandidates(current, candidates);

  const previous = candidates.find(candidate => (
    candidate.comparison_match.level === 'exact' && new Date(candidate.date) < new Date(current.date)
  ));
  const exactWithPace = candidates.filter(candidate => candidate.comparison_match.level === 'exact' && candidate.pace_ms > 0);
  const fastestPace = exactWithPace.length ? Math.min(...exactWithPace.map(candidate => candidate.pace_ms)) : null;
  candidates = candidates.map(candidate => ({
    ...candidate,
    comparison_labels: [
      candidate.id === previous?.id ? 'Previous equivalent' : null,
      fastestPace != null && candidate.pace_ms === fastestPace ? 'Fastest' : null,
      candidate.pb_distances.length > 0 ? 'PB' : null,
      candidate.pinned ? 'Pinned' : null,
      candidate.comparison_match.level === 'other' ? 'Not like-for-like' : null,
    ].filter(Boolean),
  }));

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json({
    data: candidates.slice(offset, offset + limit),
    meta: { total: candidates.length, limit, offset },
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);

  const workout = getWorkoutWithMetrics(db, id);

  if (!workout || workout.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  const intervals = db.prepare(
    'SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index'
  ).all(id);

  const strokes = db.prepare(
    'SELECT * FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
  ).all(id);

  const zoneTimes = db.prepare(
    'SELECT zone, time_s, source FROM hr_zone_time WHERE workout_id = ? ORDER BY zone'
  ).all(id);

  const recoveries = db.prepare(
    'SELECT rep_index, hr_end, hr_next_start, drop_bpm, rest_s FROM interval_recoveries WHERE workout_id = ? ORDER BY rep_index'
  ).all(id);

  const summary = normalizeWorkoutTag(workout.inferred_tag) === 'interval'
    ? computeIntervalSummaryFromRows(intervals) : null;
  const formatted = formatWorkout(workout, summary);

  res.json({
    ...formatted,
    pb_distances: getCurrentPbDistances(db, id),
    intervals,
    strokes,
    recoveries,
    zone_times: zoneTimes,
    pace_profile: getPaceProfile(db, id),
    insight: buildWorkoutInsight(formatted, getTagBaseline(db, workout), { intervals, recoveries }),
  });
});

function getComparisonIntervals(db, workoutId) {
  return db.prepare(
    'SELECT type, distance, time_ms, pace_ms, stroke_rate, heart_rate_avg, interval_index FROM intervals WHERE workout_id = ? ORDER BY interval_index'
  ).all(workoutId);
}

// Median pace/HR across the rower's other sessions of the same tag, so a
// single workout can be read relative to what's normal for them. Excludes the
// workout itself.
function getTagBaseline(db, workout) {
  const isInterval = workout.inferred_tag === 'interval';
  const tagCondition = isInterval
    ? "inferred_tag = 'interval'"
    : "(inferred_tag IS NULL OR inferred_tag != 'interval')";

  const paces = db.prepare(`
    SELECT pace_ms FROM workouts
    WHERE type = 'rower' AND pace_ms > 0 AND id != ? AND profile_id = ? AND ${tagCondition}
  `).all(workout.id, workout.profile_id).map(r => r.pace_ms);

  const hrs = db.prepare(`
    SELECT heart_rate_avg FROM workouts
    WHERE type = 'rower' AND heart_rate_avg > 0 AND id != ? AND profile_id = ? AND ${tagCondition}
  `).all(workout.id, workout.profile_id).map(r => r.heart_rate_avg);

  return { medianPaceMs: median(paces), medianHr: median(hrs) };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatWorkout(row, intervalSummary = null) {
  return {
    id: row.id,
    user_id: row.user_id,
    date: row.date,
    type: row.type,
    workout_type: row.workout_type,
    raw_workout_type: row.raw_workout_type ?? null,
    workout_type_source: row.workout_type_source ?? null,
    inferred_tag: normalizeWorkoutTag(row.inferred_tag),
    interval_summary: intervalSummary,
    distance: row.distance,
    time_ms: row.time_ms,
    pace_ms: row.pace_ms,
    stroke_rate: row.stroke_rate,
    stroke_count: row.stroke_count,
    calories: row.calories,
    heart_rate_avg: row.heart_rate_avg,
    heart_rate_max: row.heart_rate_max,
    drag_factor: row.drag_factor,
    rest_distance: row.rest_distance,
    rest_time_ms: row.rest_time_ms,
    comments: row.comments,
    pinned: !!row.pinned,
    notes: row.notes,
    source: row.source || 'c2',
    edited_fields: parseEditedFields(row.edited_fields),
    pb_distances: [],
    has_stroke_data: !!row.has_stroke_data,
    metrics: {
      fade_index: row.fade_index,
      consistency: row.consistency,
      effort_score: row.effort_score,
      drag_delta: row.drag_delta,
      distance_per_stroke: row.distance_per_stroke,
      watts_per_beat: row.watts_per_beat,
      hr_drift_pct: row.hr_drift_pct,
      rate_discipline: row.rate_discipline,
      hr_recovery_avg: row.hr_recovery_avg,
    },
    plan: row.plan_id ? {
      id: row.plan_id,
      date: row.plan_date,
      type: row.plan_type,
      target_distance: row.plan_target_distance,
      target_duration_ms: row.plan_target_duration_ms,
      match_type: row.plan_match_type,
      program_id: row.plan_program_id,
      program_week: row.plan_program_week,
      program_name: row.plan_program_name,
    } : null,
  };
}

function getCurrentPbDistances(db, workoutId) {
  return db.prepare(`
    SELECT ph.distance
    FROM pb_history ph
    WHERE ph.workout_id = ?
      AND ph.pace_ms = (
        SELECT MIN(current.pace_ms)
        FROM pb_history current
        WHERE current.distance = ph.distance AND current.tag = ph.tag
          AND current.profile_id = ph.profile_id
      )
    ORDER BY ph.distance ASC
  `).all(workoutId).map(row => row.distance);
}

function formatDistanceCompact(meters) {
  if (meters < 1000) return `${meters}m`;
  const km = meters / 1000;
  return meters % 1000 === 0 ? `${km}k` : `${km.toFixed(1).replace(/\.0$/, '')}k`;
}

function formatDurationCompact(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function intervalSummaryFromWorkRest(workIntervals, firstRestMs) {
  if (workIntervals.length < 2) return null;

  const n = workIntervals.length;
  const distances = workIntervals.map(i => i.distance).filter(d => d > 0);
  const times = workIntervals.map(i => i.time_ms).filter(t => t > 0);

  let workPart;
  if (distances.length === n && new Set(distances).size === 1) {
    workPart = formatDistanceCompact(distances[0]);
  } else if (times.length === n && new Set(times).size === 1) {
    workPart = formatDurationCompact(times[0]);
  } else {
    return `${n} reps`;
  }

  const restPart = firstRestMs > 0 ? ` / ${formatDurationCompact(firstRestMs)}r` : '';
  return `${n}×${workPart}${restPart}`;
}

function computeIntervalSummary(db, workoutId) {
  const work = db.prepare(
    "SELECT distance, time_ms FROM intervals WHERE workout_id = ? AND type = 'work' ORDER BY interval_index"
  ).all(workoutId);
  const firstRest = db.prepare(
    "SELECT time_ms FROM intervals WHERE workout_id = ? AND type = 'rest' ORDER BY interval_index LIMIT 1"
  ).get(workoutId);
  return intervalSummaryFromWorkRest(work, firstRest?.time_ms || 0);
}

function computeIntervalSummaryFromRows(intervals) {
  const work = intervals.filter(i => i.type === 'work');
  const firstRest = intervals.find(i => i.type === 'rest');
  return intervalSummaryFromWorkRest(work, firstRest?.time_ms || 0);
}

function normalizeWorkoutTag(tag) {
  return tag === 'interval' ? 'interval' : 'endurance';
}

function isPinnedQuery(pinned) {
  return ['1', 'true'].includes(String(pinned).toLowerCase());
}

function getWorkoutWithMetrics(db, id) {
  return db.prepare(`
    SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score, cm.drag_delta,
           cm.distance_per_stroke, cm.watts_per_beat, cm.hr_drift_pct,
           cm.rate_discipline, cm.hr_recovery_avg,
           pw.id as plan_id, pw.date as plan_date, pw.type as plan_type,
           pw.target_distance as plan_target_distance,
           pw.target_duration_ms as plan_target_duration_ms,
           pw.match_type as plan_match_type,
           pw.program_id as plan_program_id,
           pw.program_week as plan_program_week,
           prog.name as plan_program_name
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    LEFT JOIN planned_workouts pw ON pw.id = (
      SELECT pw2.id FROM planned_workouts pw2
      WHERE pw2.completed_workout_id = w.id LIMIT 1
    )
    LEFT JOIN programs prog ON prog.id = pw.program_id
    WHERE w.id = ?
  `).get(id);
}

function addTagCondition(conditions, params, tag) {
  const normalizedTag = normalizeWorkoutTag(tag);
  if (normalizedTag === 'interval') {
    conditions.push('w.inferred_tag = ?');
    params.push('interval');
    return;
  }

  conditions.push("(w.inferred_tag IS NULL OR w.inferred_tag != 'interval')");
}

function getPaceProfile(db, workoutId) {
  const strokes = db.prepare(`
    SELECT pace_ms FROM strokes
    WHERE workout_id = ? AND pace_ms > 0
    ORDER BY stroke_number
  `).all(workoutId).map(row => row.pace_ms);

  if (strokes.length >= 2) {
    const step = Math.max(1, Math.floor(strokes.length / 24));
    return strokes.filter((_, index) => index % step === 0).slice(0, 24);
  }

  const intervals = db.prepare(`
    SELECT pace_ms FROM intervals
    WHERE workout_id = ? AND pace_ms > 0
    ORDER BY interval_index
  `).all(workoutId).map(row => row.pace_ms);

  return intervals.length >= 2 ? intervals : [];
}


router.post('/:id/enrich', async (req, res) => {
  const id = Number(req.params.id);
  const row = getDb().prepare('SELECT source, profile_id FROM workouts WHERE id = ?').get(id);
  if (!row || row.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Workout not found' });
  }
  if (row.source !== 'c2') {
    return res.status(400).json({ error: 'Only Concept2-synced workouts can be enriched' });
  }
  try {
    const result = await enrichSingleWorkout(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
