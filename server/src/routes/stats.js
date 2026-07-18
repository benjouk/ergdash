import { Router } from 'express';
import { getDb } from '../db.js';
import { validateDateRange, validatePaginationParams } from '../middleware/validate.js';
import { BEST_EFFORT_DURATIONS, computeWeekStreak } from '../analytics.js';
import { getZoneModel, getObservedMaxHr } from '../hrZones.js';
import { wattsFromPace, paceFromWatts } from '../strokeMetrics.js';
import { STANDARD_PB_DISTANCES } from '../pbDetection.js';
import { classifyComparison } from '../workoutComparison.js';
import {
  athleteFromSettings, percentileForPace, eventKeyForDistance, eventKeyForDuration,
} from '../rankings.js';
import { liveBenchmark } from '../rankingsLive.js';

const router = Router();

router.use(validateDateRange);
router.use(validatePaginationParams);

router.get('/summary', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let dateFilter = '';
  const dateParams = [];
  if (from) { dateFilter += ' AND date >= ?'; dateParams.push(from); }
  if (to) { dateFilter += ' AND date < ?'; dateParams.push(to); }

  // Lifetime and season figures are presented as absolute ("all time",
  // "lifetime", "Season Metres"), so the range selector must not shrink them.
  const totals = db.prepare(`
    SELECT COUNT(*) as total_workouts,
           COALESCE(SUM(distance), 0) as total_meters,
           COALESCE(SUM(time_ms), 0) as total_time_ms
    FROM workouts WHERE type = 'rower' AND profile_id = ?
  `).get(req.profileId);

  const now = new Date();
  const seasonStart = now.getMonth() >= 4
    ? `${now.getFullYear()}-05-01`
    : `${now.getFullYear() - 1}-05-01`;

  const season = db.prepare(`
    SELECT COALESCE(SUM(distance), 0) as season_meters,
           COUNT(*) as season_workouts
    FROM workouts WHERE type = 'rower' AND profile_id = ? AND date >= ?
  `).get(req.profileId, seasonStart);

  const avgPaceRow = db.prepare(`
    SELECT AVG(pace_ms) as avg_pace FROM workouts
    WHERE type = 'rower' AND profile_id = ? AND pace_ms > 0${dateFilter}
  `).get(req.profileId, ...dateParams);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const thisWeek = db.prepare(`
    SELECT COUNT(*) as count FROM workouts
    WHERE type = 'rower' AND profile_id = ? AND date >= ?
  `).get(req.profileId, sevenDaysAgo);

  const streak = computeWeekStreak(db, req.profileId);

  const lastWorkout = db.prepare(`
    SELECT date FROM workouts WHERE type = 'rower' AND profile_id = ?${dateFilter} ORDER BY date DESC LIMIT 1
  `).get(req.profileId, ...dateParams);

  const rangeMeters = (startMs, endMs) => {
    const start = new Date(startMs).toISOString();
    const end = new Date(endMs).toISOString();
    return db.prepare(`
      SELECT COALESCE(SUM(distance), 0) as meters FROM workouts
      WHERE type = 'rower' AND profile_id = ? AND date >= ? AND date < ?
    `).get(req.profileId, start, end).meters;
  };

  const DAY = 86400000;
  const nowMs = Date.now();
  const weekly_meters = rangeMeters(nowMs - 7 * DAY, nowMs);
  const prev_weekly_meters = rangeMeters(nowMs - 14 * DAY, nowMs - 7 * DAY);
  const monthly_meters = rangeMeters(nowMs - 30 * DAY, nowMs);
  const prev_monthly_meters = rangeMeters(nowMs - 60 * DAY, nowMs - 30 * DAY);

  const volume_sparkline = db.prepare(`
    SELECT strftime('%Y-W%W', date) as week, SUM(distance) as distance
    FROM workouts
    WHERE type = 'rower' AND profile_id = ? AND date >= ?
    GROUP BY week ORDER BY week
  `).all(req.profileId, new Date(nowMs - 8 * 7 * DAY).toISOString()).map(r => r.distance);

  const split = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN inferred_tag = 'interval' THEN distance ELSE 0 END), 0) as interval_m,
      COALESCE(SUM(CASE WHEN inferred_tag = 'interval' THEN 0 ELSE distance END), 0) as steady_m
    FROM workouts WHERE type = 'rower' AND profile_id = ?${dateFilter}
  `).get(req.profileId, ...dateParams);

  res.json({
    total_meters: totals.total_meters,
    total_workouts: totals.total_workouts,
    total_time_ms: totals.total_time_ms,
    season_meters: season.season_meters,
    season_workouts: season.season_workouts,
    avg_pace: avgPaceRow?.avg_pace ? Math.round(avgPaceRow.avg_pace) : null,
    sessions_this_week: thisWeek.count,
    current_streak_weeks: streak,
    last_workout_date: lastWorkout?.date || null,
    estimated_max_hr: getObservedMaxHr(db, req.profileId),
    weekly_meters,
    prev_weekly_meters,
    monthly_meters,
    prev_monthly_meters,
    volume_sparkline,
    split_steady_m: split.steady_m,
    split_interval_m: split.interval_m,
  });
});

router.get('/trends', (req, res) => {
  const db = getDb();
  const { metric = 'volume', period = '12w' } = req.query;
  const qFrom = req.query.from;
  const qTo = req.query.to;

  let from;
  if (qFrom) {
    from = qFrom;
  } else if (period === 'all') {
    from = new Date(0).toISOString().slice(0, 10);
  } else if (period === '12w') {
    from = new Date(Date.now() - 84 * 86400000).toISOString().slice(0, 10);
  } else if (period === '30d') {
    from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  } else if (period === '90d') {
    from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  } else if (period === '1y') {
    from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  } else {
    from = new Date(0).toISOString().slice(0, 10);
  }

  const toFilter = qTo ? ' AND date < ?' : '';
  const toParam = qTo ? [qTo] : [];

  if (metric === 'volume') {
    const rows = db.prepare(`
      SELECT strftime('%Y-W%W', date) as week,
             MIN(date) as week_start,
             SUM(distance) as distance,
             COUNT(*) as sessions,
             SUM(time_ms) as time_ms,
             SUM(CASE WHEN inferred_tag = 'interval' THEN 0 ELSE distance END) as steady_m,
             SUM(CASE WHEN inferred_tag = 'interval' THEN distance ELSE 0 END) as interval_m
      FROM workouts
      WHERE type = 'rower' AND profile_id = ? AND date >= ?${toFilter}
      GROUP BY week ORDER BY week_start
    `).all(req.profileId, from, ...toParam);
    return res.json({ weekly_volume: rows });
  }

  if (metric === 'pace') {
    const rows = db.prepare(`
      SELECT date, pace_ms, distance,
             CASE WHEN inferred_tag = 'interval' THEN 'interval' ELSE 'endurance' END as inferred_tag
      FROM workouts
      WHERE type = 'rower' AND profile_id = ? AND pace_ms > 0 AND date >= ?${toFilter}
      ORDER BY date
    `).all(req.profileId, from, ...toParam);
    return res.json({ pace_trend: rows });
  }

  if (metric === 'rate') {
    const rows = db.prepare(`
      SELECT date, stroke_rate, distance
      FROM workouts
      WHERE type = 'rower' AND profile_id = ? AND stroke_rate > 0 AND date >= ?${toFilter}
      ORDER BY date
    `).all(req.profileId, from, ...toParam);
    return res.json({ rate_trend: rows });
  }

  if (metric === 'consistency') {
    const rows = db.prepare(`
      SELECT w.date, cm.consistency, w.distance
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND cm.consistency IS NOT NULL AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ consistency_trend: rows });
  }

  if (metric === 'dps') {
    const rows = db.prepare(`
      SELECT w.date, cm.distance_per_stroke as dps, w.distance,
             CASE WHEN w.inferred_tag = 'interval' THEN 'interval' ELSE 'endurance' END as inferred_tag
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND cm.distance_per_stroke IS NOT NULL AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ dps_trend: rows });
  }

  if (metric === 'watts_per_beat') {
    const rows = db.prepare(`
      SELECT w.date, cm.watts_per_beat, w.distance,
             CASE WHEN w.inferred_tag = 'interval' THEN 'interval' ELSE 'endurance' END as inferred_tag
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND cm.watts_per_beat IS NOT NULL AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ watts_per_beat_trend: rows });
  }

  if (metric === 'hr_drift') {
    const rows = db.prepare(`
      SELECT w.date, cm.hr_drift_pct, w.distance
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND cm.hr_drift_pct IS NOT NULL AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ hr_drift_trend: rows });
  }

  if (metric === 'rate_discipline') {
    const rows = db.prepare(`
      SELECT w.date, cm.rate_discipline, w.distance,
             CASE WHEN w.inferred_tag = 'interval' THEN 'interval' ELSE 'endurance' END as inferred_tag
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND cm.rate_discipline IS NOT NULL AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ rate_discipline_trend: rows });
  }

  if (metric === 'drag') {
    const rows = db.prepare(`
      SELECT w.date, w.drag_factor, cm.drag_delta, w.distance
      FROM workouts w
      LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND w.drag_factor > 0 AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ drag_trend: rows });
  }

  if (metric === 'effort') {
    const rows = db.prepare(`
      SELECT w.date, cm.effort_score, w.distance,
             CASE WHEN w.inferred_tag = 'interval' THEN 'interval' ELSE 'endurance' END as inferred_tag
      FROM workouts w
      JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.type = 'rower' AND w.profile_id = ? AND cm.effort_score IS NOT NULL AND w.date >= ?${toFilter}
      ORDER BY w.date
    `).all(req.profileId, from, ...toParam);
    return res.json({ effort_trend: rows });
  }

  res.json({});
});

router.get('/personal-bests', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let dateFilter = '';
  const dateParams = [];
  if (from) { dateFilter += ' AND date >= ?'; dateParams.push(from); }
  if (to) { dateFilter += ' AND date < ?'; dateParams.push(to); }

  const pbs = [];
  for (const dist of STANDARD_PB_DISTANCES) {
    for (const [tag, tagCondition] of [
      ['endurance', "(w.inferred_tag IS NULL OR w.inferred_tag != 'interval')"],
      ['interval', "w.inferred_tag = 'interval'"],
    ]) {
      const row = db.prepare(`
        SELECT w.id, w.date, w.time_ms, w.pace_ms, w.distance
        FROM workouts w
        WHERE w.type = 'rower' AND w.profile_id = ? AND w.distance = ? AND w.pace_ms > 0
          AND ${tagCondition}${dateFilter}
        ORDER BY w.pace_ms ASC LIMIT 1
      `).get(req.profileId, dist, ...dateParams);

      if (row) {
        pbs.push({
          distance: dist,
          tag,
          workout_id: row.id,
          date: row.date,
          time_ms: row.time_ms,
          pace_ms: row.pace_ms,
        });
      }
    }
  }

  // Fixed-duration bests (30 min / 60 min): the best sustained effort at each
  // window, expressed as distance covered. Stroke-level best_efforts already
  // stores these durations.
  const timePbs = [];
  for (const duration of [1800, 3600]) {
    const best = db.prepare(`
      SELECT be.avg_pace_ms, be.workout_id, w.date
      FROM best_efforts be
      JOIN workouts w ON w.id = be.workout_id
      WHERE be.duration_s = ? AND w.profile_id = ? AND be.avg_pace_ms > 0${dateFilter}
      ORDER BY be.avg_watts DESC LIMIT 1
    `).get(duration, req.profileId, ...dateParams);

    if (best) {
      timePbs.push({
        duration_s: duration,
        // metres = time / (seconds per metre); pace_ms is ms per 500m.
        distance: Math.round((duration * 500 * 1000) / best.avg_pace_ms),
        pace_ms: best.avg_pace_ms,
        workout_id: best.workout_id,
        date: best.date,
      });
    }
  }

  // Ranking percentiles, when the athlete has set a sex in Settings: the real
  // distribution when the bucket has been reconciled against the live Concept2
  // rankings, the bundled estimate otherwise. Only the endurance (continuous)
  // PB per event is benchmarked - the public rankings don't accept interval
  // results.
  const settingsRows = db.prepare('SELECT key, value FROM settings WHERE profile_id = ?').all(req.profileId);
  const athlete = athleteFromSettings(Object.fromEntries(settingsRows.map(r => [r.key, r.value])));
  if (athlete) {
    const benchmark = (event, paceMs) => (
      liveBenchmark(db, { event, paceMs, athlete }) || percentileForPace({ event, paceMs, ...athlete })
    );
    for (const pb of pbs) {
      const event = pb.tag === 'endurance' ? eventKeyForDistance(pb.distance) : null;
      if (event) pb.benchmark = benchmark(event, pb.pace_ms);
    }
    for (const tb of timePbs) {
      const event = eventKeyForDuration(tb.duration_s);
      if (event) tb.benchmark = benchmark(event, tb.pace_ms);
    }
  }

  res.json({ personal_bests: pbs, time_bests: timePbs });
});

router.get('/predictions', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT distance, predicted_time, confidence, window_start, window_end, computed_at
    FROM predictions
    WHERE profile_id = ? AND predicted_time IS NOT NULL
    ORDER BY distance
  `).all(req.profileId);
  res.json({ predictions: rows });
});

