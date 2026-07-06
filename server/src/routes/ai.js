import { Router } from 'express';
import { getDb } from '../db.js';
import { buildWeeklyInsights } from '../insights.js';
import { computeWeekStreak } from '../analytics.js';

const router = Router();

const DAY = 86400000;

function metersBetween(db, startMs, endMs) {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  return db.prepare(`
    SELECT COALESCE(SUM(distance), 0) as meters, COUNT(*) as count
    FROM workouts WHERE type = 'rower' AND date >= ? AND date < ?
  `).get(start, end);
}

// Average endurance pace over a rolling window (lower pace_ms is faster).
function endurancePaceBetween(db, startMs, endMs) {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const row = db.prepare(`
    SELECT AVG(pace_ms) as pace FROM workouts
    WHERE type = 'rower' AND pace_ms > 0 AND date >= ? AND date < ?
      AND (inferred_tag IS NULL OR inferred_tag != 'interval')
  `).get(start, end);
  return row?.pace ? Math.round(row.pace) : null;
}

router.get('/weekly', (req, res) => {
  const db = getDb();
  const now = Date.now();

  const thisWeek = metersBetween(db, now - 7 * DAY, now);
  const prevWeek = metersBetween(db, now - 14 * DAY, now - 7 * DAY);

  const fitnessRows = db.prepare(
    'SELECT date, fitness, fatigue, form FROM fitness_log ORDER BY date DESC LIMIT 14'
  ).all();
  const latest = fitnessRows[0] || null;
  const weekAgo = fitnessRows.find(r => r.date <= new Date(now - 7 * DAY).toISOString().slice(0, 10))
    || fitnessRows[fitnessRows.length - 1] || null;

  const insights = buildWeeklyInsights({
    weeklyMeters: thisWeek.meters,
    prevWeeklyMeters: prevWeek.meters,
    sessionsThisWeek: thisWeek.count,
    streakWeeks: computeWeekStreak(db),
    fitness: latest?.fitness ?? null,
    fatigue: latest?.fatigue ?? null,
    form: latest?.form ?? null,
    fitnessDelta7d: latest && weekAgo ? latest.fitness - weekAgo.fitness : null,
    recentEndurancePaceMs: endurancePaceBetween(db, now - 30 * DAY, now),
    priorEndurancePaceMs: endurancePaceBetween(db, now - 60 * DAY, now - 30 * DAY),
  });

  res.json({ insights });
});

router.post('/query', (req, res) => {
  res.status(501).json({ error: 'AI features not yet implemented' });
});

router.get('/status', (req, res) => {
  res.json({
    // The rules-based weekly coach and per-workout insights are always on.
    available: true,
    // Free-text querying would need an LLM; report whether one is configured.
    query_available: !!process.env.CLAUDE_API_KEY,
  });
});

export default router;
