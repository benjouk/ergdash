import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

router.get('/summary', (req, res) => {
  const db = getDb();

  const totals = db.prepare(`
    SELECT COUNT(*) as total_workouts,
           COALESCE(SUM(distance), 0) as total_meters,
           COALESCE(SUM(time_ms), 0) as total_time_ms
    FROM workouts WHERE type = 'rower'
  `).get();

  const now = new Date();
  const seasonStart = now.getMonth() >= 8
    ? `${now.getFullYear()}-09-01`
    : `${now.getFullYear() - 1}-09-01`;

  const season = db.prepare(`
    SELECT COALESCE(SUM(distance), 0) as season_meters,
           COUNT(*) as season_workouts
    FROM workouts WHERE type = 'rower' AND date >= ?
  `).get(seasonStart);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  const pace30d = db.prepare(`
    SELECT AVG(pace_ms) as avg_pace FROM workouts
    WHERE type = 'rower' AND pace_ms > 0 AND date >= ?
  `).get(thirtyDaysAgo);

  const pacePrior30d = db.prepare(`
    SELECT AVG(pace_ms) as avg_pace FROM workouts
    WHERE type = 'rower' AND pace_ms > 0 AND date >= ? AND date < ?
  `).get(sixtyDaysAgo, thirtyDaysAgo);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const thisWeek = db.prepare(`
    SELECT COUNT(*) as count FROM workouts
    WHERE type = 'rower' AND date >= ?
  `).get(sevenDaysAgo);

  const streak = computeStreak(db);

  const lastWorkout = db.prepare(`
    SELECT date FROM workouts WHERE type = 'rower' ORDER BY date DESC LIMIT 1
  `).get();

  res.json({
    total_meters: totals.total_meters,
    total_workouts: totals.total_workouts,
    total_time_ms: totals.total_time_ms,
    season_meters: season.season_meters,
    season_workouts: season.season_workouts,
    avg_pace_30d: pace30d?.avg_pace ? Math.round(pace30d.avg_pace) : null,
    avg_pace_prior_30d: pacePrior30d?.avg_pace ? Math.round(pacePrior30d.avg_pace) : null,
    sessions_this_week: thisWeek.count,
    current_streak: streak,
    last_workout_date: lastWorkout?.date || null,
  });
});

router.get('/trends', (req, res) => {
  const db = getDb();
  const { metric = 'volume', period = '12w' } = req.query;

  let fromDate;
  if (period === '12w') fromDate = new Date(Date.now() - 84 * 86400000);
  else if (period === '30d') fromDate = new Date(Date.now() - 30 * 86400000);
  else if (period === '90d') fromDate = new Date(Date.now() - 90 * 86400000);
  else if (period === '1y') fromDate = new Date(Date.now() - 365 * 86400000);
  else fromDate = new Date(0);

  const from = fromDate.toISOString().slice(0, 10);

  if (metric === 'volume') {
    const rows = db.prepare(`
      SELECT strftime('%Y-W%W', date) as week,
             SUM(distance) as distance,
             COUNT(*) as sessions,
             SUM(time_ms) as time_ms,
             SUM(CASE WHEN inferred_tag = 'endurance' THEN distance ELSE 0 END) as endurance_m,
             SUM(CASE WHEN inferred_tag = 'interval' THEN distance ELSE 0 END) as interval_m
      FROM workouts
      WHERE type = 'rower' AND date >= ?
      GROUP BY week ORDER BY week
    `).all(from);
    return res.json({ weekly_volume: rows });
  }

  if (metric === 'pace') {
    const rows = db.prepare(`
      SELECT date, pace_ms, distance, inferred_tag
      FROM workouts
      WHERE type = 'rower' AND pace_ms > 0 AND date >= ?
      ORDER BY date
    `).all(from);
    return res.json({ pace_trend: rows });
  }

  if (metric === 'rate') {
    const rows = db.prepare(`
      SELECT date, stroke_rate, distance
      FROM workouts
      WHERE type = 'rower' AND stroke_rate > 0 AND date >= ?
      ORDER BY date
    `).all(from);
    return res.json({ rate_trend: rows });
  }

  if (metric === 'consistency') {
    const rows = db.prepare(`
      SELECT w.date, cm.consistency, w.distance
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND cm.consistency IS NOT NULL AND w.date >= ?
      ORDER BY w.date
    `).all(from);
    return res.json({ consistency_trend: rows });
  }

  res.json({});
});

