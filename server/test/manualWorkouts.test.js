import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let insertWorkout;
let createManualWorkout;
let validateWorkoutFields;
let applyWorkoutCorrection;
let revertWorkoutToC2;
let deleteUserWorkout;
let allocateManualId;
let detectNewPbs;
let workoutTypes;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-manual-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const syncModule = await import('../src/sync.js');
  const mutationsModule = await import('../src/workoutMutations.js');
  const pbModule = await import('../src/pbDetection.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ insertWorkout } = syncModule);
  ({ detectNewPbs } = pbModule);
  ({
    createManualWorkout, validateWorkoutFields, applyWorkoutCorrection,
    revertWorkoutToC2, deleteUserWorkout, allocateManualId,
  } = mutationsModule);
  workoutTypes = mutationsModule.WORKOUT_TYPES;

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name, c2_user_id) VALUES (1, 'Test', 42)").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function c2Workout(overrides) {
  return {
    id: 100,
    user_id: 42,
    date: '2024-01-01 08:00:00',
    timezone: 'UTC',
    type: 'rower',
    workout_type: 'FixedDistanceSplits',
    distance: 2000,
    time: 4800,
    stroke_rate: 28,
    stroke_count: 220,
    calories_total: 250,
    heart_rate: { average: 150, max: 170 },
    drag_factor: 120,
    comments: 'from c2',
    ...overrides,
  };
}

function getWorkout(id) {
  return db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
}

describe('createManualWorkout', () => {
  const body = {
    date: '2024-02-01 06:30:00',
    workout_type: 'FixedDistanceInterval',
    distance: 2000,
    time_ms: 420000,
    heart_rate_avg: 165,
    drag_factor: 118,
    notes: 'club machine',
    intervals: [
      { type: 'work', distance: 1000, time_ms: 209000, stroke_rate: 28 },
      { type: 'rest', distance: 0, time_ms: 120000 },
      { type: 'work', distance: 1000, time_ms: 211000, stroke_rate: 28 },
    ],
  };

  it('creates a negative-id row with source=manual, pace, notes and intervals', () => {
    const result = createManualWorkout(body, 1);
    expect(result.errors).toBeUndefined();
    expect(result.id).toBe(-1);
    expect(result.warnings).toEqual([]);

    const row = getWorkout(-1);
    expect(row.source).toBe('manual');
    expect(row.user_id).toBe(42);
    expect(row.pace_ms).toBe(105000);
    expect(row.notes).toBe('club machine');
    expect(row.raw_json).toBeNull();
    expect(db.prepare('SELECT COUNT(*) as c FROM intervals WHERE workout_id = -1').get().c).toBe(3);
  });

  it('allocates decreasing ids and never collides with c2 ids', () => {
    insertWorkout(db, c2Workout(), 1);
    createManualWorkout(body, 1);
    createManualWorkout({ ...body, date: '2024-02-02 06:30:00' }, 1);
    expect(getWorkout(-1)).toBeTruthy();
    expect(getWorkout(-2)).toBeTruthy();
    expect(allocateManualId(db)).toBe(-3);
  });

  it('rejects missing core fields and out-of-range values', () => {
    const bad = createManualWorkout({ distance: 2000 }, 1);
    expect(bad.errors.join(' ')).toMatch(/date is required/);
    expect(bad.errors.join(' ')).toMatch(/time_ms is required/);

    const badHr = createManualWorkout({
      date: '2024-02-01 06:30:00', distance: 2000, time_ms: 420000, heart_rate_avg: 300,
    }, 1);
    expect(badHr.errors.join(' ')).toMatch(/heart_rate_avg/);
  });

  it('returns warnings when work splits disagree with the workout totals', () => {
    const result = createManualWorkout({
      ...body,
      intervals: [{ type: 'work', distance: 500, time_ms: 105000 }],
    }, 1);
    expect(result.id).toBeLessThan(0);
    expect(result.warnings.join(' ')).toMatch(/work intervals sum/);
  });

  it('matches a planned workout of the same day and distance', () => {
    db.prepare(`
      INSERT INTO planned_workouts (profile_id, date, type, target_distance, status)
      VALUES (1, '2024-02-01', 'steady', 2000, 'planned')
    `).run();

    createManualWorkout(body, 1);

    const plan = db.prepare('SELECT completed_workout_id, status FROM planned_workouts').get();
    expect(plan.completed_workout_id).toBe(-1);
    expect(plan.status).toBe('completed');
  });
});

