import { Router } from 'express';
import { getDb } from '../db.js';
import { buildWeeklyInsights } from '../insights.js';

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

function weekStreak(db) {
  const weeks = db.prepare(`
    SELECT DISTINCT strftime('%Y-%W', date) as w FROM workouts
    WHERE type = 'rower' ORDER BY w DESC
  `).all().map(r => r.w);
  if (weeks.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < weeks.length; i++) {
    const [y1, w1] = weeks[i - 1].split('-').map(Number);
    const [y2, w2] = weeks[i].split('-').map(Number);
    if ((y1 - y2) * 52 + (w1 - w2) === 1) streak++;
    else break;
  }
  return streak;
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
    streakWeeks: weekStreak(db),
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
