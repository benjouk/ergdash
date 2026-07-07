import { initDb, getDb } from './db.js';
import { computeMetricsForWorkout, computeFitnessLog, tagAllWorkouts, computePredictions } from './analytics.js';

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const rand = seededRandom(42);

function randBetween(min, max) {
  return min + rand() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randBetween(min, max + 1));
}

function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function generateWorkouts() {
  const workouts = [];
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  let id = 100000;
  const dayMs = 86400000;
  let currentDate = new Date(sixMonthsAgo);

  while (currentDate < now) {
    const dayOfWeek = currentDate.getDay();
    const isRestDay = dayOfWeek === 0 || (dayOfWeek === 3 && rand() > 0.5);

    if (!isRestDay && rand() > 0.15) {
      const monthsIn = (currentDate - sixMonthsAgo) / (30 * dayMs);
      const improvementFactor = 1 - monthsIn * 0.005;

      const workoutType = pick(['endurance', 'endurance', 'endurance', 'interval', 'test']);

      let workout;
      if (workoutType === 'endurance') {
        workout = generateEndurance(id++, currentDate, improvementFactor);
      } else if (workoutType === 'interval') {
        workout = generateInterval(id++, currentDate, improvementFactor);
      } else {
        workout = generateTest(id++, currentDate, improvementFactor);
      }

      workouts.push(workout);

      if (rand() > 0.85) {
        workouts.push(generateEndurance(id++, currentDate, improvementFactor, true));
      }
    }

    currentDate = new Date(currentDate.getTime() + dayMs);
  }

  return workouts;
}

function generateEndurance(id, date, factor, isDouble = false) {
  const distances = isDouble ? [2000, 3000] : [5000, 6000, 8000, 10000, 12000, 15000, 21097];
  const distance = pick(distances);

  const basePace = distance <= 5000 ? 120000 : distance <= 10000 ? 122000 : 125000;
  const paceMs = Math.round(basePace * factor + randBetween(-2000, 3000));
  const timeMs = Math.round((distance / 500) * (paceMs / 1000) * 1000);
  const strokeRate = Math.round(randBetween(22, 26) * 10) / 10;
  const strokeCount = Math.round(timeMs / 60000 * strokeRate);
  const hrAvg = randInt(145, 165);

  return {
    id, date: sessionDate(date, isDouble), distance, timeMs, paceMs, strokeRate, strokeCount,
    hrAvg, hrMax: hrAvg + randInt(10, 20), dragFactor: randInt(115, 130),
    calories: Math.round(distance / 25 + randBetween(-10, 10)),
    type: 'endurance', workoutType: 'FixedDistanceSplits',
    strokes: generateStrokeData(distance, paceMs, strokeRate, hrAvg),
  };
}

function generateInterval(id, date, factor) {
  const numIntervals = pick([4, 5, 6, 8]);
  const intDistance = pick([500, 750, 1000]);
  const distance = numIntervals * intDistance;

  const basePace = 110000;
  const paceMs = Math.round(basePace * factor + randBetween(-3000, 2000));
  const restTimeMs = pick([60000, 90000, 120000]);

  const intervals = [];
  let totalTime = 0;
  for (let i = 0; i < numIntervals; i++) {
    const iPace = paceMs + randInt(-2000, 3000);
    const iTime = Math.round((intDistance / 500) * (iPace / 1000) * 1000);
    intervals.push({
      index: i, type: 'work', distance: intDistance,
      timeMs: iTime, paceMs: iPace,
      strokeRate: Math.round(randBetween(28, 34) * 10) / 10,
      hrAvg: randInt(165, 180),
    });
    totalTime += iTime + restTimeMs;
  }

  const avgPace = Math.round(intervals.reduce((s, i) => s + i.paceMs, 0) / numIntervals);
  const hrAvg = randInt(165, 178);
  const strokes = generateIntervalStrokeData(intervals, restTimeMs);

  return {
    id, date: sessionDate(date), distance, timeMs: totalTime, paceMs: avgPace,
    strokeRate: Math.round(randBetween(29, 33) * 10) / 10,
    // Strokes only happen during work reps; counting the rests inflated the
    // stroke count and dragged distance-per-stroke down to implausible values.
    strokeCount: strokes.length,
    hrAvg, hrMax: hrAvg + randInt(10, 18), dragFactor: randInt(118, 128),
    calories: Math.round(distance / 22 + randBetween(-5, 5)),
    type: 'interval', workoutType: 'FixedDistanceSplits',
    intervals, strokes,
  };
}

