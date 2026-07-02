import { getDb } from './db.js';
import {
  distancePerStroke,
  wattsPerBeat,
  hrDrift,
  rateDiscipline,
  hrRecoveries,
  segmentStrokesByIntervals,
  zoneTimes,
  bestEfforts,
} from './strokeMetrics.js';
import { getZoneModel, zoneForHr } from './hrZones.js';

export const BEST_EFFORT_DURATIONS = [60, 240, 600, 1800, 3600];

// Bump whenever computed_metrics gains columns or an algorithm changes;
// computeAllMetrics() recomputes any row written with an older version.
export const METRICS_VERSION = 2;

const MIN_DRIFT_DURATION_MS = 15 * 60 * 1000;

function getRateBandTolerance(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'rate_band_tolerance'").get();
  const tolerance = row ? Number(row.value) : NaN;
  return Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 2;
}

export function computeMetricsForWorkout(workoutId) {
  const db = getDb();
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(workoutId);
  if (!workout) return;

  const strokes = db.prepare(
    'SELECT * FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
  ).all(workoutId);

  let fadeIndex = null;
  let consistency = null;
  let effortScore = null;
  let dragDelta = null;

  if (strokes.length >= 4) {
    const paces = strokes.map(s => s.pace_ms).filter(p => p != null && p > 0);
    if (paces.length >= 4) {
      const q = Math.floor(paces.length / 4);
      const q1Avg = avg(paces.slice(0, q));
      const q4Avg = avg(paces.slice(-q));
      fadeIndex = q1Avg > 0 ? ((q4Avg - q1Avg) / q1Avg) * 100 : 0;

      const mean = avg(paces);
      const variance = paces.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / paces.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
      consistency = Math.max(0, Math.min(100, 100 - cv * 500));
    }
  }

  if (workout.pace_ms && workout.pace_ms > 0) {
    const userBests = db.prepare(
      'SELECT MIN(pace_ms) as best FROM workouts WHERE distance = ? AND pace_ms > 0'
    ).get(workout.distance);
    const userAvgRate = db.prepare(
      'SELECT AVG(stroke_rate) as avg_rate FROM workouts WHERE stroke_rate > 0'
    ).get();

    const pacePct = userBests?.best ? Math.min(100, (userBests.best / workout.pace_ms) * 100) : 50;
    const ratePct = userAvgRate?.avg_rate && workout.stroke_rate
      ? Math.min(100, (workout.stroke_rate / userAvgRate.avg_rate) * 100)
      : 50;
    const hrPct = workout.heart_rate_avg ? Math.min(100, (workout.heart_rate_avg / 200) * 100) : 50;
    const durationFactor = Math.min(100, (workout.time_ms / 3600000) * 100);

    effortScore = pacePct * 0.4 + ratePct * 0.2 + hrPct * 0.2 + durationFactor * 0.2;
  }

  if (workout.drag_factor) {
    const rollingAvg = db.prepare(
      'SELECT AVG(drag_factor) as avg_drag FROM (SELECT drag_factor FROM workouts WHERE drag_factor > 0 ORDER BY date DESC LIMIT 30)'
    ).get();
    if (rollingAvg?.avg_drag) {
      dragDelta = workout.drag_factor - rollingAvg.avg_drag;
    }
  }

  const isInterval = workout.inferred_tag === 'interval';
  const intervals = isInterval
    ? db.prepare('SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index').all(workoutId)
    : [];

  const dps = distancePerStroke(workout, strokes);
  const wpb = wattsPerBeat(strokes);

  const drift = !isInterval && workout.time_ms >= MIN_DRIFT_DURATION_MS
    ? hrDrift(strokes)
    : null;

  const tolerance = getRateBandTolerance(db);
  const rateSegments = isInterval && intervals.length > 0
    ? segmentStrokesByIntervals(strokes, intervals).workSegments
    : [strokes];
  const discipline = rateDiscipline(rateSegments, tolerance);

  const recoveries = isInterval ? hrRecoveries(strokes, intervals) : [];
  const recoveryAvg = recoveries.length > 0
    ? recoveries.reduce((s, r) => s + r.drop_bpm, 0) / recoveries.length
    : null;

  const insertRecovery = db.prepare(`
    INSERT INTO interval_recoveries (workout_id, rep_index, hr_end, hr_next_start, drop_bpm, rest_s)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO computed_metrics (
        workout_id, fade_index, consistency, effort_score, drag_delta,
        distance_per_stroke, watts_per_beat, hr_drift_pct, rate_discipline,
        hr_recovery_avg, metrics_version, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      workoutId, fadeIndex, consistency, effortScore, dragDelta,
      dps, wpb, drift, discipline, recoveryAvg, METRICS_VERSION
    );

    db.prepare('DELETE FROM interval_recoveries WHERE workout_id = ?').run(workoutId);
    for (const r of recoveries) {
      insertRecovery.run(workoutId, r.rep_index, r.hr_end, r.hr_next_start, r.drop_bpm, r.rest_s);
    }
  })();
}

export function computeAllMetrics() {
  const db = getDb();
  const workouts = db.prepare(`
    SELECT w.id FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    WHERE cm.id IS NULL OR COALESCE(cm.metrics_version, 0) < ?
  `).all(METRICS_VERSION);

  for (const { id } of workouts) {
    computeMetricsForWorkout(id);
  }

  if (workouts.length > 0) {
    console.log(`Computed metrics for ${workouts.length} workouts (v${METRICS_VERSION})`);
  }
}

export function computeZoneTimesForWorkout(workoutId, zoneModel) {
  const db = getDb();
  const model = zoneModel ?? getZoneModel(db);
  if (!model) return;

  const workout = db.prepare(
    'SELECT id, time_ms, heart_rate_avg, has_stroke_data FROM workouts WHERE id = ?'
  ).get(workoutId);
  if (!workout) return;

  let times = null;
  let source = 'strokes';

  if (workout.has_stroke_data) {
    const strokes = db.prepare(
      'SELECT time_s, heart_rate FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
    ).all(workoutId);
    times = zoneTimes(strokes, model.bounds);
  }

  // No per-stroke HR: credit the whole session to the zone of the average HR.
  if (!times && workout.heart_rate_avg > 0 && workout.time_ms > 0) {
    times = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    times[zoneForHr(workout.heart_rate_avg, model.bounds)] = workout.time_ms / 1000;
    source = 'avg_hr';
  }

  const insert = db.prepare(
    'INSERT INTO hr_zone_time (workout_id, zone, time_s, source) VALUES (?, ?, ?, ?)'
  );

  db.transaction(() => {
    db.prepare('DELETE FROM hr_zone_time WHERE workout_id = ?').run(workoutId);
    if (!times) return;
    for (let zone = 1; zone <= 5; zone++) {
      if (times[zone] > 0) insert.run(workoutId, zone, times[zone], source);
    }
  })();
}

export function computeAllZoneTimes() {
  const db = getDb();
  const model = getZoneModel(db);
  if (!model) return;

  const workouts = db.prepare(`
    SELECT w.id FROM workouts w
    LEFT JOIN (SELECT DISTINCT workout_id FROM hr_zone_time) zt ON w.id = zt.workout_id
    WHERE zt.workout_id IS NULL
      AND (w.has_stroke_data = 1 OR w.heart_rate_avg > 0)
  `).all();

  for (const { id } of workouts) {
    computeZoneTimesForWorkout(id, model);
  }
}

// Full recompute — called when the zone model itself changes (max HR or
// thresholds edited in Settings). Single-user data is small enough to do
// synchronously.
export function recomputeAllZoneTimes() {
  const db = getDb();
  db.prepare('DELETE FROM hr_zone_time').run();
  computeAllZoneTimes();
}

export function computeBestEffortsForWorkout(workoutId) {
  const db = getDb();
  const strokes = db.prepare(
    'SELECT time_s, pace_ms, watts FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
  ).all(workoutId);

  const efforts = bestEfforts(strokes, BEST_EFFORT_DURATIONS);

  const insert = db.prepare(`
    INSERT INTO best_efforts (workout_id, duration_s, avg_watts, avg_pace_ms, start_time_s)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    db.prepare('DELETE FROM best_efforts WHERE workout_id = ?').run(workoutId);
    for (const e of efforts) {
      insert.run(workoutId, e.duration_s, e.avg_watts, e.avg_pace_ms, e.start_time_s);
    }
  })();
}

