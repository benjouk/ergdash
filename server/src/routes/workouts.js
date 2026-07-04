import { Router } from 'express';
import { getDb } from '../db.js';
import { enrichSingleWorkout } from '../sync.js';
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

  const conditions = ['1=1'];
  const params = [];

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
           cm.rate_discipline, cm.hr_recovery_avg
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  res.json({
    data: rows.map(row => ({
      ...formatWorkout(row),
      pb_distances: getCurrentPbDistances(db, row.id),
      pace_profile: getPaceProfile(db, row.id),
    })),
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

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  const exists = db.prepare('SELECT id FROM workouts WHERE id = ?').get(id);
  if (!exists) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  db.prepare(`UPDATE workouts SET ${updates.join(', ')} WHERE id = ?`).run(...params, id);
  const workout = getWorkoutWithMetrics(db, id);

  res.json({
    ...formatWorkout(workout),
    pb_distances: getCurrentPbDistances(db, id),
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);

  const workout = getWorkoutWithMetrics(db, id);

  if (!workout) {
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

  const aiNotes = db.prepare(
    "SELECT * FROM ai_insights WHERE workout_id = ? AND type = 'session_note' ORDER BY created_at DESC LIMIT 1"
  ).get(id);

  res.json({
    ...formatWorkout(workout),
    pb_distances: getCurrentPbDistances(db, id),
    intervals,
    strokes,
    recoveries,
    zone_times: zoneTimes,
    pace_profile: getPaceProfile(db, id),
    ai_note: aiNotes?.content || null,
  });
});

function formatWorkout(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    date: row.date,
    type: row.type,
    workout_type: row.workout_type,
    inferred_tag: normalizeWorkoutTag(row.inferred_tag),
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
        WHERE current.distance = ph.distance
      )
    ORDER BY ph.distance ASC
  `).all(workoutId).map(row => row.distance);
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
           cm.rate_discipline, cm.hr_recovery_avg
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
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
  try {
    const result = await enrichSingleWorkout(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
