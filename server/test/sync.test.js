import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let insertWorkout;
let getDb;
let initDb;
let closeDb;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-sync-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const syncModule = await import('../src/sync.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ insertWorkout } = syncModule);

  initDb();
  db = getDb();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function c2Workout(overrides) {
  return {
    id: 1,
    user_id: 42,
    date: '2024-01-01T08:00:00',
    timezone: 'UTC',
    type: 'rower',
    workout_type: 'FixedDistanceSplits',
    distance: 2000,
    time: 4800, // seconds * 10 -> handled as time * 100 below in ms conversion
    stroke_rate: 28,
    stroke_count: 220,
    calories_total: 250,
    heart_rate: { average: 150, max: 170 },
    drag_factor: 120,
    comments: 'original comment',
    ...overrides,
  };
}

describe('insertWorkout', () => {
  it('inserts a brand-new workout', () => {
    const result = insertWorkout(db, c2Workout());
    expect(result).toEqual({ id: 1, inserted: true });

    const row = db.prepare('SELECT * FROM workouts WHERE id = ?').get(1);
    expect(row.comments).toBe('original comment');
  });

  it('is a no-op when the incoming workout is unchanged', () => {
    insertWorkout(db, c2Workout());
    const result = insertWorkout(db, c2Workout());
    expect(result).toBeNull();
  });

  it('updates C2-owned fields when the workout changed, without touching pinned/notes', () => {
    insertWorkout(db, c2Workout());
    db.prepare('UPDATE workouts SET pinned = 1, notes = ? WHERE id = ?').run('my notes', 1);

    const result = insertWorkout(db, c2Workout({ comments: 'updated comment', heart_rate: { average: 160, max: 180 } }));
    expect(result).toEqual({ id: 1, inserted: false, affectedDistances: [] });

    const row = db.prepare('SELECT * FROM workouts WHERE id = ?').get(1);
    expect(row.comments).toBe('updated comment');
    expect(row.heart_rate_avg).toBe(160);
    expect(row.pinned).toBe(1);
    expect(row.notes).toBe('my notes');
  });

  it('flags affected distances when a correction changes pace-affecting fields', () => {
    insertWorkout(db, c2Workout());
    const result = insertWorkout(db, c2Workout({ time: 4700 }));
    expect(result.inserted).toBe(false);
    expect(result.affectedDistances).toEqual([2000, 2000]);
  });

  it('replaces intervals on update instead of accumulating duplicates', () => {
    insertWorkout(db, c2Workout({
      intervals: [{ type: 'work', distance: 500, time: 120, stroke_rate: 26 }],
    }));
    insertWorkout(db, c2Workout({
      comments: 'changed',
      intervals: [
        { type: 'work', distance: 500, time: 118, stroke_rate: 27 },
        { type: 'rest', distance: 0, time: 30, stroke_rate: 0 },
      ],
    }));

    const intervals = db.prepare('SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index').all(1);
    expect(intervals).toHaveLength(2);
  });
});
