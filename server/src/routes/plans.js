import { Router } from 'express';
import { getDb } from '../db.js';
import { validateDateRange } from '../middleware/validate.js';

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

  const updates = Object.keys(fields).map(f => `${f} = ?`);
  updates.push("updated_at = datetime('now')");
  db.prepare(`UPDATE planned_workouts SET ${updates.join(', ')} WHERE id = ?`)
    .run(...Object.values(fields), id);

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
