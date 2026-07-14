import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let inferWorkoutStructure;
let inferWorkoutTag;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-structure-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  ({ getDb, initDb, closeDb } = await import('../src/db.js'));
  ({ inferWorkoutStructure, inferWorkoutTag } = await import('../src/analytics.js'));

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
    ...overrides,
  };
  db.prepare(`
    INSERT INTO workouts (id, user_id, date, type, workout_type, distance, time_ms, rest_time_ms, rest_distance, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(w.id, w.user_id, w.date, w.type, w.workout_type, w.distance, w.time_ms, w.rest_time_ms, w.rest_distance);
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
