import { getDb } from './db.js';

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

  db.prepare(`
    INSERT OR REPLACE INTO computed_metrics (workout_id, fade_index, consistency, effort_score, drag_delta, computed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(workoutId, fadeIndex, consistency, effortScore, dragDelta);
}

export function computeAllMetrics() {
  const db = getDb();
  const workouts = db.prepare(`
    SELECT w.id FROM workouts w
    LEFT JOIN computed_metrics cm ON w.id = cm.workout_id
    WHERE cm.id IS NULL
  `).all();

  for (const { id } of workouts) {
    computeMetricsForWorkout(id);
  }
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
  const durationMin = workout.time_ms / 60000;
  const intensityFactor = workout.pace_ms && workout.pace_ms > 0
    ? Math.max(0.5, 120000 / workout.pace_ms)
    : 1;
  return durationMin * intensityFactor * (workout.distance / 1000);
}

export function inferWorkoutTag(workout) {
  const { distance, time_ms, workout_type } = workout;
  const db = getDb();
  const intervalCount = db.prepare(
    "SELECT COUNT(*) as count FROM intervals WHERE workout_id = ? AND type = 'work'"
  ).get(workout.id)?.count || 0;

  if (intervalCount >= 2) return 'interval';

  const testDistances = [2000, 5000, 6000, 10000];
  if (testDistances.includes(distance) && intervalCount === 0) return 'test';

  if (distance < 2000 && time_ms < 600000) return 'warmup';

  return 'endurance';
}

export function tagAllWorkouts() {
  const db = getDb();
  const workouts = db.prepare(
    'SELECT id, distance, time_ms, workout_type FROM workouts WHERE inferred_tag IS NULL'
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
