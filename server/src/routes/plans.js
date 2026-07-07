import { Router } from 'express';
import { getDb } from '../db.js';
import { validateDateRange } from '../middleware/validate.js';
import { autoMatchPlan, workoutDay } from '../planMatching.js';

const router = Router();

router.use(validateDateRange);

export const PLAN_TYPES = ['steady', 'intervals', 'test', 'race', 'other'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

// "Missed" is derived, not stored, so a late sync can still complete a
// past plan.
export function adherenceOf(plan, todayStr = today()) {
  if (plan.status === 'completed') return 'completed';
  if (plan.status === 'skipped') return 'skipped';
  return plan.date < todayStr ? 'missed' : 'planned';
}

export function formatPlan(row, todayStr = today()) {
  const {
    workout_date, workout_distance, workout_time_ms, workout_pace_ms,
    ...plan
  } = row;
  return {
    ...plan,
    adherence: adherenceOf(plan, todayStr),
    workout: plan.completed_workout_id && workout_date != null
      ? {
          id: plan.completed_workout_id,
          date: workout_date,
          distance: workout_distance,
          time_ms: workout_time_ms,
          pace_ms: workout_pace_ms,
        }
      : null,
  };
}

const PLAN_SELECT = `
  SELECT p.*,
         w.date as workout_date, w.distance as workout_distance,
         w.time_ms as workout_time_ms, w.pace_ms as workout_pace_ms
  FROM planned_workouts p
  LEFT JOIN workouts w ON w.id = p.completed_workout_id
`;

function getPlan(db, id) {
  return db.prepare(`${PLAN_SELECT} WHERE p.id = ?`).get(id);
}

// Weekly planned-vs-done series for the Progress adherence chart. Only
// weeks up to today count — future plans aren't "missed" yet.
router.get('/adherence', (req, res) => {
  const db = getDb();
  const weeks = Math.min(104, Math.max(1, Number(req.query.weeks) || 12));
  const todayStr = today();
  const from = new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT strftime('%Y-W%W', p.date) as week,
           MIN(p.date) as week_start,
           COUNT(*) as planned_total,
           SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN p.status = 'skipped' THEN 1 ELSE 0 END) as skipped,
           SUM(CASE WHEN p.status = 'planned' THEN 1 ELSE 0 END) as missed,
           SUM(COALESCE(p.target_distance, 0)) as planned_meters,
           SUM(CASE WHEN p.status = 'completed' THEN COALESCE(w.distance, 0) ELSE 0 END) as actual_meters
    FROM planned_workouts p
    LEFT JOIN workouts w ON w.id = p.completed_workout_id
    WHERE p.date >= ? AND p.date < ?
    GROUP BY week
    ORDER BY week_start
  `).all(from, todayStr);

  res.json({ weeks: rows });
});

router.get('/', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  const conditions = [];
  const params = [];
  if (from) { conditions.push('p.date >= ?'); params.push(from.slice(0, 10)); }
  if (to) { conditions.push('p.date < ?'); params.push(to.slice(0, 10)); }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`${PLAN_SELECT}${where} ORDER BY p.date, p.id`).all(...params);
  const todayStr = today();
  res.json({ plans: rows.map(r => formatPlan(r, todayStr)) });
});

function validatePlanBody(body, { partial = false } = {}) {
  const errors = [];
  const fields = {};
  const has = (f) => Object.prototype.hasOwnProperty.call(body, f);

  if (has('date') || !partial) {
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
        || Number.isNaN(new Date(body.date).getTime())) {
      errors.push('date must be an ISO 8601 date (YYYY-MM-DD)');
    } else {
      fields.date = body.date;
    }
  }

  if (has('type')) {
    if (!PLAN_TYPES.includes(body.type)) {
      errors.push(`type must be one of: ${PLAN_TYPES.join(', ')}`);
    } else {
      fields.type = body.type;
    }
  }

  for (const field of ['target_distance', 'target_duration_ms', 'target_pace_ms', 'target_rate']) {
    if (!has(field)) continue;
    if (body[field] == null) {
      fields[field] = null;
    } else if (!Number.isInteger(body[field]) || body[field] <= 0) {
      errors.push(`${field} must be a positive integer or null`);
    } else {
      fields[field] = body[field];
    }
  }

  if (has('notes')) {
    if (body.notes == null || body.notes === '') {
      fields.notes = null;
    } else if (typeof body.notes !== 'string' || body.notes.length > 5000) {
      errors.push('notes must be a string of 5000 characters or fewer');
    } else {
      fields.notes = body.notes;
    }
  }

  if (has('status')) {
    // 'completed' is only reachable by linking a workout via the match
    // endpoints, so the linkage always exists when the status says so.
    if (!['planned', 'skipped'].includes(body.status)) {
      errors.push('status must be one of: planned, skipped');
    } else {
      fields.status = body.status;
    }
  }

  return { errors, fields };
}

router.post('/', (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const { errors, fields } = validatePlanBody(body);

  if (fields.date && body.target_distance == null && body.target_duration_ms == null) {
    errors.push('Provide target_distance or target_duration_ms');
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const result = db.prepare(`
    INSERT INTO planned_workouts (date, type, target_distance, target_duration_ms, target_pace_ms, target_rate, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.date,
    fields.type ?? 'steady',
    fields.target_distance ?? null,
    fields.target_duration_ms ?? null,
    fields.target_pace_ms ?? null,
    fields.target_rate ?? null,
    fields.notes ?? null
  );

  // The plan may describe a session already rowed today (or a past date) —
  // complete it immediately if an unmatched same-day workout fits.
  autoMatchPlan(result.lastInsertRowid);

  res.status(201).json(formatPlan(getPlan(db, result.lastInsertRowid)));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }

  const existing = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const { errors, fields } = validatePlanBody(req.body || {}, { partial: true });
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  // Reverting a completed plan to planned/skipped drops the workout link.
  if (fields.status && existing.status === 'completed') {
    fields.completed_workout_id = null;
    fields.match_type = null;
  }

  // Moving a completed plan to another day would carry its link to a date
  // the workout wasn't rowed on; unlink instead (autoMatchPlan below then
  // re-matches on the new date if something fits).
  if (fields.date && fields.date !== existing.date && existing.completed_workout_id) {
    const linked = db.prepare('SELECT date FROM workouts WHERE id = ?')
      .get(existing.completed_workout_id);
    if (!linked || workoutDay(linked) !== fields.date) {
      fields.completed_workout_id = null;
      fields.match_type = null;
      if (!fields.status) fields.status = 'planned';
    }
  }

  const updates = Object.keys(fields).map(f => `${f} = ?`);
  updates.push("updated_at = datetime('now')");
  db.prepare(`UPDATE planned_workouts SET ${updates.join(', ')} WHERE id = ?`)
    .run(...Object.values(fields), id);

  if (fields.date || fields.target_distance !== undefined || fields.target_duration_ms !== undefined) {
    autoMatchPlan(id);
  }

  res.json(formatPlan(getPlan(db, id)));
});

