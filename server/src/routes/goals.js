import { Router } from 'express';
import { getDb } from '../db.js';
import { STANDARD_PB_DISTANCES } from '../pbDetection.js';
import { GOAL_PERIODS, periodWindow, volumeProgress, performanceGap } from '../goalProgress.js';
import { isStrictDate } from '../middleware/validate.js';

const router = Router();

const MAX_LABEL_LENGTH = 100;

function getWeekStart(db, profileId) {
  const row = db.prepare("SELECT value FROM settings WHERE profile_id = ? AND key = 'week_start'").get(profileId);
  return row?.value === 'sunday' ? 'sunday' : 'monday';
}

function decorateGoal(db, goal, weekStart, now = new Date()) {
  if (goal.kind === 'volume') {
    const window = periodWindow(goal.period, now, weekStart);
    const { meters } = db.prepare(`
      SELECT COALESCE(SUM(distance), 0) as meters FROM workouts
      WHERE type = 'rower' AND profile_id = ? AND date >= ? AND date < ?
    `).get(goal.profile_id, window.from, window.to);
    return {
      ...goal,
      progress: {
        window: { from: window.from, to: window.to },
        ...volumeProgress(goal.target_meters, meters, window.elapsedFraction),
      },
    };
  }

  const pb = db.prepare(`
    SELECT id as workout_id, date, time_ms, pace_ms FROM workouts
    WHERE type = 'rower' AND profile_id = ? AND distance = ? AND pace_ms > 0
    ORDER BY pace_ms ASC LIMIT 1
  `).get(goal.profile_id, goal.distance);

  const prediction = db.prepare(
    'SELECT distance, predicted_time, confidence, window_start, window_end FROM predictions WHERE profile_id = ? AND distance = ?'
  ).get(goal.profile_id, goal.distance);

  const gap = performanceGap(goal, pb || null, prediction || null, now);

  // Stamp first achievement so the goal keeps its history even if a later
  // sync correction changes the PB.
  if (gap.achieved && !goal.achieved_at) {
    const achievedAt = new Date().toISOString();
    db.prepare('UPDATE goals SET achieved_at = ? WHERE id = ?').run(achievedAt, goal.id);
    goal = { ...goal, achieved_at: achievedAt };
  }

  return {
    ...goal,
    progress: {
      pb: pb || null,
      prediction: prediction || null,
      ...gap,
    },
  };
}

router.get('/', (req, res) => {
  const db = getDb();
  const weekStart = getWeekStart(db, req.profileId);
  const rows = db.prepare(
    'SELECT * FROM goals WHERE profile_id = ? ORDER BY active DESC, kind, period, distance, id'
  ).all(req.profileId);
  res.json({ goals: rows.map(g => decorateGoal(db, g, weekStart)) });
});

function validateGoalBody(body, kind, { partial = false } = {}) {
  const errors = [];
  const fields = {};
  const has = (f) => Object.prototype.hasOwnProperty.call(body, f);

  if (kind === 'volume') {
    if (has('period') || !partial) {
      if (!GOAL_PERIODS.includes(body.period)) {
        errors.push(`period must be one of: ${GOAL_PERIODS.join(', ')}`);
      } else {
        fields.period = body.period;
      }
    }
    if (has('target_meters') || !partial) {
      if (!Number.isInteger(body.target_meters) || body.target_meters <= 0) {
        errors.push('target_meters must be a positive integer');
      } else {
        fields.target_meters = body.target_meters;
      }
    }
  } else {
    if (has('distance') || !partial) {
      if (!STANDARD_PB_DISTANCES.includes(body.distance)) {
        errors.push(`distance must be one of: ${STANDARD_PB_DISTANCES.join(', ')}`);
      } else {
        fields.distance = body.distance;
      }
    }
    if (has('target_time_ms') || !partial) {
      if (!Number.isInteger(body.target_time_ms) || body.target_time_ms <= 0) {
        errors.push('target_time_ms must be a positive integer');
      } else {
        fields.target_time_ms = body.target_time_ms;
      }
    }
    if (has('race_date')) {
      if (body.race_date == null || body.race_date === '') {
        fields.race_date = null;
      } else if (!isStrictDate(body.race_date)) {
        errors.push('race_date must be an ISO 8601 date (YYYY-MM-DD)');
      } else {
        fields.race_date = body.race_date;
      }
    }
    if (has('label')) {
      if (body.label == null || body.label === '') {
        fields.label = null;
      } else if (typeof body.label !== 'string' || body.label.length > MAX_LABEL_LENGTH) {
        errors.push(`label must be a string of ${MAX_LABEL_LENGTH} characters or fewer`);
      } else {
        fields.label = body.label;
      }
    }
  }

  if (has('active')) {
    if (typeof body.active !== 'boolean') {
      errors.push('active must be a boolean');
    } else {
      fields.active = body.active ? 1 : 0;
    }
  }

  return { errors, fields };
}

function activeVolumeConflict(db, profileId, period, excludeId = null) {
  const row = db.prepare(`
    SELECT id FROM goals
    WHERE profile_id = ? AND kind = 'volume' AND period = ? AND active = 1 AND id != COALESCE(?, -1)
  `).get(profileId, period, excludeId);
  return !!row;
}

router.post('/', (req, res) => {
  const db = getDb();
  const body = req.body || {};

  if (!['volume', 'performance'].includes(body.kind)) {
    return res.status(400).json({
      error: 'Validation failed',
      details: ['kind must be one of: volume, performance'],
    });
  }

  const { errors, fields } = validateGoalBody(body, body.kind);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const active = fields.active ?? 1;
  if (body.kind === 'volume' && active && activeVolumeConflict(db, req.profileId, fields.period)) {
    return res.status(409).json({
      error: `An active ${fields.period} volume goal already exists`,
    });
  }

  const result = db.prepare(`
    INSERT INTO goals (profile_id, kind, period, target_meters, distance, target_time_ms, race_date, label, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.profileId,
    body.kind,
    fields.period ?? null,
    fields.target_meters ?? null,
    fields.distance ?? null,
    fields.target_time_ms ?? null,
    fields.race_date ?? null,
    fields.label ?? null,
    active
  );

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(decorateGoal(db, goal, getWeekStart(db, req.profileId)));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid goal id' });
  }

  const existing = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  if (!existing || existing.profile_id !== req.profileId) {
    return res.status(404).json({ error: 'Goal not found' });
  }

  const { errors, fields } = validateGoalBody(req.body || {}, existing.kind, { partial: true });
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  if (existing.kind === 'volume') {
    const period = fields.period ?? existing.period;
    const active = fields.active ?? existing.active;
    if (active && activeVolumeConflict(db, req.profileId, period, id)) {
      return res.status(409).json({
        error: `An active ${period} volume goal already exists`,
      });
    }
  }

  const updates = Object.keys(fields).map(f => `${f} = ?`);
  updates.push("updated_at = datetime('now')");
  db.prepare(`UPDATE goals SET ${updates.join(', ')} WHERE id = ?`)
    .run(...Object.values(fields), id);

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  res.json(decorateGoal(db, goal, getWeekStart(db, req.profileId)));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid goal id' });
  }

  const result = db.prepare('DELETE FROM goals WHERE id = ? AND profile_id = ?').run(id, req.profileId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Goal not found' });
  }
  res.json({ ok: true });
});

export default router;