router.get('/personal-bests', (req, res) => {
  const db = getDb();
  const standardDistances = [500, 1000, 2000, 5000, 6000, 10000, 21097, 42195];

  const pbs = [];
  for (const dist of standardDistances) {
    const row = db.prepare(`
      SELECT id, date, time_ms, pace_ms, distance
      FROM workouts
      WHERE type = 'rower' AND distance = ? AND pace_ms > 0
      ORDER BY pace_ms ASC LIMIT 1
    `).get(dist);

    if (row) {
      pbs.push({
        distance: dist,
        workout_id: row.id,
        date: row.date,
        time_ms: row.time_ms,
        pace_ms: row.pace_ms,
      });
    }
  }

  res.json({ personal_bests: pbs });
});

router.get('/compare', (req, res) => {
  const db = getDb();
  const ids = (req.query.ids || '').split(',').map(Number).filter(n => n > 0);

  if (ids.length !== 2) {
    return res.status(400).json({ error: 'Provide exactly 2 workout IDs' });
  }

  const workouts = ids.map(id => {
    const w = db.prepare(`
      SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score
      FROM workouts w
      LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.id = ?
    `).get(id);

    if (!w) return null;

    const strokes = db.prepare(
      'SELECT * FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
    ).all(id);

    const intervals = db.prepare(
      'SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index'
    ).all(id);

    return { ...w, strokes, intervals };
  });

  if (workouts.some(w => w === null)) {
    return res.status(404).json({ error: 'One or both workouts not found' });
  }

  res.json({ workouts });
});

router.get('/fitness', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let sql = 'SELECT date, fitness, fatigue, form FROM fitness_log';
  const conditions = [];
  const params = [];

  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to) { conditions.push('date <= ?'); params.push(to); }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY date';

  const rows = db.prepare(sql).all(...params);
  res.json({ fitness_log: rows });
});

router.get('/decay-curve', (req, res) => {
  const db = getDb();
  const { distance, workout_id } = req.query;

  if (!distance) {
    return res.status(400).json({ error: 'distance parameter required' });
  }

  const dist = Number(distance);
  const allWorkouts = db.prepare(`
    SELECT id FROM workouts
    WHERE type = 'rower' AND distance = ? AND has_stroke_data = 1
    ORDER BY date DESC LIMIT 20
  `).all(dist);

  const historicalQuartiles = { q1: [], q2: [], q3: [], q4: [] };

  for (const { id } of allWorkouts) {
    const strokes = db.prepare(
      'SELECT pace_ms FROM strokes WHERE workout_id = ? AND pace_ms > 0 ORDER BY stroke_number'
    ).all(id);

    if (strokes.length < 4) continue;
    const q = Math.floor(strokes.length / 4);
    historicalQuartiles.q1.push(avg(strokes.slice(0, q).map(s => s.pace_ms)));
    historicalQuartiles.q2.push(avg(strokes.slice(q, q * 2).map(s => s.pace_ms)));
    historicalQuartiles.q3.push(avg(strokes.slice(q * 2, q * 3).map(s => s.pace_ms)));
    historicalQuartiles.q4.push(avg(strokes.slice(q * 3).map(s => s.pace_ms)));
  }

  const result = {
    historical: {
      q1: avg(historicalQuartiles.q1),
      q2: avg(historicalQuartiles.q2),
      q3: avg(historicalQuartiles.q3),
      q4: avg(historicalQuartiles.q4),
    },
    current: null,
  };

  if (workout_id) {
    const strokes = db.prepare(
      'SELECT pace_ms FROM strokes WHERE workout_id = ? AND pace_ms > 0 ORDER BY stroke_number'
    ).all(Number(workout_id));
    if (strokes.length >= 4) {
      const q = Math.floor(strokes.length / 4);
      result.current = {
        q1: avg(strokes.slice(0, q).map(s => s.pace_ms)),
        q2: avg(strokes.slice(q, q * 2).map(s => s.pace_ms)),
        q3: avg(strokes.slice(q * 2, q * 3).map(s => s.pace_ms)),
        q4: avg(strokes.slice(q * 3).map(s => s.pace_ms)),
      };
    }
  }

  res.json(result);
});

function computeStreak(db) {
  const dates = db.prepare(`
    SELECT DISTINCT date(date) as d FROM workouts
    WHERE type = 'rower' ORDER BY d DESC
  `).all();

  if (dates.length === 0) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1].d);
    const curr = new Date(dates[i].d);
    const diffDays = (prev - curr) / 86400000;
    if (diffDays <= 1) streak++;
    else break;
  }
  return streak;
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export default router;