router.get('/pb-history', (req, res) => {
  const db = getDb();
  const { since } = req.query;
  const conditions = ['ph.profile_id = ?'];
  const params = [req.profileId];

  if (since) {
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        error: 'Validation failed',
        details: ['Invalid "since" date format. Use ISO 8601'],
      });
    }
    conditions.push('ph.achieved_at > ?');
    params.push(since);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT ph.id, ph.workout_id, ph.distance, ph.pace_ms, ph.time_ms,
           ph.achieved_at, ph.tag, w.date as workout_date
    FROM pb_history ph
    JOIN workouts w ON w.id = ph.workout_id
    ${where}
    ORDER BY ph.achieved_at ASC, ph.id ASC
  `).all(...params);

  res.json({ pb_history: rows });
});

router.get('/compare', (req, res) => {
  const db = getDb();
  const ids = (req.query.ids || '').split(',').map(Number).filter(n => n > 0);

  if (ids.length !== 2) {
    return res.status(400).json({ error: 'Provide exactly 2 workout IDs' });
  }

  const workouts = ids.map(id => {
    const w = db.prepare(`
      SELECT w.*, cm.fade_index, cm.consistency, cm.effort_score, cm.drag_delta,
             cm.distance_per_stroke, cm.watts_per_beat, cm.hr_drift_pct,
             cm.rate_discipline, cm.hr_recovery_avg
      FROM workouts w
      LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
      WHERE w.id = ?
    `).get(id);

    if (!w || w.profile_id !== req.profileId) return null;

    const strokes = db.prepare(
      'SELECT * FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
    ).all(id);

    const intervals = db.prepare(
      'SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index'
    ).all(id);

    const recoveries = db.prepare(
      'SELECT rep_index, hr_end, hr_next_start, drop_bpm, rest_s FROM interval_recoveries WHERE workout_id = ? ORDER BY rep_index'
    ).all(id);

    return {
      id: w.id,
      date: w.date,
      type: w.type,
      workout_type: w.workout_type,
      inferred_tag: w.inferred_tag === 'interval' ? 'interval' : 'endurance',
      distance: w.distance,
      time_ms: w.time_ms,
      pace_ms: w.pace_ms,
      stroke_rate: w.stroke_rate,
      stroke_count: w.stroke_count,
      heart_rate_avg: w.heart_rate_avg,
      heart_rate_max: w.heart_rate_max,
      drag_factor: w.drag_factor,
      rest_distance: w.rest_distance,
      rest_time_ms: w.rest_time_ms,
      pinned: !!w.pinned,
      metrics: {
        fade_index: w.fade_index,
        consistency: w.consistency,
        effort_score: w.effort_score,
        drag_delta: w.drag_delta,
        distance_per_stroke: w.distance_per_stroke,
        watts_per_beat: w.watts_per_beat,
        hr_drift_pct: w.hr_drift_pct,
        rate_discipline: w.rate_discipline,
        hr_recovery_avg: w.hr_recovery_avg,
      },
      strokes,
      intervals,
      recoveries,
      pace_profile: comparisonPaceProfile(strokes, intervals),
    };
  });

  if (workouts.some(w => w === null)) {
    return res.status(404).json({ error: 'One or both workouts not found' });
  }

  res.json({
    workouts,
    comparison_match: classifyComparison(workouts[0], workouts[1], workouts[0].intervals, workouts[1].intervals),
  });
});

function comparisonPaceProfile(strokes, intervals) {
  const paces = strokes.filter(stroke => stroke.pace_ms > 0).map(stroke => stroke.pace_ms);
  if (paces.length >= 2) {
    const step = Math.max(1, Math.floor(paces.length / 24));
    return paces.filter((_, index) => index % step === 0).slice(0, 24);
  }
  return intervals.filter(interval => interval.type !== 'rest' && interval.pace_ms > 0).map(interval => interval.pace_ms);
}

router.get('/fitness', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let sql = 'SELECT date, fitness, fatigue, form FROM fitness_log';
  const conditions = ['profile_id = ?'];
  const params = [req.profileId];

  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to) { conditions.push('date <= ?'); params.push(to); }

  sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY date';

  const rows = db.prepare(sql).all(...params);
  res.json({ fitness_log: rows });
});

router.get('/calendar', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let dateFilter = '';
  const params = [];
  if (from) { dateFilter += ' AND date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND date < ?'; params.push(to); }

  const days = db.prepare(`
    SELECT date(date) as date,
           SUM(distance) as meters,
           COUNT(*) as sessions
    FROM workouts
    WHERE type = 'rower' AND profile_id = ?${dateFilter}
    GROUP BY date(date)
    ORDER BY date
  `).all(req.profileId, ...params);

  res.json({ days });
});

router.get('/cumulative', (req, res) => {
  const db = getDb();
  const currentYear = Number(req.query.year) || new Date().getFullYear();
  const compareYear = req.query.compare != null && req.query.compare !== ''
    ? Number(req.query.compare)
    : currentYear - 1;

  const yearSeries = (year) => {
    const rows = db.prepare(`
      SELECT date(date) as date, SUM(distance) as meters
      FROM workouts
      WHERE type = 'rower' AND profile_id = ? AND date >= ? AND date < ?
      GROUP BY date(date)
      ORDER BY date
    `).all(req.profileId, `${year}-01-01`, `${year + 1}-01-01`);

    let cum = 0;
    return rows.map(r => {
      cum += r.meters;
      const doy = Math.floor((new Date(r.date) - new Date(`${year}-01-01`)) / 86400000) + 1;
      return { doy, date: r.date, cum_m: cum };
    });
  };

  const goalRow = db.prepare(
    "SELECT target_meters FROM goals WHERE profile_id = ? AND kind = 'volume' AND period = 'year' AND active = 1"
  ).get(req.profileId);
  const goalM = goalRow ? Number(goalRow.target_meters) : null;

  res.json({
    year: currentYear,
    compare_year: compareYear,
    current: yearSeries(currentYear),
    compare: yearSeries(compareYear),
    goal_m: Number.isFinite(goalM) && goalM > 0 ? goalM : null,
  });
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
    WHERE type = 'rower' AND profile_id = ? AND distance = ? AND has_stroke_data = 1
    ORDER BY date DESC LIMIT 20
  `).all(req.profileId, dist);

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
    const owned = db.prepare('SELECT 1 FROM workouts WHERE id = ? AND profile_id = ?')
      .get(Number(workout_id), req.profileId);
    const strokes = owned ? db.prepare(
      'SELECT pace_ms FROM strokes WHERE workout_id = ? AND pace_ms > 0 ORDER BY stroke_number'
    ).all(Number(workout_id)) : [];
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

