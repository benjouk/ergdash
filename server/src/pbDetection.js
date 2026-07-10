import { getDb } from './db.js';

export const STANDARD_PB_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000, 21097, 42195];

const STANDARD_DISTANCE_SET = new Set(STANDARD_PB_DISTANCES);

function normalizeTag(inferred_tag) {
  return inferred_tag === 'interval' ? 'interval' : 'endurance';
}

export function computePbProgression(workouts) {
  const bestByKey = new Map();
  const events = [];

  for (const workout of workouts) {
    if (!STANDARD_DISTANCE_SET.has(workout.distance)) continue;
    if (!workout.pace_ms || workout.pace_ms <= 0) continue;

    const tag = normalizeTag(workout.inferred_tag);
    const key = `${workout.distance}:${tag}`;
    const currentBest = bestByKey.get(key);
    if (currentBest == null || workout.pace_ms < currentBest) {
      bestByKey.set(key, workout.pace_ms);
      events.push({
        workout_id: workout.id,
        distance: workout.distance,
        pace_ms: workout.pace_ms,
        time_ms: workout.time_ms,
        achieved_at: workout.date,
        tag,
      });
    }
  }

  return events;
}

export function backfillPbHistory() {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) as count FROM pb_history').get().count;
  if (existing > 0) return [];

  const workouts = db.prepare(`
    SELECT id, date, distance, pace_ms, time_ms, inferred_tag
    FROM workouts
    WHERE type = 'rower'
    ORDER BY date ASC, id ASC
  `).all();

  const events = computePbProgression(workouts);
  insertPbEvents(db, events);

  if (events.length > 0) {
    db.prepare(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('pb_last_seen_at', ?)"
    ).run(new Date().toISOString());
    console.log(`Backfilled ${events.length} PB history events`);
  }

  return events;
}

export function detectNewPbs(workoutIds) {
  const ids = [...new Set((workoutIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return [];

  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) as count FROM pb_history').get().count;
  if (existing === 0) {
    const events = backfillPbHistory();
    const idSet = new Set(ids);
    return events.filter(event => idSet.has(event.workout_id));
  }

  const placeholders = ids.map(() => '?').join(',');
  const workouts = db.prepare(`
    SELECT id, date, distance, pace_ms, time_ms, inferred_tag
    FROM workouts
    WHERE type = 'rower'
      AND id IN (${placeholders})
      AND distance IN (${STANDARD_PB_DISTANCES.map(() => '?').join(',')})
      AND pace_ms > 0
    ORDER BY date ASC, id ASC
  `).all(...ids, ...STANDARD_PB_DISTANCES);

  if (workouts.length === 0) return [];

  const distances = [...new Set(workouts.map(workout => workout.distance))];
  const distancePlaceholders = distances.map(() => '?').join(',');
  const priorWorkouts = db.prepare(`
    SELECT distance, pace_ms, inferred_tag
    FROM workouts
    WHERE type = 'rower'
      AND distance IN (${distancePlaceholders})
      AND id NOT IN (${placeholders})
      AND pace_ms > 0
  `).all(...distances, ...ids);

  // Notifications compare against the best result that existed before this
  // batch arrived. The history itself is rebuilt chronologically below so a
  // late upload can insert or invalidate historical progression events.
  const bestByKey = new Map();
  for (const workout of priorWorkouts) {
    const key = `${workout.distance}:${normalizeTag(workout.inferred_tag)}`;
    const best = bestByKey.get(key);
    if (best == null || workout.pace_ms < best) bestByKey.set(key, workout.pace_ms);
  }

  const events = [];
  for (const workout of workouts) {
    const tag = normalizeTag(workout.inferred_tag);
    const key = `${workout.distance}:${tag}`;
    const currentBest = bestByKey.get(key);
    if (currentBest == null || workout.pace_ms < currentBest) {
      const event = {
        workout_id: workout.id,
        distance: workout.distance,
        pace_ms: workout.pace_ms,
        time_ms: workout.time_ms,
        achieved_at: workout.date,
        tag,
      };
      bestByKey.set(key, workout.pace_ms);
      events.push(event);
    }
  }

  reconcilePbDistances(distances);
  return events;
}

export function reconcilePbDistances(distances) {
  const targets = [...new Set((distances || []).filter(d => STANDARD_DISTANCE_SET.has(d)))];
  if (targets.length === 0) return [];

  const db = getDb();
  const placeholders = targets.map(() => '?').join(',');

  const workouts = db.prepare(`
    SELECT id, date, distance, pace_ms, time_ms, inferred_tag
    FROM workouts
    WHERE type = 'rower' AND distance IN (${placeholders}) AND pace_ms > 0
    ORDER BY date ASC, id ASC
  `).all(...targets);

  const events = computePbProgression(workouts);

  db.transaction(() => {
    db.prepare(`DELETE FROM pb_history WHERE distance IN (${placeholders})`).run(...targets);
    insertPbEvents(db, events);
  })();

  return events;
}

function insertPbEvents(db, events) {
  if (events.length === 0) return;

  const insert = db.prepare(`
    INSERT INTO pb_history (workout_id, distance, pace_ms, time_ms, achieved_at, tag)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const event of events) {
      insert.run(
        event.workout_id,
        event.distance,
        event.pace_ms,
        event.time_ms,
        event.achieved_at,
        event.tag
      );
    }
  })();
}