export function computeAllBestEfforts() {
  const db = getDb();
  const workouts = db.prepare(`
    SELECT w.id FROM workouts w
    LEFT JOIN (SELECT DISTINCT workout_id FROM best_efforts) be ON w.id = be.workout_id
    WHERE be.workout_id IS NULL AND w.has_stroke_data = 1
  `).all();

  for (const { id } of workouts) {
    computeBestEffortsForWorkout(id);
  }
}

export function computePredictions() {
  const db = getDb();
  const standardDistances = [2000, 5000, 6000, 10000, 21097];
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO predictions (
      distance, predicted_time, confidence, window_start, window_end, computed_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  const clear = db.prepare('DELETE FROM predictions WHERE distance = ?');

  db.transaction(() => {
    for (const distance of standardDistances) {
      const rows = db.prepare(`
        SELECT date, time_ms, pace_ms
        FROM workouts
        WHERE type = 'rower' AND distance = ? AND pace_ms > 0
        ORDER BY date ASC
      `).all(distance);

      if (rows.length < 5) {
        clear.run(distance);
        continue;
      }

      const points = rows.map((row, index) => ({
        x: (new Date(row.date) - new Date(rows[0].date)) / 86400000,
        y: row.pace_ms,
        weight: 1 + index / rows.length,
      }));

      const regression = weightedLinearRegression(points);
      const best = rows.reduce((currentBest, row) => (
        row.pace_ms < currentBest.pace_ms ? row : currentBest
      ), rows[0]);

      const targetPace = Math.max(1, best.pace_ms - 1000);
      let windowStart = null;
      let windowEnd = null;
      let predictedPace = best.pace_ms;

      if (regression.slope < 0) {
        const daysToTarget = (targetPace - regression.intercept) / regression.slope;
        const projectedDate = new Date(new Date(rows[0].date).getTime() + daysToTarget * 86400000);
        if (Number.isFinite(projectedDate.getTime()) && projectedDate > new Date()) {
          const uncertaintyDays = Math.max(7, Math.round(28 * (1 - regression.confidence)));
          windowStart = new Date(projectedDate.getTime() - uncertaintyDays * 86400000).toISOString().slice(0, 10);
          windowEnd = new Date(projectedDate.getTime() + uncertaintyDays * 86400000).toISOString().slice(0, 10);
          predictedPace = targetPace;
        }
      }

      upsert.run(
        distance,
        Math.round((distance / 500) * predictedPace),
        regression.confidence,
        windowStart,
        windowEnd
      );
    }
  })();
}

export function computeFitnessLog() {
  const db = getDb();
  const workouts = db.prepare(`
    SELECT date, distance, time_ms, pace_ms, stroke_rate
    FROM workouts WHERE type = 'rower' ORDER BY date ASC
  `).all();

  if (workouts.length === 0) return;

  const dailyLoad = {};
  for (const w of workouts) {
    const load = estimateTrainingLoad(w);
    const day = w.date.slice(0, 10);
    dailyLoad[day] = (dailyLoad[day] || 0) + load;
  }

  const firstDate = new Date(workouts[0].date);
  const today = new Date();
  let fitness = 0;
  let fatigue = 0;
  const ctlDecay = 1 - Math.exp(-1 / 42);
  const atlDecay = 1 - Math.exp(-1 / 7);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO fitness_log (date, fitness, fatigue, form, computed_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  const entries = [];
  for (let d = new Date(firstDate); d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const load = dailyLoad[dateStr] || 0;

    fitness = fitness + ctlDecay * (load - fitness);
    fatigue = fatigue + atlDecay * (load - fatigue);
    const form = fitness - fatigue;

    entries.push([dateStr, fitness, fatigue, form]);
  }

  db.transaction(() => {
    for (const [date, f, a, form] of entries) {
      upsert.run(date, f, a, form);
    }
  })();
}

function estimateTrainingLoad(workout) {
  if (!workout.time_ms || workout.time_ms <= 0) return 0;
  if (!workout.distance || workout.distance <= 0) return 0;

  const durationHours = workout.time_ms / 3600000;
  const referencePaceMs = 120000;
  const paceMs = workout.pace_ms && workout.pace_ms > 0
    ? workout.pace_ms
    : Math.round((workout.time_ms / workout.distance) * 500);
  if (!paceMs || paceMs <= 0) return 0;

  const intensityFactor = referencePaceMs / paceMs;
  return durationHours * Math.pow(intensityFactor, 2) * 100;
}

export function inferWorkoutTag(workout) {
  const db = getDb();
  const intervalCount = db.prepare(
    "SELECT COUNT(*) as count FROM intervals WHERE workout_id = ? AND type = 'work'"
  ).get(workout.id)?.count || 0;
  const restCount = db.prepare(
    "SELECT COUNT(*) as count FROM intervals WHERE workout_id = ? AND type = 'rest'"
  ).get(workout.id)?.count || 0;

  const hasRest = restCount > 0 || workout.rest_time_ms > 0 || workout.rest_distance > 0;

  if (hasRest || intervalCount >= 2) {
    return 'interval';
  }

  return 'endurance';
}

export function tagAllWorkouts() {
  const db = getDb();
  const workouts = db.prepare(
    'SELECT id, distance, time_ms, workout_type, rest_time_ms, rest_distance FROM workouts'
  ).all();

  const update = db.prepare('UPDATE workouts SET inferred_tag = ? WHERE id = ?');
  db.transaction(() => {
    for (const w of workouts) {
      const tag = inferWorkoutTag(w);
      update.run(tag, w.id);
    }
  })();
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function weightedLinearRegression(points) {
  const weightSum = points.reduce((sum, point) => sum + point.weight, 0);
  const meanX = points.reduce((sum, point) => sum + point.x * point.weight, 0) / weightSum;
  const meanY = points.reduce((sum, point) => sum + point.y * point.weight, 0) / weightSum;

  let numerator = 0;
  let denominator = 0;
  let residual = 0;
  let total = 0;

  for (const point of points) {
    numerator += point.weight * (point.x - meanX) * (point.y - meanY);
    denominator += point.weight * Math.pow(point.x - meanX, 2);
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  for (const point of points) {
    const predicted = intercept + slope * point.x;
    residual += point.weight * Math.pow(point.y - predicted, 2);
    total += point.weight * Math.pow(point.y - meanY, 2);
  }

  const fit = total === 0 ? 1 : Math.max(0, 1 - residual / total);
  const density = Math.min(1, points.length / 10);
  return {
    slope,
    intercept,
    confidence: Math.round(fit * density * 100) / 100,
  };
}
