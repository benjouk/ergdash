import { Router } from 'express';
import { getDb } from '../db.js';
import { buildTrendNudges, buildWeeklyOverview } from '../insights.js';
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
      AND (intent IS NULL OR intent != 'warmup')
  `).get(profileId, start, end);
  return row?.pace ? Math.round(row.pace) : null;
}

// Steady-session metric samples for the trend nudges. Intervals, warm-ups,
// tests and races are excluded: trends only mean something across sessions
// rowed at a comparable, repeatable effort.
function steadyMetricsBetween(db, profileId, startMs, endMs) {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const rows = db.prepare(`
    SELECT w.pace_ms, w.heart_rate_avg, cm.hr_drift_pct, cm.distance_per_stroke, cm.watts_per_beat
    FROM workouts w
    LEFT JOIN computed_metrics cm ON cm.workout_id = w.id
    WHERE w.type = 'rower' AND w.profile_id = ? AND w.date >= ? AND w.date < ?
      AND (w.inferred_tag IS NULL OR w.inferred_tag != 'interval')
      AND (w.intent IS NULL OR w.intent NOT IN ('warmup', 'test', 'race'))
  `).all(profileId, start, end);
  const pick = (field) => rows.map(row => row[field]).filter(value => Number.isFinite(value) && value > 0);
  return {
    paceMs: pick('pace_ms'),
    hrAvg: pick('heart_rate_avg'),
    hrDriftPct: rows.map(row => row.hr_drift_pct).filter(value => Number.isFinite(value)),
    distancePerStroke: pick('distance_per_stroke'),
    wattsPerBeat: pick('watts_per_beat'),
  };
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

  const overview = buildWeeklyOverview({
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

  // Slow-moving trends: last 3 weeks of steady sessions vs the 6 weeks before.
  const nudges = buildTrendNudges({
    recent: steadyMetricsBetween(db, req.profileId, now - 21 * DAY, now),
    prior: steadyMetricsBetween(db, req.profileId, now - 63 * DAY, now - 21 * DAY),
  });

  res.json({ ...overview, nudges });
});

export default router;
