import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

let dataDir;

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
  delete process.env.DATA_DIR;
});

// Builds a database at the pre-013 schema with legacy single-user data, the
// way an existing install looks before upgrading.
function buildLegacyDb(dir) {
  const db = new Database(join(dir, 'ergdash.db'));
  db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))");
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql') && f < '013').sort();
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  }
  db.prepare(`INSERT INTO sync_state (key, value) VALUES
    ('access_token', 'enc:v1:AAA'),
    ('refresh_token', 'enc:v1:BBB'),
    ('token_expires_at', '2026-07-11T00:00:00Z'),
    ('user_info', '{"id":12345,"first_name":"Ben","username":"benj"}'),
    ('last_sync_completed', '2026-07-10T00:00:00Z'),
    ('sync_status', 'idle'),
    ('oauth_state', 'stale-state')
  `).run();
  db.prepare(`INSERT INTO workouts (id, user_id, date, type, workout_type, distance, time_ms, synced_at)
    VALUES (100, 12345, '2026-07-01T08:00:00', 'rower', 'FixedDistanceSplits', 2000, 420000, datetime('now'))`).run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'dark'), ('max_hr', '188')").run();
  db.prepare("INSERT INTO fitness_log (date, fitness) VALUES ('2026-07-01', 50)").run();
  db.prepare('INSERT INTO predictions (distance, predicted_time) VALUES (2000, 415000)').run();
  db.prepare("INSERT INTO goals (kind, period, target_meters) VALUES ('volume', 'weekly', 50000)").run();
  db.close();
}

describe('migration 013 upgrade path', () => {
  it('seeds profile 1 from legacy data, moves tokens, backfills rows, renames cursors', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-migrate-test-'));
    buildLegacyDb(dataDir);
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const { initDb, closeDb } = await import('../src/db.js');
    const db = initDb();

    const profile = db.prepare('SELECT * FROM profiles').get();
    expect(profile).toMatchObject({
      id: 1,
      name: 'Ben',
      c2_user_id: 12345,
      access_token: 'enc:v1:AAA',
      refresh_token: 'enc:v1:BBB',
      token_expires_at: '2026-07-11T00:00:00Z',
    });

    expect(db.prepare('SELECT profile_id FROM workouts WHERE id = 100').get().profile_id).toBe(1);
    expect(db.prepare('SELECT profile_id FROM goals').get().profile_id).toBe(1);
    expect(db.prepare('SELECT profile_id FROM fitness_log').get().profile_id).toBe(1);
    expect(db.prepare('SELECT profile_id FROM predictions').get().profile_id).toBe(1);

    // Customized settings survive; defaults fill the gaps for profile 1.
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings WHERE profile_id = 1').all().map(r => [r.key, r.value])
    );
    expect(settings.theme).toBe('dark');
    expect(settings.max_hr).toBe('188');
    expect(settings.units).toBe('pace');

    const keys = db.prepare('SELECT key FROM sync_state ORDER BY key').all().map(r => r.key);
    expect(keys).toContain('profile:1:last_sync_completed');
    expect(keys).toContain('profile:1:sync_status');
    expect(keys).not.toContain('access_token');
    expect(keys).not.toContain('user_info');
    expect(keys).not.toContain('oauth_state');

    closeDb();
  });

  it('leaves a fresh install with zero profiles and no settings', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-fresh-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const { initDb, closeDb } = await import('../src/db.js');
    const db = initDb();
    expect(db.prepare('SELECT COUNT(*) c FROM profiles').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM settings').get().c).toBe(0);
    closeDb();
  });
});