// Stroke stream for an interval set: work reps only (as Concept2 records it),
// with the stroke clock spanning the rest gaps and distance accumulating
// across reps. HR climbs through each rep and restarts lower after the rest,
// so between-rep recoveries fall out of the data naturally.
function generateIntervalStrokeData(intervals, restTimeMs) {
  const strokes = [];
  let strokeNumber = 0;
  let elapsedS = 0;
  let baseDistance = 0;

  intervals.forEach((interval, index) => {
    const repStrokes = Math.max(10, Math.round((interval.timeMs / 60000) * interval.strokeRate));
    const metersPerStroke = interval.distance / repStrokes;
    const hrStart = interval.hrAvg - randInt(18, 26);
    const hrPeak = interval.hrAvg + randInt(4, 8);

    for (let s = 0; s < repStrokes; s++) {
      const progress = s / repStrokes;
      const pace = Math.round(interval.paceMs + randBetween(-1500, 1500));
      const paceSeconds = pace / 1000;
      const watts = paceSeconds > 0 ? Math.round(2.80 / Math.pow(paceSeconds / 500, 3)) : 0;
      const hr = Math.round(hrStart + (hrPeak - hrStart) * Math.min(1, progress * 1.6) + randBetween(-2, 2));

      strokes.push({
        number: strokeNumber++,
        timeS: Math.round(elapsedS * 100) / 100,
        distanceM: Math.round((baseDistance + s * metersPerStroke) * 10) / 10,
        paceMs: pace,
        watts,
        strokeRate: Math.round((interval.strokeRate + randBetween(-1.2, 1.2)) * 10) / 10,
        heartRate: Math.max(100, Math.min(200, hr)),
      });

      elapsedS += (metersPerStroke / 500) * paceSeconds;
    }

    baseDistance += interval.distance;
    if (index < intervals.length - 1) elapsedS += restTimeMs / 1000;
  });

  return strokes;
}

function generateTest(id, date, factor) {
  const distance = pick([2000, 5000]);
  const basePace = distance === 2000 ? 105000 : 115000;
  const paceMs = Math.round(basePace * factor + randBetween(-3000, 2000));
  const timeMs = Math.round((distance / 500) * (paceMs / 1000) * 1000);
  const strokeRate = distance === 2000 ? randBetween(30, 34) : randBetween(26, 30);
  const hrAvg = randInt(172, 188);

  return {
    id, date: sessionDate(date), distance, timeMs, paceMs,
    strokeRate: Math.round(strokeRate * 10) / 10,
    strokeCount: Math.round(timeMs / 60000 * strokeRate),
    hrAvg, hrMax: hrAvg + randInt(5, 12), dragFactor: randInt(120, 130),
    calories: Math.round(distance / 20 + randBetween(-5, 5)),
    type: 'test', workoutType: 'FixedDistanceSplits',
    strokes: generateStrokeData(distance, paceMs, strokeRate, hrAvg),
  };
}

function generateStrokeData(distance, avgPaceMs, avgRate, avgHr) {
  const strokes = [];
  const totalStrokes = Math.round((distance / 500) * (avgPaceMs / 1000) / 60 * avgRate * 60);
  const count = Math.min(totalStrokes, 600);
  const metersPerStroke = distance / count;
  // How tightly this session held its rating; varies workout to workout so
  // rate-discipline scores spread out instead of pinning at 100.
  const rateJitter = randBetween(1, 3.5);

  let elapsedS = 0;
  for (let i = 0; i < count; i++) {
    const progress = i / count;
    let paceFactor;
    if (progress < 0.1) paceFactor = 0.97;
    else if (progress < 0.75) paceFactor = 1.0 + randBetween(-0.02, 0.02);
    else if (progress < 0.9) paceFactor = 1.01 + randBetween(-0.01, 0.03);
    else paceFactor = 0.98 + randBetween(-0.02, 0.01);

    const pace = Math.round(avgPaceMs * paceFactor + randBetween(-1000, 1000));
    const paceSeconds = pace / 1000;
    const watts = paceSeconds > 0 ? Math.round(2.80 / Math.pow(paceSeconds / 500, 3)) : 0;
    const hr = Math.round(avgHr * (0.85 + progress * 0.15) + randBetween(-3, 3));

    // Accumulate each stroke's own duration. Scaling cumulative distance by
    // the current stroke's jittered pace makes timestamps non-monotonic,
    // which inflates every dt-based metric (time in zone, HR drift, best
    // efforts) since negative deltas clamp to zero but spikes count in full.
    strokes.push({
      number: i,
      timeS: Math.round(elapsedS * 100) / 100,
      distanceM: Math.round(i * metersPerStroke * 10) / 10,
      paceMs: pace,
      watts,
      strokeRate: Math.round((avgRate + randBetween(-rateJitter, rateJitter)) * 10) / 10,
      heartRate: Math.max(100, Math.min(200, hr)),
    });

    elapsedS += (metersPerStroke / 500) * paceSeconds;
  }

  return strokes;
}