describe('applyWorkoutCorrection', () => {
  it('tracks edited_fields on c2 rows and recomputes pace', () => {
    insertWorkout(db, c2Workout(), 1);
    applyWorkoutCorrection(db, getWorkout(100), { distance: 2100, heart_rate_avg: 152 });

    const row = getWorkout(100);
    expect(row.distance).toBe(2100);
    expect(row.pace_ms).toBe(Math.round((480000 / 2100) * 500));
    expect(JSON.parse(row.edited_fields).sort()).toEqual(['distance', 'heart_rate_avg']);
  });

  it('does not track edited_fields on manual rows', () => {
    createManualWorkout({ date: '2024-02-01 06:30:00', distance: 2000, time_ms: 420000 }, 1);
    applyWorkoutCorrection(db, getWorkout(-1), { heart_rate_avg: 160 });

    const row = getWorkout(-1);
    expect(row.heart_rate_avg).toBe(160);
    expect(row.edited_fields).toBeNull();
  });

  it('wipes strokes on c2 performance changes but keeps them on manual rows', () => {
    insertWorkout(db, c2Workout(), 1);
    db.prepare('INSERT INTO strokes (workout_id, stroke_number, time_s) VALUES (100, 0, 1.0)').run();
    db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = 100').run();
    applyWorkoutCorrection(db, getWorkout(100), { time_ms: 470000 });
    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = 100').get().c).toBe(0);
    expect(getWorkout(100).has_stroke_data).toBe(0);

    createManualWorkout({ date: '2024-02-01 06:30:00', distance: 2000, time_ms: 420000 }, 1);
    db.prepare('INSERT INTO strokes (workout_id, stroke_number, time_s) VALUES (-1, 0, 1.0)').run();
    db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = -1').run();
    applyWorkoutCorrection(db, getWorkout(-1), { time_ms: 415000 });
    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = -1').get().c).toBe(1);
    expect(getWorkout(-1).has_stroke_data).toBe(1);
  });

  it('rebuilds pb history when a correction invalidates a PB', () => {
    insertWorkout(db, c2Workout({ id: 101, date: '2024-01-01 08:00:00', time: 4200 }), 1); // 2k in 7:00
    insertWorkout(db, c2Workout({ id: 102, date: '2024-01-02 08:00:00', time: 4100 }), 1); // 2k in 6:50 = PB
    detectNewPbs(1, [101, 102]);
    const before = db.prepare('SELECT workout_id FROM pb_history WHERE distance = 2000 ORDER BY pace_ms ASC').all();
    expect(before.map(r => r.workout_id)).toContain(102);

    // Correcting 102's time to be slower than 101 must remove its PB.
    applyWorkoutCorrection(db, getWorkout(102), { time_ms: 440000 });
    const after = db.prepare('SELECT workout_id, pace_ms FROM pb_history WHERE distance = 2000').all();
    const bestPace = Math.min(...after.map(r => r.pace_ms));
    const best = after.find(r => r.pace_ms === bestPace);
    expect(best.workout_id).toBe(101);
  });
});

describe('revertWorkoutToC2', () => {
  it('restores raw_json values, clears overrides, and refuses non-c2 rows', () => {
    insertWorkout(db, c2Workout(), 1);
    applyWorkoutCorrection(db, getWorkout(100), { heart_rate_avg: 160, drag_factor: 111 });
    expect(getWorkout(100).heart_rate_avg).toBe(160);

    const result = revertWorkoutToC2(db, getWorkout(100), null);
    expect(result.revertedFields.sort()).toEqual(['drag_factor', 'heart_rate_avg']);
    const row = getWorkout(100);
    expect(row.heart_rate_avg).toBe(150);
    expect(row.drag_factor).toBe(120);
    expect(row.edited_fields).toBeNull();

    createManualWorkout({ date: '2024-02-01 06:30:00', distance: 2000, time_ms: 420000 }, 1);
    expect(revertWorkoutToC2(db, getWorkout(-1), null).error).toMatch(/Concept2/);
  });

  it('reverts only the named fields', () => {
    insertWorkout(db, c2Workout(), 1);
    applyWorkoutCorrection(db, getWorkout(100), { heart_rate_avg: 160, drag_factor: 111 });

    revertWorkoutToC2(db, getWorkout(100), ['drag_factor']);
    const row = getWorkout(100);
    expect(row.drag_factor).toBe(120);
    expect(row.heart_rate_avg).toBe(160);
    expect(JSON.parse(row.edited_fields)).toEqual(['heart_rate_avg']);
  });
});