describe('oauth state intents', () => {
  it('round-trips intents per state and consumes each exactly once', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-oauth-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const { initDb, closeDb } = await import('../src/db.js');
    const auth = await import('../src/auth.js');
    initDb();
    auth.initAuth();

    const urlA = auth.getAuthorizationUrl({ newName: 'Alice' });
    const urlB = auth.getAuthorizationUrl({ profileId: 3 });
    const stateA = new URL(urlA).searchParams.get('state');
    const stateB = new URL(urlB).searchParams.get('state');
    expect(stateA).not.toBe(stateB);

    expect(auth.consumeOauthState(stateB)).toEqual({ profileId: 3 });
    expect(auth.consumeOauthState(stateB)).toBeNull(); // consumed
    expect(auth.consumeOauthState(stateA)).toEqual({ newName: 'Alice' });
    expect(auth.consumeOauthState('0'.repeat(32))).toBeNull();
    expect(auth.consumeOauthState('not-a-state')).toBeNull();

    closeDb();
  });
});

describe('cross-profile isolation', () => {
  let db;
  let server;
  let base;
  let closeDb;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-isolation-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const dbModule = await import('../src/db.js');
    const { resolveProfile } = await import('../src/middleware/profile.js');
    const workoutsRouter = (await import('../src/routes/workouts.js')).default;
    const statsRouter = (await import('../src/routes/stats.js')).default;
    const settingsRouter = (await import('../src/routes/settings.js')).default;
    ({ closeDb } = dbModule);
    db = dbModule.initDb();

    db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Alice'), (2, 'Bob')").run();
    dbModule.seedDefaultSettings(db, 1);
    dbModule.seedDefaultSettings(db, 2);
    const insert = db.prepare(`
      INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, pace_ms, synced_at)
      VALUES (?, ?, ?, ?, 'rower', 'FixedDistanceSplits', ?, ?, ?, datetime('now'))
    `);
    insert.run(1, 1, 11, '2026-07-01T08:00:00', 2000, 420000, 105000);
    insert.run(2, 2, 22, '2026-07-02T08:00:00', 5000, 1200000, 120000);

    const app = express();
    app.use(express.json());
    app.use('/api/workouts', resolveProfile, workoutsRouter);
    app.use('/api/stats', resolveProfile, statsRouter);
    app.use('/api/settings', resolveProfile, settingsRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    closeDb();
  });

  async function req(method, path, profileId, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profileId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  it('lists disjoint workouts per profile', async () => {
    const alice = await req('GET', '/api/workouts', 1);
    const bob = await req('GET', '/api/workouts', 2);
    expect(alice.body.data.map(w => w.id)).toEqual([1]);
    expect(bob.body.data.map(w => w.id)).toEqual([2]);
  });

  it('404s cross-profile access by workout id', async () => {
    expect((await req('GET', '/api/workouts/2', 1)).status).toBe(404);
    expect((await req('GET', '/api/workouts/2', 2)).status).toBe(200);
    expect((await req('PATCH', '/api/workouts/2', 1, { notes: 'mine now' })).status).toBe(404);
    expect((await req('DELETE', '/api/workouts/2', 1)).status).toBe(404);
  });

  it('scopes stats summaries per profile', async () => {
    const alice = await req('GET', '/api/stats/summary', 1);
    const bob = await req('GET', '/api/stats/summary', 2);
    expect(alice.body.total_meters).toBe(2000);
    expect(bob.body.total_meters).toBe(5000);
  });

  it('keeps settings independent between profiles', async () => {
    await req('PATCH', '/api/settings', 1, { max_hr: 188 });
    const alice = await req('GET', '/api/settings', 1);
    const bob = await req('GET', '/api/settings', 2);
    expect(alice.body.max_hr).toBe('188');
    expect(bob.body.max_hr).toBeUndefined();
  });

  it('falls back to the first profile without a header and 409s with no profiles', async () => {
    const res = await fetch(`${base}/api/stats/summary`);
    const body = await res.json();
    expect(body.total_meters).toBe(2000); // profile 1

    db.prepare('DELETE FROM workouts').run();
    db.prepare('DELETE FROM settings').run();
    db.prepare('DELETE FROM profiles').run();
    const empty = await fetch(`${base}/api/stats/summary`);
    expect(empty.status).toBe(409);
  });
});
