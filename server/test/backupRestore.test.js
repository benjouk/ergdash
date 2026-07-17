import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let closeDb;
let backup;

// Seed one profile with a workout plus a representative child row in every
// table a backup should carry.
function seedProfile(database, profileId, { workoutId, distance }) {
  database.prepare(`
    INSERT INTO workouts
      (id, profile_id, user_id, date, type, workout_type, distance, time_ms,
       pace_ms, stroke_rate, heart_rate_avg, comments, notes, source, raw_json, synced_at)
    VALUES (?, ?, 42, '2026-01-01T08:00:00', 'rower', 'JustRow', ?, 480000,
       120000, 24, 150, 'morning row', 'felt good', 'c2', '{"id":${workoutId}}', datetime('now'))
  `).run(workoutId, profileId, distance);
  database.prepare(`
    INSERT INTO intervals (workout_id, interval_index, type, distance, time_ms)
    VALUES (?, 0, 'work', ?, 480000)
  `).run(workoutId, distance);
  database.prepare(`
    INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m, pace_ms, watts, stroke_rate, heart_rate)
    VALUES (?, 0, 1.2, 5.5, 120000, 180.5, 24, 148)
  `).run(workoutId);
  database.prepare(`
    INSERT INTO computed_metrics (workout_id, fade_index, consistency, effort_score)
    VALUES (?, 0.1, 0.9, 7.5)
  `).run(workoutId);
  database.prepare(`
    INSERT INTO hr_zone_time (workout_id, zone, time_s) VALUES (?, 3, 240)
  `).run(workoutId);
  database.prepare(`
    INSERT INTO best_efforts (workout_id, duration_s, avg_watts, avg_pace_ms, start_time_s)
    VALUES (?, 60, 200, 118000, 0)
  `).run(workoutId);
  database.prepare(`
    INSERT INTO pb_history (profile_id, workout_id, distance, pace_ms, time_ms, achieved_at)
    VALUES (?, ?, ?, 120000, 480000, '2026-01-01T08:00:00')
  `).run(profileId, workoutId, distance);
  database.prepare(`
    INSERT INTO fitness_log (profile_id, date, fitness, fatigue, form)
    VALUES (?, '2026-01-01', 50, 30, 20)
  `).run(profileId);
  database.prepare(`
    INSERT INTO goals (profile_id, kind, period, target_meters, active)
    VALUES (?, 'volume', 'weekly', 20000, 1)
  `).run(profileId);
  database.prepare(`
    INSERT INTO settings (profile_id, key, value) VALUES (?, 'theme', 'dark')
  `).run(profileId);
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-backup-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();

  const dbModule = await import('../src/db.js');
  backup = await import('../src/backup.js');
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Alice')").run();
  db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Bob')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('full profile backup + restore', () => {
  it('round-trips every table identically after a wipe', () => {
    seedProfile(db, 1, { workoutId: 1001, distance: 2000 });

    const snapshot = backup.exportProfileData(db, 1);

    // Simulate a fresh install: clear the profile's data entirely, then restore.
    backup.clearProfileData(db, 1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM workouts WHERE profile_id = 1').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS c FROM strokes').get().c).toBe(0);

    const counts = backup.restoreProfileData(db, 1, snapshot);

    expect(counts.workouts).toBe(1);
    expect(counts.strokes).toBe(1);
    expect(counts.goals).toBe(1);

    // Every table restored to exactly what was exported.
    for (const { name } of backup.BACKUP_TABLES) {
      const restored = db.prepare(backupSelect(name)).all(1);
      expect(restored).toEqual(snapshot.tables[name]);
    }

    // The workout id (a Concept2 result id) is preserved, so its stroke's FK
    // still resolves - no re-sync needed.
    const stroke = db.prepare('SELECT workout_id FROM strokes').get();
    expect(stroke.workout_id).toBe(1001);
  });

  it('rewrites profile_id so a backup restores under a different profile id', () => {
    // A backup made under profile 1 can land on an install where the active
    // profile is id 2 (e.g. profiles created in a different order after a
    // reinstall). The source rows no longer exist, so ids are free.
    seedProfile(db, 1, { workoutId: 2002, distance: 5000 });
    const snapshot = backup.exportProfileData(db, 1);
    backup.clearProfileData(db, 1); // fresh install: profile 1's data is gone

    backup.restoreProfileData(db, 2, snapshot);

    const restored = db.prepare('SELECT id, profile_id FROM workouts WHERE profile_id = 2').get();
    expect(restored.id).toBe(2002); // Concept2 result id preserved
    expect(restored.profile_id).toBe(2); // ownership rewritten to the target
    expect(db.prepare('SELECT profile_id FROM goals WHERE profile_id = 2').get().profile_id).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS c FROM strokes WHERE workout_id = 2002').get().c).toBe(1);
  });

  it('only backs up the requested profile', () => {
    seedProfile(db, 1, { workoutId: 3001, distance: 2000 });
    seedProfile(db, 2, { workoutId: 3002, distance: 1000 });

    const snapshot = backup.exportProfileData(db, 1);
    expect(snapshot.tables.workouts).toHaveLength(1);
    expect(snapshot.tables.workouts[0].id).toBe(3001);
    expect(snapshot.tables.strokes.every(s => s.workout_id === 3001)).toBe(true);
  });

  it('restore leaves other profiles untouched', () => {
    seedProfile(db, 1, { workoutId: 4001, distance: 2000 });
    seedProfile(db, 2, { workoutId: 4002, distance: 1000 });
    const aliceBackup = backup.exportProfileData(db, 1);

    backup.restoreProfileData(db, 1, aliceBackup);

    expect(db.prepare('SELECT COUNT(*) AS c FROM workouts WHERE profile_id = 2').get().c).toBe(1);
    expect(db.prepare('SELECT id FROM workouts WHERE profile_id = 2').get().id).toBe(4002);
  });

  it('rejects a file that is not an ErgDash backup', () => {
    expect(() => backup.restoreProfileData(db, 1, { foo: 'bar' })).toThrow(/valid ErgDash backup/);
    expect(backup.isValidBackup({ ergdash_backup_version: 1, tables: {} })).toBe(true);
    expect(backup.isValidBackup({ tables: {} })).toBe(false);
  });

  it('refuses a backup from a newer format version', () => {
    seedProfile(db, 1, { workoutId: 5001, distance: 2000 });
    const snapshot = backup.exportProfileData(db, 1);
    snapshot.ergdash_backup_version = backup.BACKUP_VERSION + 1;
    expect(() => backup.restoreProfileData(db, 1, snapshot)).toThrow(/newer version/);
  });
});

function backupSelect(name) {
  const scope = backup.BACKUP_TABLES.find(t => t.name === name).scope;
  const where = scope === 'workout'
    ? 'workout_id IN (SELECT id FROM workouts WHERE profile_id = ?)'
    : 'profile_id = ?';
  return `SELECT * FROM ${name} WHERE ${where}`;
}
