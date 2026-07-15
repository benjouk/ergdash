import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let computeMetricsForWorkout;
let inferWorkoutStructure;
let inferWorkoutTag;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-structure-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  ({ getDb, initDb, closeDb } = await import('../src/db.js'));
  ({ computeMetricsForWorkout, inferWorkoutStructure, inferWorkoutTag } = await import('../src/analytics.js'));

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

// inferWorkoutStructure reads rest fields from the passed object and rest rows
// from the intervals table, so we insert a real workout row (intervals FK) and
// return the row object the classifier expects.
function makeWorkout(overrides = {}) {
  const w = {
    id: 1,
    user_id: 42,
    date: '2024-01-01T08:00:00',
    type: 'rower',
    workout_type: 'FixedDistanceSplits',
    distance: 2000,
    time_ms: 480000,
    rest_time_ms: null,
    rest_distance: null,
    inferred_tag: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO workouts (
      id, profile_id, user_id, date, type, workout_type, distance, time_ms,
      rest_time_ms, rest_distance, inferred_tag, synced_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    w.id, w.user_id, w.date, w.type, w.workout_type, w.distance, w.time_ms,
    w.rest_time_ms, w.rest_distance, w.inferred_tag
  );
  return w;
}

function addRestRow(workoutId) {
  db.prepare(
    "INSERT INTO intervals (workout_id, interval_index, type, distance, time_ms) VALUES (?, 0, 'rest', 0, 30000)"
  ).run(workoutId);
}

describe('inferWorkoutStructure', () => {
  it('classifies a continuous type with no rest as continuous', () => {
    const s = inferWorkoutStructure(makeWorkout());
    expect(s.value).toBe('continuous');
    expect(s.subtype).toBe('fixed_distance');
    expect(s.reasons.length).toBeGreaterThan(0);
  });

  it('classifies a continuous type with a rest interval row as interval', () => {
    const w = makeWorkout();
    addRestRow(w.id);
    expect(inferWorkoutStructure(w).value).toBe('interval');
  });

  it('classifies a continuous type with rest_time_ms as interval', () => {
    const w = makeWorkout({ rest_time_ms: 30000 });
    expect(inferWorkoutStructure(w).value).toBe('interval');
  });

  it('classifies a continuous type with rest_distance as interval', () => {
    const w = makeWorkout({ rest_distance: 100 });
    expect(inferWorkoutStructure(w).value).toBe('interval');
  });

  it('classifies an interval type with no rest rows as interval', () => {
    const w = makeWorkout({ id: 2, workout_type: 'VariableInterval' });
    expect(inferWorkoutStructure(w).value).toBe('interval');
    expect(inferWorkoutStructure(w).subtype).toBe('variable');
  });

  it('classifies an unknown type with no rest evidence as unknown', () => {
    const w = makeWorkout({ id: 3, workout_type: 'unknown' });
    const s = inferWorkoutStructure(w);
    expect(s.value).toBe('unknown');
    expect(s.subtype).toBe('unknown');
  });
});

describe('inferWorkoutTag legacy wrapper', () => {
  it('maps continuous structure to endurance and interval to interval', () => {
    expect(inferWorkoutTag(makeWorkout())).toBe('endurance');
    expect(inferWorkoutTag(makeWorkout({ id: 2, workout_type: 'VariableInterval' }))).toBe('interval');
  });

  it('maps unknown structure to endurance (preserving legacy fallback)', () => {
    expect(inferWorkoutTag(makeWorkout({ id: 3, workout_type: 'unknown' }))).toBe('endurance');
  });
});

describe('computeMetricsForWorkout interval structure', () => {
  it('uses inferred structure when the persisted tag is stale', () => {
    const workout = makeWorkout({
      workout_type: 'VariableInterval',
      time_ms: 15 * 60 * 1000,
      inferred_tag: 'endurance',
    });

    const insertInterval = db.prepare(`
      INSERT INTO intervals (workout_id, interval_index, type, distance, time_ms)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertInterval.run(workout.id, 0, 'work', 250, 60000);
    insertInterval.run(workout.id, 1, 'rest', 0, 60000);
    insertInterval.run(workout.id, 2, 'work', 250, 60000);

    const insertStroke = db.prepare(`
      INSERT INTO strokes (
        workout_id, stroke_number, time_s, distance_m, pace_ms, watts,
        stroke_rate, heart_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < 90; i++) {
      const timeS = (i + 1) * 2;
      const heartRate = timeS < 60 ? 170 : timeS < 120 ? 0 : 130;
      insertStroke.run(workout.id, i + 1, timeS, (i + 1) * 6, 120000, 200, 24, heartRate);
    }

    computeMetricsForWorkout(workout.id);

    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM interval_recoveries WHERE workout_id = ?'
    ).get(workout.id).count).toBe(1);
    expect(db.prepare(
      'SELECT hr_drift_pct FROM computed_metrics WHERE workout_id = ?'
    ).get(workout.id).hr_drift_pct).toBeNull();
  });
});
