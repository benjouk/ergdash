import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let closeDb;
let EXPORT_TABLES;
let wipeWorkoutData;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-admin-data-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();

  const dbModule = await import('../src/db.js');
  const adminModule = await import('../src/routes/admin.js');
  ({ closeDb } = dbModule);
  ({ EXPORT_TABLES, wipeWorkoutData } = adminModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('admin data operations', () => {
  it('includes goals, programs, and plans in JSON exports', () => {
    expect(EXPORT_TABLES).toEqual(expect.arrayContaining([
      'goals', 'programs', 'planned_workouts',
    ]));
  });

  it('resets completed plan links before deleting workouts for a fresh sync', () => {
    db.prepare(`
      INSERT INTO workouts
        (id, profile_id, user_id, date, type, workout_type, distance, time_ms, synced_at)
      VALUES (1, 1, 1, '2026-01-01T08:00:00', 'rower', 'test', 2000, 480000, datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO planned_workouts
        (profile_id, date, type, target_distance, completed_workout_id, match_type, status)
      VALUES (1, '2026-01-01', 'test', 2000, 1, 'manual', 'completed')
    `).run();

    wipeWorkoutData(db, 1);

    expect(db.prepare('SELECT COUNT(*) AS count FROM workouts').get().count).toBe(0);
    expect(db.prepare(`
      SELECT completed_workout_id, match_type, status FROM planned_workouts
    `).get()).toEqual({
      completed_workout_id: null,
      match_type: null,
      status: 'planned',
    });
  });
});
