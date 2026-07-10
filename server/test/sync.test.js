import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let insertWorkout;
let selectPendingStrokeWorkouts;
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
  ({ insertWorkout, selectPendingStrokeWorkouts } = syncModule);

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

  it('normalizes nested C2 intervals when inserting a brand-new workout', () => {
    insertWorkout(db, c2Workout({
      workout: { intervals: [
        { type: 'distance', distance: 500, time: 118, rest_time: 300 },
        { type: 'distance', distance: 500, time: 120 },
      ] },
    }));

    const intervals = db.prepare(
      'SELECT type, distance, time_ms FROM intervals WHERE workout_id = ? ORDER BY interval_index'
    ).all(1);
    expect(intervals).toEqual([
      { type: 'work', distance: 500, time_ms: 11800 },
      { type: 'rest', distance: 0, time_ms: 30000 },
      { type: 'work', distance: 500, time_ms: 12000 },
    ]);
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

  it('wipes stroke data when a correction changes performance fields, so enrichment refetches', () => {
    insertWorkout(db, c2Workout());
    db.prepare(
      'INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m, pace_ms) VALUES (1, 0, 3.0, 12, 120000)'
    ).run();
    db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = 1').run();

    insertWorkout(db, c2Workout({ time: 4700 }));

    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = 1').get().c).toBe(0);
    expect(db.prepare('SELECT has_stroke_data FROM workouts WHERE id = 1').get().has_stroke_data).toBe(0);
  });

  it('keeps stroke data when only non-performance fields change', () => {
    insertWorkout(db, c2Workout());
    db.prepare(
      'INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m, pace_ms) VALUES (1, 0, 3.0, 12, 120000)'
    ).run();
    db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = 1').run();

    insertWorkout(db, c2Workout({ comments: 'just a comment edit' }));

    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = 1').get().c).toBe(1);
    expect(db.prepare('SELECT has_stroke_data FROM workouts WHERE id = 1').get().has_stroke_data).toBe(1);
  });

  it('replaces intervals on update instead of accumulating duplicates', () => {
    insertWorkout(db, c2Workout({
      workout: { intervals: [{ type: 'distance', distance: 500, time: 120, stroke_rate: 26 }] },
    }));
    insertWorkout(db, c2Workout({
      comments: 'changed',
      workout: { intervals: [
        { type: 'distance', distance: 500, time: 118, stroke_rate: 27, rest_time: 300 },
        { type: 'distance', distance: 500, time: 120, stroke_rate: 26 },
      ] },
    }));

    const intervals = db.prepare('SELECT * FROM intervals WHERE workout_id = ? ORDER BY interval_index').all(1);
    // 2 work reps + 1 rest (from first interval's rest_time) = 3 rows
    expect(intervals).toHaveLength(3);
    expect(intervals[0].type).toBe('work');
    expect(intervals[1].type).toBe('rest');
    expect(intervals[2].type).toBe('work');
  });
});

describe('selectPendingStrokeWorkouts', () => {
  it('uses the enrichment cursor to walk the whole pending backlog and wrap', () => {
    for (let id = 1; id <= 25; id++) {
      insertWorkout(db, c2Workout({ id }));
    }

    const setCursor = db.prepare(`
      INSERT OR REPLACE INTO sync_state (key, value, updated_at)
      VALUES ('last_enriched_workout_id', ?, datetime('now'))
    `);

    setCursor.run('16');
    expect(selectPendingStrokeWorkouts(db, 10).map(row => row.id))
      .toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);

    setCursor.run('6');
    expect(selectPendingStrokeWorkouts(db, 10).map(row => row.id))
      .toEqual([5, 4, 3, 2, 1]);

    setCursor.run('1');
    expect(selectPendingStrokeWorkouts(db, 10).map(row => row.id))
      .toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
  });
});
