import { getDb } from './db.js';

export const STANDARD_PB_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000, 21097, 42195];

const STANDARD_DISTANCE_SET = new Set(STANDARD_PB_DISTANCES);

export function computePbProgression(workouts) {
  const bestByDistance = new Map();
  const events = [];

  for (const workout of workouts) {
    if (!STANDARD_DISTANCE_SET.has(workout.distance)) continue;
    if (!workout.pace_ms || workout.pace_ms <= 0) continue;

    const currentBest = bestByDistance.get(workout.distance);
    if (currentBest == null || workout.pace_ms < currentBest) {
      bestByDistance.set(workout.distance, workout.pace_ms);
      events.push({
        workout_id: workout.id,
        distance: workout.distance,
        pace_ms: workout.pace_ms,
        time_ms: workout.time_ms,
        achieved_at: workout.date,
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
    SELECT id, date, distance, pace_ms, time_ms
    FROM workouts
    WHERE type = 'rower'
    ORDER BY date ASC, id ASC
  `).all();

  const events = computePbProgression(workouts);
  insertPbEvents(db, events);

  if (events.length > 0) {
    // Backfilled PBs are history, not news — mark them seen so the client's
    // celebration banner only fires for PBs set after this point.
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
    SELECT id, date, distance, pace_ms, time_ms
    FROM workouts
    WHERE type = 'rower'
      AND id IN (${placeholders})
      AND distance IN (${STANDARD_PB_DISTANCES.map(() => '?').join(',')})
      AND pace_ms > 0
    ORDER BY date ASC, id ASC
  `).all(...ids, ...STANDARD_PB_DISTANCES);

  if (workouts.length === 0) return [];

  const bestByDistance = new Map(
    db.prepare(`
      SELECT distance, MIN(pace_ms) as pace_ms
      FROM pb_history
      GROUP BY distance
    `).all().map(row => [row.distance, row.pace_ms])
  );

  const events = [];
  for (const workout of workouts) {
    const currentBest = bestByDistance.get(workout.distance);
    if (currentBest == null || workout.pace_ms < currentBest) {
      const event = {
        workout_id: workout.id,
        distance: workout.distance,
        pace_ms: workout.pace_ms,
        time_ms: workout.time_ms,
        achieved_at: workout.date,
      };
      bestByDistance.set(workout.distance, workout.pace_ms);
      events.push(event);
    }
  }

  insertPbEvents(db, events);
  return events;
}

// Rebuilds pb_history from scratch for the given distances. Use this when an
// existing workout's C2-owned performance fields (distance/pace/time) change
// via sync, since a correction can invalidate or restore PBs at that
// distance in ways detectNewPbs (which only looks at newly inserted rows)
// can't detect.
export function reconcilePbDistances(distances) {
  const targets = [...new Set((distances || []).filter(d => STANDARD_DISTANCE_SET.has(d)))];
  if (targets.length === 0) return [];

  const db = getDb();
  const placeholders = targets.map(() => '?').join(',');

  const workouts = db.prepare(`
    SELECT id, date, distance, pace_ms, time_ms
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
    INSERT INTO pb_history (workout_id, distance, pace_ms, time_ms, achieved_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const event of events) {
      insert.run(
        event.workout_id,
        event.distance,
        event.pace_ms,
        event.time_ms,
        event.achieved_at
      );
    }
  })();
}