router.get('/power-curve', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const ghostDays = Number(req.query.ghost_days) || 90;

  const buildCurve = (dateTo, dateFrom) => {
    const conditions = ['w.profile_id = ?'];
    const params = [req.profileId];
    if (dateFrom) { conditions.push('w.date >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('w.date < ?'); params.push(dateTo); }
    const where = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';

    const curve = [];
    for (const duration of BEST_EFFORT_DURATIONS) {
      // Best recorded stroke-level effort at this duration.
      const best = db.prepare(`
        SELECT be.duration_s, be.avg_watts, be.avg_pace_ms, be.workout_id, w.date
        FROM best_efforts be
        JOIN workouts w ON w.id = be.workout_id
        WHERE be.duration_s = ?${where}
        ORDER BY be.avg_watts DESC LIMIT 1
      `).get(duration, ...params);

      // Workouts without stroke data can still stake a claim if their total
      // duration sits close to the window (whole-workout average power).
      const summary = db.prepare(`
        SELECT w.id as workout_id, w.date, w.pace_ms
        FROM workouts w
        WHERE w.type = 'rower' AND w.has_stroke_data = 0 AND w.pace_ms > 0
          AND w.time_ms >= ? AND w.time_ms <= ?${where}
        ORDER BY w.pace_ms ASC LIMIT 1
      `).get(duration * 1000, duration * 1150, ...params);

      const summaryWatts = summary ? wattsFromPace(summary.pace_ms) : null;

      if (best && (!summaryWatts || best.avg_watts >= summaryWatts)) {
        curve.push(best);
      } else if (summaryWatts) {
        curve.push({
          duration_s: duration,
          avg_watts: summaryWatts,
          avg_pace_ms: paceFromWatts(summaryWatts),
          workout_id: summary.workout_id,
          date: summary.date,
        });
      }
    }
    return curve;
  };

  const ghostCutoff = new Date(Date.now() - ghostDays * 86400000).toISOString().slice(0, 10);

  res.json({
    curve: buildCurve(to || null, from || null),
    ghost: buildCurve(ghostCutoff, from || null),
    ghost_days: ghostDays,
  });
});

router.get('/zones', (req, res) => {
  const db = getDb();
  const { from, to, group = 'week' } = req.query;
  const model = getZoneModel(db, req.profileId);

  if (!model) {
    return res.json({ zone_model: null, weeks: [], sessions: [] });
  }

  let dateFilter = '';
  const params = [];
  if (from) { dateFilter += ' AND w.date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND w.date < ?'; params.push(to); }

  const zoneModel = {
    max_hr: model.maxHr,
    bounds: model.bounds,
    percents: model.percents,
    estimated: model.estimated,
  };

  if (group === 'session') {
    const rows = db.prepare(`
      SELECT w.id as workout_id, w.date,
             SUM(CASE WHEN zt.zone = 1 THEN zt.time_s ELSE 0 END) as z1,
             SUM(CASE WHEN zt.zone = 2 THEN zt.time_s ELSE 0 END) as z2,
             SUM(CASE WHEN zt.zone = 3 THEN zt.time_s ELSE 0 END) as z3,
             SUM(CASE WHEN zt.zone = 4 THEN zt.time_s ELSE 0 END) as z4,
             SUM(CASE WHEN zt.zone = 5 THEN zt.time_s ELSE 0 END) as z5
      FROM hr_zone_time zt
      JOIN workouts w ON w.id = zt.workout_id
      WHERE w.profile_id = ?${dateFilter}
      GROUP BY w.id ORDER BY w.date
    `).all(req.profileId, ...params);
    return res.json({ zone_model: zoneModel, sessions: rows });
  }

  const rows = db.prepare(`
    SELECT strftime('%Y-W%W', w.date) as week,
           MIN(w.date) as week_start,
           SUM(CASE WHEN zt.zone = 1 THEN zt.time_s ELSE 0 END) as z1,
           SUM(CASE WHEN zt.zone = 2 THEN zt.time_s ELSE 0 END) as z2,
           SUM(CASE WHEN zt.zone = 3 THEN zt.time_s ELSE 0 END) as z3,
           SUM(CASE WHEN zt.zone = 4 THEN zt.time_s ELSE 0 END) as z4,
           SUM(CASE WHEN zt.zone = 5 THEN zt.time_s ELSE 0 END) as z5
    FROM hr_zone_time zt
    JOIN workouts w ON w.id = zt.workout_id
    WHERE w.profile_id = ?${dateFilter}
    GROUP BY week ORDER BY week_start
  `).all(req.profileId, ...params);

  res.json({ zone_model: zoneModel, weeks: rows });
});

router.get('/polarization', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let dateFilter = '';
  const params = [];
  if (from) { dateFilter += ' AND w.date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND w.date < ?'; params.push(to); }

  // HR-zoned workouts: easy = Z1-2, moderate = Z3, hard = Z4-5.
  const zoned = db.prepare(`
    SELECT strftime('%Y-W%W', w.date) as week,
           MIN(w.date) as week_start,
           SUM(CASE WHEN zt.zone <= 2 THEN zt.time_s ELSE 0 END) as easy_s,
           SUM(CASE WHEN zt.zone = 3 THEN zt.time_s ELSE 0 END) as moderate_s,
           SUM(CASE WHEN zt.zone >= 4 THEN zt.time_s ELSE 0 END) as hard_s
    FROM hr_zone_time zt
    JOIN workouts w ON w.id = zt.workout_id
    WHERE w.profile_id = ?${dateFilter}
    GROUP BY week
  `).all(req.profileId, ...params);

  // Workouts with no HR anywhere: classify whole duration by intensity
  // factor against the 2:00/500m reference (same as estimateTrainingLoad).
  const unzoned = db.prepare(`
    SELECT strftime('%Y-W%W', w.date) as week,
           MIN(w.date) as week_start,
           SUM(CASE WHEN 120000.0 / w.pace_ms < 0.85 THEN w.time_ms / 1000.0 ELSE 0 END) as easy_s,
           SUM(CASE WHEN 120000.0 / w.pace_ms >= 0.85 AND 120000.0 / w.pace_ms <= 0.95 THEN w.time_ms / 1000.0 ELSE 0 END) as moderate_s,
           SUM(CASE WHEN 120000.0 / w.pace_ms > 0.95 THEN w.time_ms / 1000.0 ELSE 0 END) as hard_s
    FROM workouts w
    WHERE w.type = 'rower' AND w.profile_id = ? AND w.pace_ms > 0
      AND w.id NOT IN (SELECT DISTINCT workout_id FROM hr_zone_time)${dateFilter}
    GROUP BY week
  `).all(req.profileId, ...params);

  const byWeek = new Map();
  for (const rows of [zoned, unzoned]) {
    for (const row of rows) {
      const entry = byWeek.get(row.week) || {
        week: row.week, week_start: row.week_start, easy_s: 0, moderate_s: 0, hard_s: 0,
      };
      entry.easy_s += row.easy_s;
      entry.moderate_s += row.moderate_s;
      entry.hard_s += row.hard_s;
      if (row.week_start < entry.week_start) entry.week_start = row.week_start;
      byWeek.set(row.week, entry);
    }
  }

  const weeks = [...byWeek.values()]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map(w => {
      const total = w.easy_s + w.moderate_s + w.hard_s;
      return {
        ...w,
        total_s: total,
        easy_pct: total > 0 ? (w.easy_s / total) * 100 : 0,
        moderate_pct: total > 0 ? (w.moderate_s / total) * 100 : 0,
        hard_pct: total > 0 ? (w.hard_s / total) * 100 : 0,
      };
    });

  res.json({ weeks });
});

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export default router;