function formatDate(date) {
  return date.toISOString().slice(0, 19) + 'Z';
}

// Sessions land at a plausible morning or evening clock time instead of
// inheriting whatever time the seed script happened to run at.
function sessionDate(date, isDouble = false) {
  const d = new Date(date);
  const evening = isDouble || rand() < 0.4;
  const hour = evening ? 17 + randInt(0, 2) : 6 + randInt(0, 2);
  d.setHours(hour, randInt(0, 59), 0, 0);
  return formatDate(d);
}

// Sample goals so dev mode exercises the goal overlays: a weekly and a
// season volume target plus a 2k performance target pegged just under the
// seeded best, with a race six weeks out.
function seedGoals(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM goals').get().c;
  if (count > 0) return;

  const insertGoal = db.prepare(`
    INSERT INTO goals (kind, period, target_meters, distance, target_time_ms, race_date, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertGoal.run('volume', 'weekly', 60000, null, null, null, null);
  insertGoal.run('volume', 'season', 1500000, null, null, null, null);

  const best2k = db.prepare(`
    SELECT MIN(time_ms) as t FROM workouts
    WHERE type = 'rower' AND distance = 2000 AND pace_ms > 0
  `).get().t;
  if (best2k) {
    const raceDate = new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10);
    insertGoal.run('performance', null, null, 2000, best2k - 15000, raceDate, 'Race day 2k');
  }

  console.log('Seeded sample goals');
}

export function seedDatabase() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as c FROM workouts').get().c;
  if (count > 0) {
    console.log(`Database already has ${count} workouts, skipping seed`);
    seedGoals(db);
    return;
  }

  console.log('Seeding database with mock data...');
  const workouts = generateWorkouts();

  const insertWorkout = db.prepare(`
    INSERT OR IGNORE INTO workouts (
      id, user_id, date, type, workout_type,
      distance, time_ms, pace_ms, stroke_rate, stroke_count,
      calories, heart_rate_avg, heart_rate_max, drag_factor,
      has_stroke_data, synced_at
    ) VALUES (?, 1, ?, 'rower', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertInterval = db.prepare(`
    INSERT OR IGNORE INTO intervals (
      workout_id, interval_index, type, distance, time_ms,
      pace_ms, stroke_rate, heart_rate_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertStroke = db.prepare(`
    INSERT OR IGNORE INTO strokes (
      workout_id, stroke_number, time_s, distance_m,
      pace_ms, watts, stroke_rate, heart_rate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const w of workouts) {
      insertWorkout.run(
        w.id, w.date, w.workoutType,
        w.distance, w.timeMs, w.paceMs, w.strokeRate, w.strokeCount,
        w.calories, w.hrAvg, w.hrMax, w.dragFactor,
        w.strokes ? 1 : 0
      );

      if (w.intervals) {
        for (const iv of w.intervals) {
          insertInterval.run(
            w.id, iv.index, iv.type, iv.distance,
            iv.timeMs, iv.paceMs, iv.strokeRate, iv.hrAvg
          );
        }
      }

      if (w.strokes) {
        for (const s of w.strokes) {
          insertStroke.run(
            w.id, s.number, s.timeS, s.distanceM,
            s.paceMs, s.watts, s.strokeRate, s.heartRate
          );
        }
      }
    }
  })();

  console.log(`Seeded ${workouts.length} workouts`);

  tagAllWorkouts();
  console.log('Tagged all workouts');

  computeFitnessLog();
  console.log('Computed fitness log');

  computePredictions();
  console.log('Computed predictions');

  for (const w of workouts) {
    if (w.strokes) {
      computeMetricsForWorkout(w.id);
    }
  }
  console.log('Computed workout metrics');

  seedGoals(db);
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  initDb();
  seedDatabase();
  console.log('Seed complete');
}
