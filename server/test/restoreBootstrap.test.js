import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

let dataDir;
let db;
let closeDb;
let backup;
let auth;
let server;
let base;

// Seed a profile with data, then produce the exact backup file a user would
// download - including profile identity - and remove everything, mimicking a
// fresh install with only the backup file in hand.
function makeBackupFromSeededProfile() {
  db.prepare("INSERT INTO profiles (id, name, c2_user_id, user_info) VALUES (1, 'Alice', 555, '{\"id\":555,\"first_name\":\"Alice\"}')").run();
  db.prepare(`
    INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance,
      time_ms, pace_ms, source, synced_at)
    VALUES (900123, 1, 555, '2026-02-01T07:30:00', 'rower', 'JustRow', 2000, 480000, 120000, 'c2', datetime('now'))
  `).run();
  db.prepare(`INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m) VALUES (900123, 0, 1.2, 5.5)`).run();
  db.prepare(`INSERT INTO settings (profile_id, key, value) VALUES (1, 'theme', 'dark')`).run();
  const snapshot = backup.exportProfileData(db, 1);
  // Wipe the DB back to empty (fresh install).
  backup.clearProfileData(db, 1);
  db.prepare('DELETE FROM profiles').run();
  return snapshot;
}

async function post(path, body, cookie) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/octet-stream',
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-bootstrap-test-'));
  process.env.DATA_DIR = dataDir;
  process.env.SESSION_SECRET = 'test-session-secret-please-1234';
  vi.resetModules();

  const dbModule = await import('../src/db.js');
  backup = await import('../src/backup.js');
  auth = await import('../src/auth.js');
  const authRouter = (await import('../src/routes/auth.js')).default;
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  auth.initAuth();

  const app = express();
  app.use('/auth', authRouter);
  server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.SESSION_SECRET;
});

describe('POST /auth/restore-bootstrap', () => {
  it('rebuilds a profile from a backup on a fresh install and logs in', async () => {
    const snapshot = makeBackupFromSeededProfile();

    const res = await post('/auth/restore-bootstrap', JSON.stringify(snapshot));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.restored.workouts).toBe(1);
    expect(body.restored.strokes).toBe(1);
    // A session cookie is set so the browser lands in the dashboard.
    expect(res.headers.get('set-cookie')).toBeTruthy();

    // The profile was recreated with its name + Concept2 identity (no tokens).
    const profile = db.prepare('SELECT name, c2_user_id FROM profiles').get();
    expect(profile.name).toBe('Alice');
    expect(profile.c2_user_id).toBe(555);
    // Workout + stroke restored under the new profile, id preserved.
    const workout = db.prepare('SELECT id, profile_id FROM workouts').get();
    expect(workout.id).toBe(900123);
    expect(db.prepare('SELECT COUNT(*) AS c FROM strokes WHERE workout_id = 900123').get().c).toBe(1);
  });

  it('refuses once a profile already exists (403)', async () => {
    auth.createProfile('Existing');
    const snapshot = backup.exportProfileData(db, auth.listProfiles()[0].id);

    const res = await post('/auth/restore-bootstrap', JSON.stringify(snapshot));
    expect(res.status).toBe(403);
  });

  it('rejects a non-backup file without creating a profile', async () => {
    const res = await post('/auth/restore-bootstrap', JSON.stringify({ nope: true }));
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c).toBe(0);
  });

  it('rejects an empty body', async () => {
    const res = await post('/auth/restore-bootstrap', '');
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c).toBe(0);
  });
});
