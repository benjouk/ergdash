import { Router } from 'express';
import { getDb } from '../db.js';
import { buildWeeklyInsights } from '../insights.js';
import { computeWeekStreak } from '../analytics.js';

const router = Router();

const DAY = 86400000;

function metersBetween(db, profileId, startMs, endMs) {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  return db.prepare(`
    SELECT COALESCE(SUM(distance), 0) as meters, COUNT(*) as count
    FROM workouts WHERE type = 'rower' AND profile_id = ? AND date >= ? AND date < ?
  `).get(profileId, start, end);
}

// Average endurance pace over a rolling window (lower pace_ms is faster).
function endurancePaceBetween(db, profileId, startMs, endMs) {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const row = db.prepare(`
    SELECT AVG(pace_ms) as pace FROM workouts
    WHERE type = 'rower' AND profile_id = ? AND pace_ms > 0 AND date >= ? AND date < ?
      AND (inferred_tag IS NULL OR inferred_tag != 'interval')
  `).get(profileId, start, end);
  return row?.pace ? Math.round(row.pace) : null;
}

router.get('/weekly', (req, res) => {
  const db = getDb();
  const now = Date.now();

  const thisWeek = metersBetween(db, req.profileId, now - 7 * DAY, now);
  const prevWeek = metersBetween(db, req.profileId, now - 14 * DAY, now - 7 * DAY);

  const fitnessRows = db.prepare(
    'SELECT date, fitness, fatigue, form FROM fitness_log WHERE profile_id = ? ORDER BY date DESC LIMIT 14'
  ).all(req.profileId);
  const latest = fitnessRows[0] || null;
  const weekAgo = fitnessRows.find(r => r.date <= new Date(now - 7 * DAY).toISOString().slice(0, 10))
    || fitnessRows[fitnessRows.length - 1] || null;

  const insights = buildWeeklyInsights({
    weeklyMeters: thisWeek.meters,
    prevWeeklyMeters: prevWeek.meters,
    sessionsThisWeek: thisWeek.count,
    streakWeeks: computeWeekStreak(db, req.profileId),
    fitness: latest?.fitness ?? null,
    fatigue: latest?.fatigue ?? null,
    form: latest?.form ?? null,
    fitnessDelta7d: latest && weekAgo ? latest.fitness - weekAgo.fitness : null,
    recentEndurancePaceMs: endurancePaceBetween(db, req.profileId, now - 30 * DAY, now),
    priorEndurancePaceMs: endurancePaceBetween(db, req.profileId, now - 60 * DAY, now - 30 * DAY),
  });

  res.json({ insights });
});

export default router;
