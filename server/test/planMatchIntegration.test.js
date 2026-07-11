import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let matchNewWorkouts;
let autoMatchPlan;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-plan-match-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const matchModule = await import('../src/planMatching.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ matchNewWorkouts, autoMatchPlan } = matchModule);

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function insertWorkoutRow({ id, date, distance, timeMs, tag = null }) {
  db.prepare(`
    INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, inferred_tag,
                          distance, time_ms, pace_ms, synced_at)
    VALUES (?, 1, 1, ?, 'rower', 'FixedDistanceSplits', ?, ?, ?, ?, datetime('now'))
  `).run(id, date, tag, distance, timeMs, Math.round((timeMs / distance) * 500));
}

function insertPlanRow({ date, distance = null, durationMs = null, type = 'steady', status = 'planned', workoutId = null, matchType = null }) {
  const result = db.prepare(`
    INSERT INTO planned_workouts (profile_id, date, type, target_distance, target_duration_ms,
                                  completed_workout_id, match_type, status)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, type, distance, durationMs, workoutId, matchType, status);
  return result.lastInsertRowid;
}

function getPlanRow(id) {
  return db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(id);
}

describe('matchNewWorkouts', () => {
  it('links a new workout to the matching same-day plan', () => {
    const planId = insertPlanRow({ date: '2026-07-07', distance: 10000 });
    insertWorkoutRow({ id: 500, date: '2026-07-07T06:30:00Z', distance: 10200, timeMs: 2448000 });

    expect(matchNewWorkouts([500])).toBe(1);

    const plan = getPlanRow(planId);
    expect(plan.completed_workout_id).toBe(500);
    expect(plan.status).toBe('completed');
    expect(plan.match_type).toBe('auto');
  });

  it('does not link plans on other days or outside tolerance among several plans', () => {
    const otherDay = insertPlanRow({ date: '2026-07-06', distance: 10000 });
    const farOff = insertPlanRow({ date: '2026-07-07', distance: 2000 });
    const secondPlan = insertPlanRow({ date: '2026-07-07', distance: 5000 });
    insertWorkoutRow({ id: 501, date: '2026-07-07T06:30:00Z', distance: 10000, timeMs: 2400000 });

    expect(matchNewWorkouts([501])).toBe(0);
    expect(getPlanRow(otherDay).completed_workout_id).toBeNull();
    expect(getPlanRow(farOff).completed_workout_id).toBeNull();
    expect(getPlanRow(secondPlan).completed_workout_id).toBeNull();
  });

  it('never steals a plan that was manually linked', () => {
    insertWorkoutRow({ id: 400, date: '2026-07-07T06:00:00Z', distance: 9800, timeMs: 2350000 });
    insertWorkoutRow({ id: 502, date: '2026-07-07T18:00:00Z', distance: 10000, timeMs: 2400000 });
    const planId = insertPlanRow({
      date: '2026-07-07', distance: 10000,
      status: 'completed', workoutId: 400, matchType: 'manual',
    });

    expect(matchNewWorkouts([502])).toBe(0);
    const plan = getPlanRow(planId);
    expect(plan.completed_workout_id).toBe(400);
    expect(plan.match_type).toBe('manual');
  });

  it('does not double-link one workout to two plans', () => {
    insertPlanRow({ date: '2026-07-07', distance: 10000 });
    insertPlanRow({ date: '2026-07-07', distance: 10000 });
    insertWorkoutRow({ id: 503, date: '2026-07-07T06:30:00Z', distance: 10000, timeMs: 2400000 });

    expect(matchNewWorkouts([503])).toBe(1);
    const linked = db.prepare(
      'SELECT COUNT(*) as c FROM planned_workouts WHERE completed_workout_id = 503'
    ).get().c;
    expect(linked).toBe(1);
  });
});

describe('autoMatchPlan', () => {
  it('completes a plan created after the workout was already synced', () => {
    insertWorkoutRow({ id: 504, date: '2026-07-07T06:30:00Z', distance: 12000, timeMs: 2900000 });
    const planId = insertPlanRow({ date: '2026-07-07', distance: 12000 });

    expect(autoMatchPlan(planId)).toBe(true);
    const plan = getPlanRow(planId);
    expect(plan.completed_workout_id).toBe(504);
    expect(plan.status).toBe('completed');
  });

  it('ignores workouts already linked to another plan', () => {
    insertWorkoutRow({ id: 505, date: '2026-07-07T06:30:00Z', distance: 12000, timeMs: 2900000 });
    insertPlanRow({ date: '2026-07-07', distance: 12000, status: 'completed', workoutId: 505, matchType: 'auto' });

    const planId = insertPlanRow({ date: '2026-07-07', distance: 12000 });
    expect(autoMatchPlan(planId)).toBe(false);
    expect(getPlanRow(planId).completed_workout_id).toBeNull();
  });
});