router.post('/:id/match', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const workoutId = Number(req.body?.workout_id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }
  if (!Number.isInteger(workoutId) || workoutId <= 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['workout_id must be a positive integer'],
    });
  }

  const plan = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(id);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const workout = db.prepare("SELECT id, date FROM workouts WHERE id = ? AND type = 'rower'").get(workoutId);
  if (!workout) {
    return res.status(404).json({ error: 'Workout not found' });
  }

  // Manual links follow the same rule as auto-matching: a plan can only be
  // completed by a workout rowed on its calendar day, otherwise the
  // calendar and adherence stats attribute meters to the wrong week.
  if (workoutDay(workout) !== plan.date) {
    return res.status(400).json({
      error: 'Validation failed',
      details: [`Workout is not on the plan date (${plan.date})`],
    });
  }

  const otherPlan = db.prepare(
    'SELECT id FROM planned_workouts WHERE completed_workout_id = ? AND id != ?'
  ).get(workoutId, id);
  if (otherPlan) {
    return res.status(409).json({ error: 'Workout is already linked to another plan' });
  }

  db.prepare(`
    UPDATE planned_workouts
    SET completed_workout_id = ?, status = 'completed', match_type = 'manual',
        updated_at = datetime('now')
    WHERE id = ?
  `).run(workoutId, id);

  res.json(formatPlan(getPlan(db, id)));
});

router.delete('/:id/match', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }

  const plan = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(id);
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  db.prepare(`
    UPDATE planned_workouts
    SET completed_workout_id = NULL, status = 'planned', match_type = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id);

  res.json(formatPlan(getPlan(db, id)));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid plan id' });
  }

  const result = db.prepare('DELETE FROM planned_workouts WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  res.json({ ok: true });
});

export default router;