describe('deleteUserWorkout', () => {
  it('refuses c2 rows', () => {
    insertWorkout(db, c2Workout(), 1);
    expect(deleteUserWorkout(db, getWorkout(100)).error).toMatch(/cannot be deleted/);
    expect(getWorkout(100)).toBeTruthy();
  });

  it('deletes manual rows with children, pb_history, and frees the plan link', () => {
    db.prepare(`
      INSERT INTO planned_workouts (profile_id, date, type, target_distance, status)
      VALUES (1, '2024-02-01', 'steady', 2000, 'planned')
    `).run();

    createManualWorkout({
      date: '2024-02-01 06:30:00', distance: 2000, time_ms: 420000,
      intervals: [{ type: 'work', distance: 2000, time_ms: 420000 }],
    }, 1);
    db.prepare('INSERT INTO strokes (workout_id, stroke_number, time_s) VALUES (-1, 0, 1.0)').run();

    // Sanity: manual 2k landed in pb_history and matched the plan.
    expect(db.prepare('SELECT COUNT(*) as c FROM pb_history WHERE workout_id = -1').get().c).toBeGreaterThan(0);
    expect(db.prepare('SELECT completed_workout_id FROM planned_workouts').get().completed_workout_id).toBe(-1);

    const result = deleteUserWorkout(db, getWorkout(-1));
    expect(result.ok).toBe(true);
    expect(getWorkout(-1)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) as c FROM intervals WHERE workout_id = -1').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = -1').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM pb_history WHERE workout_id = -1').get().c).toBe(0);
    const plan = db.prepare('SELECT completed_workout_id, status FROM planned_workouts').get();
    expect(plan.completed_workout_id).toBeNull();
    expect(plan.status).toBe('planned');
  });
});

describe('validateWorkoutFields', () => {
  it('uses the workout types defined by the Concept2 Logbook API', () => {
    expect(workoutTypes).toContain('FixedWattMinute');
    expect(workoutTypes).toContain('FixedWattMinuteInterval');
    expect(workoutTypes).not.toContain('FixedWattMinutes');

    expect(validateWorkoutFields({ workout_type: 'FixedWattMinute' }).errors).toEqual([]);
    expect(validateWorkoutFields({ workout_type: 'FixedWattMinuteInterval' }).errors).toEqual([]);
  });

  it('accepts partial bodies for PATCH and rejects invalid dates', () => {
    const ok = validateWorkoutFields({ heart_rate_avg: 150 });
    expect(ok.errors).toEqual([]);
    expect(ok.fields).toEqual({ heart_rate_avg: 150 });

    const bad = validateWorkoutFields({ date: '01/02/2024' });
    expect(bad.errors.join(' ')).toMatch(/date must be/);
  });

  it('rejects max HR below avg HR', () => {
    const bad = validateWorkoutFields({ heart_rate_avg: 160, heart_rate_max: 150 });
    expect(bad.errors.join(' ')).toMatch(/heart_rate_max cannot be lower/);
  });
});

describe('workout_type corrections', () => {
  it('re-runs tag classification when workout_type changes', () => {
    insertWorkout(db, c2Workout(), 1);
    // Force a stale tag; a workout_type edit must trigger the retag pass
    // that corrects it (tag classification keys off rest data).
    db.prepare("UPDATE workouts SET inferred_tag = 'interval' WHERE id = 100").run();

    applyWorkoutCorrection(db, getWorkout(100), { workout_type: 'JustRow' });

    const row = getWorkout(100);
    expect(row.workout_type).toBe('JustRow');
    expect(row.inferred_tag).toBe('endurance');
    expect(JSON.parse(row.edited_fields)).toEqual(['workout_type']);
  });
});
