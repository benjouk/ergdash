import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let insertWorkout;
let backfillPbHistory;
let reconcilePbDistances;
let getDb;
let initDb;
let closeDb;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-pb-reconcile-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const syncModule = await import('../src/sync.js');
  const pbModule = await import('../src/pbDetection.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ insertWorkout } = syncModule);
  ({ backfillPbHistory, reconcilePbDistances } = pbModule);

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
    time: 4800,
    stroke_rate: 28,
    stroke_count: 220,
    calories_total: 250,
    heart_rate: { average: 150, max: 170 },
    ...overrides,
  };
}

describe('reconcilePbDistances', () => {
  it('updates a stale PB when a correction changes its pace', () => {
    insertWorkout(db, c2Workout({ id: 1, time: 4800 })); // pace 120000
    backfillPbHistory();

    let history = db.prepare('SELECT * FROM pb_history WHERE distance = 2000').all();
    expect(history).toHaveLength(1);
    expect(history[0].pace_ms).toBe(120000);

    // Corrected result is faster.
    insertWorkout(db, c2Workout({ id: 1, time: 4700 })); // pace 117500
    reconcilePbDistances([2000]);

    history = db.prepare('SELECT * FROM pb_history WHERE distance = 2000').all();
    expect(history).toHaveLength(1);
    expect(history[0].pace_ms).toBe(117500);
  });

  it('drops a later PB that a correction invalidates', () => {
    insertWorkout(db, c2Workout({ id: 1, date: '2024-01-01T08:00:00', time: 4800 })); // pace 120000, PB
    insertWorkout(db, c2Workout({ id: 2, date: '2024-01-02T08:00:00', time: 4750 })); // pace 118750, PB
    backfillPbHistory();

    let history = db.prepare('SELECT workout_id, pace_ms FROM pb_history WHERE distance = 2000 ORDER BY achieved_at').all();
    expect(history.map(h => h.workout_id)).toEqual([1, 2]);

    // Correct workout 1 to be faster than both — it should now be the only PB.
    insertWorkout(db, c2Workout({ id: 1, date: '2024-01-01T08:00:00', time: 4500 })); // pace 112500
    reconcilePbDistances([2000]);

    history = db.prepare('SELECT workout_id, pace_ms FROM pb_history WHERE distance = 2000 ORDER BY achieved_at').all();
    expect(history).toEqual([
      expect.objectContaining({ workout_id: 1, pace_ms: 112500 }),
    ]);
  });

  it('ignores non-standard distances', () => {
    insertWorkout(db, c2Workout({ id: 1, distance: 1234, time: 4800 }));
    backfillPbHistory();
    expect(reconcilePbDistances([1234])).toEqual([]);
  });
});
