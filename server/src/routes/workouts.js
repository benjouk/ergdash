import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

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
    sort = 'date_desc', limit = '20', offset = '0',
  } = req.query;

  const conditions = ['1=1'];
  const params = [];

  if (from) { conditions.push('w.date >= ?'); params.push(from); }
  if (to) { conditions.push('w.date <= ?'); params.push(to); }
  if (type) { conditions.push('w.type = ?'); params.push(type); }
  if (tag) { conditions.push('w.inferred_tag = ?'); params.push(tag); }
  if (min_distance) { conditions.push('w.distance >= ?'); params.push(Number(min_distance)); }
  if (max_distance) { conditions.push('w.distance <= ?'); params.push(Number(max_distance)); }

  const where = conditions.join(' AND ');
  const orderBy = SORT_ALLOWLIST[sort] || 'w.date DESC';
  const lim = Math.min(100, Math.max(1, Number(limit)));
  const off = Math.max(0, Number(offset));

  const total = db.prepare(`SELECT COUNT(*) as count FROM workouts w WHERE ${where}`).get(...params).count;

  const rows = db.prepare(`
    SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score, cm.drag_delta
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);

  res.json({
    data: rows.map(formatWorkout),
    meta: { total, limit: lim, offset: off },
  });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);

  const workout = db.prepare(`
    SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score, cm.drag_delta
    FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    WHERE w.id = ?
  `).get(id);

  if (!workout) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  const intervals = db.prepare(
    'SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index'
  ).all(id);

  const strokes = db.prepare(
    'SELECT * FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
  ).all(id);

  const aiNotes = db.prepare(
    "SELECT * FROM ai_insights WHERE workout_id = ? AND type = 'session_note' ORDER BY created_at DESC LIMIT 1"
  ).get(id);

  res.json({
    ...formatWorkout(workout),
    intervals,
    strokes,
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
    inferred_tag: row.inferred_tag,
    distance: row.distance,
    time_ms: row.time_ms,
    pace_ms: row.pace_ms,
    stroke_rate: row.stroke_rate,
    stroke_count: row.stroke_count,
    calories: row.calories,
    heart_rate_avg: row.heart_rate_avg,
    heart_rate_max: row.heart_rate_max,
    drag_factor: row.drag_factor,
    comments: row.comments,
    has_stroke_data: !!row.has_stroke_data,
    metrics: {
      fade_index: row.fade_index,
      consistency: row.consistency,
      effort_score: row.effort_score,
      drag_delta: row.drag_delta,
    },
  };
}

export default router;
