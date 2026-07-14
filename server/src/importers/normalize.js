// The NormalizedWorkout contract every file parser emits and both the import
// preview and commit endpoints consume:
//
// {
//   date: 'YYYY-MM-DD HH:MM:SS' (local),
//   workout_type, distance (m, int), time_ms,
//   stroke_rate, stroke_count, calories, heart_rate_avg, heart_rate_max,
//   drag_factor, comments,
//   intervals: [{ type: 'work'|'rest', distance, time_ms, stroke_rate,
//                 stroke_count, calories, heart_rate_avg, heart_rate_max }],
//   samples:   [{ time_s, distance_m, pace_ms, watts, stroke_rate, heart_rate }],
//   source_meta: { format, filename, row_index, c2_log_id|null },
// }
import {
  validateWorkoutFields,
  validateIntervals,
  intervalWarnings,
  insertUserWorkout,
} from '../workoutMutations.js';
import { computePaceMs } from '../workoutFields.js';

export function pad2(n) {
  return String(n).padStart(2, '0');
}

// Format a JS Date's *local* components the way C2 stores dates.
export function formatLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function average(values) {
  const present = values.filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

// Fill summary fields a file may not carry from its per-sample data, so the
// dashboard's HR/rate columns work for imported rows too.
export function deriveSummaryFromSamples(workout) {
  const samples = workout.samples || [];
  if (samples.length === 0) return workout;

  const out = { ...workout };
  if (out.heart_rate_avg == null) {
    const avg = average(samples.map(s => s.heart_rate));
    if (avg !== null) out.heart_rate_avg = Math.round(avg);
  }
  if (out.heart_rate_max == null) {
    const max = Math.max(...samples.map(s => s.heart_rate || 0));
    if (max > 0) out.heart_rate_max = max;
  }
  if (out.stroke_rate == null) {
    const avg = average(samples.map(s => s.stroke_rate));
    if (avg !== null) out.stroke_rate = Math.round(avg * 10) / 10;
  }
  return out;
}

// Validate a NormalizedWorkout with the same rules as manual entry. Returns
// { ok, errors, warnings, fields, intervals } - fields/intervals are the
// validated shapes ready for insertUserWorkout.
export function validateNormalized(workout) {
  const { fields, errors: fieldErrors } = validateWorkoutFields(workout, { requireCore: true });
  const { intervals, errors: intervalErrors } = validateIntervals(workout);
  const errors = [...fieldErrors, ...intervalErrors];
  const warnings = errors.length === 0 ? intervalWarnings(fields, intervals) : [];

  const samples = Array.isArray(workout.samples) ? workout.samples : [];
  if (samples.length > 100000) {
    errors.push('samples cannot exceed 100,000 entries');
  }

  return { ok: errors.length === 0, errors, warnings, fields, intervals };
}

// Insert a NormalizedWorkout as a new source='import' row (negative id),
// including its samples as stroke rows. Returns the new workout id.
// Post-insert analytics are the caller's job - commits batch them.
export function insertNormalizedWorkout(db, workout, fingerprint, profileId) {
  const { ok, errors, fields, intervals } = validateNormalized(workout);
  if (!ok) throw new Error(`Invalid workout: ${errors.join('; ')}`);

  const enriched = deriveSummaryFromSamples({ ...workout, ...fields });
  const insertFields = { ...fields };
  for (const name of ['heart_rate_avg', 'heart_rate_max', 'stroke_rate']) {
    if (insertFields[name] == null && enriched[name] != null) {
      insertFields[name] = enriched[name];
    }
  }

  let id;
  db.transaction(() => {
    id = insertUserWorkout(db, {
      fields: insertFields,
      intervals,
      source: 'import',
      importFingerprint: fingerprint,
      profileId,
    });
    writeSamples(db, id, workout.samples);
  })();
  return id;
}

// Write sample rows into strokes and flag the workout accordingly. Samples
// from TCX/FIT are usually per-second, not per-stroke, but the strokes table
// is the app's generic time-series store (charts read it directly).
export function writeSamples(db, workoutId, samples) {
  if (!Array.isArray(samples) || samples.length === 0) return 0;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO strokes (
      workout_id, stroke_number, time_s, distance_m,
      pace_ms, watts, cal_hr, stroke_rate, heart_rate
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  let written = 0;
  let prev = null;
  samples.forEach((s, idx) => {
    const timeS = toFiniteNumber(s.time_s);
    const distM = toFiniteNumber(s.distance_m);
    if (timeS === null && distM === null) return;

    let paceMs = toFiniteNumber(s.pace_ms);
    if (paceMs === null && prev && timeS !== null && distM !== null) {
      const deltaD = distM - prev.distM;
      const deltaT = timeS - prev.timeS;
      if (deltaD > 0 && deltaT > 0) {
        paceMs = Math.round((deltaT / deltaD) * 500 * 1000);
      }
    }

    stmt.run(
      workoutId, idx, timeS, distM, paceMs,
      toFiniteNumber(s.watts),
      toFiniteNumber(s.stroke_rate),
      Number.isInteger(s.heart_rate) && s.heart_rate > 0 ? s.heart_rate : null,
    );
    written += 1;
    if (timeS !== null && distM !== null) prev = { timeS, distM };
  });

  if (written > 0) {
    db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = ?').run(workoutId);
  }
  return written;
}

function toFiniteNumber(value) {
  return (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

// Derive pace_ms if the summary lacks it but distance/time are known - used
// by preview display only (the DB derives its own on insert).
export function withDerivedPace(workout) {
  return { ...workout, pace_ms: computePaceMs(workout.time_ms, workout.distance) };
}
