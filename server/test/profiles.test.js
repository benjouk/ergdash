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

  it('ranks same-profile comparison candidates and excludes other profiles', async () => {
    db.prepare(`
      INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, inferred_tag, distance, time_ms, pace_ms, synced_at)
      VALUES (3, 1, 11, '2026-06-25T08:00:00', 'rower', 'FixedDistanceSplits', 'endurance', 2000, 425000, 106250, datetime('now'))
    `).run();
    const result = await req('GET', '/api/workouts/1/comparison-candidates?scope=recommended&limit=100', 1);
    expect(result.status).toBe(200);
    expect(result.body.data.map(workout => workout.id)).toEqual([3]);
    expect(result.body.data[0].comparison_match).toMatchObject({ level: 'exact', axis: 'distance' });
    expect((await req('GET', '/api/workouts/2/comparison-candidates', 1)).status).toBe(404);
  });

  it('preserves compare order, serializes advanced metrics, and blocks cross-profile pairs', async () => {
    db.prepare(`
      INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, inferred_tag, distance, time_ms, pace_ms, synced_at)
      VALUES (3, 1, 11, '2026-06-25T08:00:00', 'rower', 'FixedDistanceSplits', 'endurance', 2000, 425000, 106250, datetime('now'))
    `).run();
    db.prepare('INSERT INTO computed_metrics (workout_id, consistency, distance_per_stroke, rate_discipline) VALUES (1, 92, 9.5, 88)').run();
    const result = await req('GET', '/api/stats/compare?ids=3,1', 1);
    expect(result.status).toBe(200);
    expect(result.body.workouts.map(workout => workout.id)).toEqual([3, 1]);
    expect(result.body.workouts[1].metrics).toMatchObject({ consistency: 92, distance_per_stroke: 9.5, rate_discipline: 88 });
    expect(result.body.comparison_match.level).toBe('exact');
    expect((await req('GET', '/api/stats/compare?ids=1,2', 1)).status).toBe(404);
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

  it('falls back to the first profile for an unknown/stale profile id', async () => {
    // A client whose saved profile was deleted elsewhere still gets data
    // (the first profile) rather than a 409 on every request.
    const res = await req('GET', '/api/stats/summary', 99999);
    expect(res.status).toBe(200);
    expect(res.body.total_meters).toBe(2000); // profile 1 (Alice)
  });
});


describe('profile management and isolation (unit)', () => {
  let db;
  let closeDb;
  let auth;
  let admin;
  let dedup;
  let pb;
  let planMatching;
  let hrZones;
  let analytics;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-unit-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const dbModule = await import('../src/db.js');
    auth = await import('../src/auth.js');
    admin = await import('../src/routes/admin.js');
    dedup = await import('../src/importers/dedup.js');
    pb = await import('../src/pbDetection.js');
    planMatching = await import('../src/planMatching.js');
    hrZones = await import('../src/hrZones.js');
    analytics = await import('../src/analytics.js');
    ({ closeDb } = dbModule);
    db = dbModule.initDb();
    auth.initAuth();
  });

  afterEach(() => {
    closeDb();
  });

  function addWorkout(profileId, id, { distance = 2000, timeMs = 420000, hrMax = null, source = 'c2', fingerprint = null } = {}) {
    const paceMs = Math.round((timeMs / distance) * 500);
    db.prepare(`
      INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type,
                            distance, time_ms, pace_ms, heart_rate_max, has_stroke_data,
                            source, import_fingerprint, synced_at)
      VALUES (?, ?, 0, '2026-07-01T08:00:00', 'rower', 'FixedDistanceSplits',
              ?, ?, ?, ?, 0, ?, ?, datetime('now'))
    `).run(id, profileId, distance, timeMs, paceMs, hrMax, source, fingerprint);
  }

  describe('resolveConnectingProfile', () => {
    it('reuses the profile that already holds the connecting Concept2 user id', () => {
      const existing = auth.createProfile('Existing');
      auth.setProfileIdentity(existing.id, { id: 555 });
      const before = auth.listProfiles().length;

      const resolved = auth.resolveConnectingProfile({ id: 555, first_name: 'Whoever' }, { newName: 'New Name' });

      expect(resolved.profile.id).toBe(existing.id);
      expect(auth.listProfiles().length).toBe(before); // no duplicate created
    });

    it('honors a reconnect intent when the profile has no logbook yet', () => {
      const target = auth.createProfile('Target');
      const resolved = auth.resolveConnectingProfile({ id: 999 }, { profileId: target.id });
      expect(resolved.profile.id).toBe(target.id);
    });

    it('allows a reconnect that re-authorizes the same logbook', () => {
      const target = auth.createProfile('Target');
      auth.setProfileIdentity(target.id, { id: 100 });
      const resolved = auth.resolveConnectingProfile({ id: 100 }, { profileId: target.id });
      expect(resolved.profile.id).toBe(target.id);
    });

    it('refuses a reconnect that authorizes a logbook owned by another profile', () => {
      const a = auth.createProfile('A');
      auth.setProfileIdentity(a.id, { id: 42 });
      const b = auth.createProfile('B');

      const resolved = auth.resolveConnectingProfile({ id: 42 }, { profileId: b.id });

      expect(resolved.error).toBe('logbook_in_use');
      expect(resolved.profile).toBeUndefined();
      // Nothing got retargeted.
      expect(auth.getProfileByC2UserId(42).id).toBe(a.id);
    });

    it('refuses a reconnect that authorizes a different account than the profile is bound to', () => {
      const b = auth.createProfile('B');
      auth.setProfileIdentity(b.id, { id: 100 });

      const resolved = auth.resolveConnectingProfile({ id: 200 }, { profileId: b.id });

      expect(resolved.error).toBe('wrong_account');
      expect(auth.getProfile(b.id).c2_user_id).toBe(100); // unchanged
    });

    it('creates a new profile named from the account when nothing matches', () => {
      const before = auth.listProfiles().length;
      const resolved = auth.resolveConnectingProfile({ id: 1000, first_name: 'Dana' }, {});
      expect(resolved.profile.name).toBe('Dana');
      expect(auth.listProfiles().length).toBe(before + 1);
    });
  });

  describe('deleteProfile', () => {
    function populate(profileId, workoutId) {
      addWorkout(profileId, workoutId, { hrMax: 190 });
      db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = ?').run(workoutId);
      db.prepare('INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m) VALUES (?, 0, 1.0, 5.0)').run(workoutId);
      db.prepare("INSERT INTO intervals (workout_id, interval_index, type, distance, time_ms) VALUES (?, 0, 'work', 2000, 420000)").run(workoutId);
      db.prepare('INSERT INTO computed_metrics (workout_id, fade_index) VALUES (?, 1.0)').run(workoutId);
      db.prepare('INSERT INTO hr_zone_time (workout_id, zone, time_s) VALUES (?, 1, 100)').run(workoutId);
      db.prepare('INSERT INTO best_efforts (workout_id, duration_s, avg_watts) VALUES (?, 60, 200)').run(workoutId);
      db.prepare('INSERT INTO interval_recoveries (workout_id, rep_index) VALUES (?, 0)').run(workoutId);
      db.prepare("INSERT INTO pb_history (profile_id, workout_id, distance, pace_ms, time_ms, achieved_at, tag) VALUES (?, ?, 2000, 105000, 420000, '2026-07-01', 'endurance')").run(profileId, workoutId);
      db.prepare("INSERT INTO goals (profile_id, kind, period, target_meters) VALUES (?, 'volume', 'weekly', 50000)").run(profileId);
      db.prepare("INSERT INTO planned_workouts (profile_id, date, type, target_distance) VALUES (?, '2026-07-01', 'steady', 2000)").run(profileId);
      db.prepare("INSERT INTO programs (profile_id, preset_id, name, start_date, duration_weeks, training_days) VALUES (?, 'pete-plan', 'P', '2026-07-01', 12, '[0]')").run(profileId);
      db.prepare("INSERT INTO fitness_log (profile_id, date, fitness) VALUES (?, '2026-07-01', 50)").run(profileId);
      db.prepare('INSERT INTO predictions (profile_id, distance, predicted_time) VALUES (?, 2000, 415000)').run(profileId);
      db.prepare("INSERT INTO settings (profile_id, key, value) VALUES (?, 'max_hr', '190')").run(profileId);
      db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?)').run(`profile:${profileId}:sync_status`, 'idle');
    }

    const OWNER_TABLES = ['workouts', 'pb_history', 'goals', 'planned_workouts', 'programs', 'fitness_log', 'predictions', 'settings'];
    const CHILD_TABLES = ['strokes', 'intervals', 'computed_metrics', 'hr_zone_time', 'best_efforts', 'interval_recoveries'];

    it('cascades across every owned table and leaves other profiles untouched', () => {
      const a = auth.createProfile('A');
      const b = auth.createProfile('B');
      populate(a.id, 101);
      populate(b.id, 202);

      auth.deleteProfile(a.id);

      for (const t of OWNER_TABLES) {
        // A is fully gone; B is untouched (settings carries seeded defaults too,
        // so assert presence rather than an exact row count).
        expect(db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE profile_id = ?`).get(a.id).c).toBe(0);
        expect(db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE profile_id = ?`).get(b.id).c).toBeGreaterThan(0);
      }
      for (const t of CHILD_TABLES) {
        expect(db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE workout_id = 101`).get().c).toBe(0);
        expect(db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE workout_id = 202`).get().c).toBe(1);
      }
      expect(db.prepare('SELECT COUNT(*) c FROM sync_state WHERE key = ?').get(`profile:${a.id}:sync_status`).c).toBe(0);
      expect(db.prepare('SELECT COUNT(*) c FROM sync_state WHERE key = ?').get(`profile:${b.id}:sync_status`).c).toBe(1);
      expect(auth.getProfile(a.id)).toBeNull();
      expect(auth.getProfile(b.id)).not.toBeNull();
    });
  });

  describe('token isolation', () => {
    it('clearAuth disconnects only the target profile', () => {
      const a = auth.createProfile('A');
      const b = auth.createProfile('B');
      auth.storeTokens(a.id, { access_token: 'tok-a', refresh_token: 'ref-a', expires_in: 3600 });
      auth.storeTokens(b.id, { access_token: 'tok-b', refresh_token: 'ref-b', expires_in: 3600 });

      auth.clearAuth(a.id);

      const connected = Object.fromEntries(auth.listProfiles().map(p => [p.id, p.connected]));
      expect(connected[a.id]).toBe(false);
      expect(connected[b.id]).toBe(true);
    });

    it('getValidToken returns each profiles own token (encryption round-trips per profile)', async () => {
      const a = auth.createProfile('A');
      const b = auth.createProfile('B');
      auth.storeTokens(a.id, { access_token: 'tok-a', expires_in: 3600 });
      auth.storeTokens(b.id, { access_token: 'tok-b', expires_in: 3600 });

      expect(await auth.getValidToken(a.id)).toBe('tok-a');
      expect(await auth.getValidToken(b.id)).toBe('tok-b');
    });
  });

  it('observed max HR (zone model input) is scoped per profile', () => {
    const a = auth.createProfile('A');
    const b = auth.createProfile('B');
    addWorkout(a.id, 1, { hrMax: 190 });
    addWorkout(b.id, 2, { hrMax: 160 });

    expect(hrZones.getObservedMaxHr(db, a.id)).toBe(190);
    expect(hrZones.getObservedMaxHr(db, b.id)).toBe(160);
  });

  it('PB history is computed independently per profile', () => {
    const a = auth.createProfile('A');
    const b = auth.createProfile('B');
    addWorkout(a.id, 1, { distance: 2000, timeMs: 400000 }); // faster 2k
    addWorkout(b.id, 2, { distance: 2000, timeMs: 460000 }); // slower 2k
    analytics.tagAllWorkouts(a.id);
    analytics.tagAllWorkouts(b.id);

    pb.backfillPbHistory(a.id);
    pb.backfillPbHistory(b.id);

    expect(db.prepare('SELECT time_ms FROM pb_history WHERE profile_id = ? AND distance = 2000').get(a.id).time_ms).toBe(400000);
    expect(db.prepare('SELECT time_ms FROM pb_history WHERE profile_id = ? AND distance = 2000').get(b.id).time_ms).toBe(460000);
    // A's faster mark never leaks into B's history.
    expect(db.prepare('SELECT COUNT(*) c FROM pb_history WHERE profile_id = ?').get(b.id).c).toBe(1);
  });

  it('wipeWorkoutData wipes only the target profiles synced data', () => {
    const a = auth.createProfile('A');
    const b = auth.createProfile('B');
    addWorkout(a.id, 1);
    addWorkout(b.id, 2);
    for (const pid of [a.id, b.id]) {
      db.prepare("INSERT INTO pb_history (profile_id, workout_id, distance, pace_ms, time_ms, achieved_at, tag) VALUES (?, ?, 2000, 105000, 420000, '2026-07-01', 'endurance')").run(pid, pid === a.id ? 1 : 2);
      db.prepare("INSERT INTO fitness_log (profile_id, date, fitness) VALUES (?, '2026-07-01', 50)").run(pid);
      db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?)').run(`profile:${pid}:last_sync_completed`, '2026-07-01');
    }

    admin.wipeWorkoutData(db, a.id);

    expect(db.prepare('SELECT COUNT(*) c FROM workouts WHERE profile_id = ?').get(a.id).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM pb_history WHERE profile_id = ?').get(a.id).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM fitness_log WHERE profile_id = ?').get(a.id).c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM sync_state WHERE key = ?').get(`profile:${a.id}:last_sync_completed`).c).toBe(0);

    expect(db.prepare('SELECT COUNT(*) c FROM workouts WHERE profile_id = ?').get(b.id).c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM pb_history WHERE profile_id = ?').get(b.id).c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM fitness_log WHERE profile_id = ?').get(b.id).c).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM sync_state WHERE key = ?').get(`profile:${b.id}:last_sync_completed`).c).toBe(1);
  });

  it('import dedup and fingerprint uniqueness are scoped per profile', () => {
    const a = auth.createProfile('A');
    const b = auth.createProfile('B');
    addWorkout(a.id, -1, { source: 'import', fingerprint: 'fp:0' });

    const wk = { date: '2026-07-01T08:00:00', distance: 2000, time_ms: 420000 };
    expect(dedup.findDuplicate(db, wk, 'fp:0', a.id)?.status).toBe('already_imported');
    // B must not see A's imported row by fingerprint (or by date/distance).
    expect(dedup.findDuplicate(db, wk, 'fp:0', b.id)).toBeNull();
    // The same fingerprint can coexist under a different profile.
    expect(() => addWorkout(b.id, -2, { source: 'import', fingerprint: 'fp:0' })).not.toThrow();
  });

  it('plan matching never links a workout to another profiles plan', () => {
    const a = auth.createProfile('A');
    const b = auth.createProfile('B');
    db.prepare("INSERT INTO planned_workouts (profile_id, date, type, target_distance) VALUES (?, '2026-07-01', 'steady', 2000)").run(a.id);
    addWorkout(b.id, 7, { distance: 2000, timeMs: 420000 }); // same day/distance, other profile
    db.prepare("UPDATE workouts SET inferred_tag = 'endurance' WHERE id = 7").run();

    const matched = planMatching.matchNewWorkouts([7]);

    expect(matched).toBe(0);
    expect(db.prepare('SELECT status FROM planned_workouts WHERE profile_id = ?').get(a.id).status).toBe('planned');
  });
});

describe('profiles route: last-profile deletion guard', () => {
  let db;
  let closeDb;
  let auth;
  let server;
  let base;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-lastprofile-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const dbModule = await import('../src/db.js');
    auth = await import('../src/auth.js');
    const profilesRouter = (await import('../src/routes/profiles.js')).default;
    ({ closeDb } = dbModule);
    db = dbModule.initDb();
    auth.initAuth();

    const app = express();
    app.use(express.json());
    app.use('/api/profiles', profilesRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    closeDb();
  });

  async function del(id) {
    const res = await fetch(`${base}/api/profiles/${id}`, { method: 'DELETE' });
    return res.status;
  }

  it('refuses to delete the only remaining profile', async () => {
    const a = auth.createProfile('A');
    const b = auth.createProfile('B');

    expect(await del(a.id)).toBe(200);          // two → one is fine
    expect(auth.listProfiles().length).toBe(1);

    expect(await del(b.id)).toBe(409);           // one → zero is refused
    expect(auth.listProfiles().length).toBe(1);
    expect(auth.getProfile(b.id)).not.toBeNull();
  });
});


describe('sync auth failure disconnects the profile', () => {
  let db;
  let closeDb;
  let auth;
  let sync;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-authfail-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const dbModule = await import('../src/db.js');
    auth = await import('../src/auth.js');
    sync = await import('../src/sync.js');
    ({ closeDb } = dbModule);
    db = dbModule.initDb();
    auth.initAuth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeDb();
  });

  it('clears the profile connection when Concept2 returns 401 during sync', async () => {
    const p = auth.createProfile('A');
    auth.setProfileIdentity(p.id, { id: 7 });
    // Token valid for an hour, so getValidToken uses it without refreshing.
    auth.storeTokens(p.id, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });
    expect(auth.getProfile(p.id).access_token).not.toBeNull();

    // Every Concept2 call rejects the credentials.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => '', json: async () => ({}) })));

    await sync.runIncrementalSync(p.id);

    // The dead connection is cleared, so the UI shows "not connected" / reconnect.
    const after = auth.getProfile(p.id);
    expect(after.access_token).toBeNull();
    expect(auth.listProfiles().find(x => x.id === p.id).connected).toBe(false);
  });

  it('keeps the connection on a transient (non-401) sync error', async () => {
    const p = auth.createProfile('A');
    auth.setProfileIdentity(p.id, { id: 7 });
    auth.storeTokens(p.id, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });

    // A network-style failure: fetch rejects.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    await sync.runIncrementalSync(p.id);

    // Still connected — a blip must not disconnect the profile.
    expect(auth.getProfile(p.id).access_token).not.toBeNull();
    expect(auth.listProfiles().find(x => x.id === p.id).connected).toBe(true);
  });
});

describe('manual sync requires a connected active profile', () => {
  let db;
  let closeDb;
  let auth;
  let server;
  let base;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ergdash-syncgate-test-'));
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    const dbModule = await import('../src/db.js');
    auth = await import('../src/auth.js');
    const { resolveProfile } = await import('../src/middleware/profile.js');
    const syncRouter = (await import('../src/routes/sync.js')).default;
    ({ closeDb } = dbModule);
    db = dbModule.initDb();
    auth.initAuth();

    const app = express();
    app.use(express.json());
    app.use('/api/sync', resolveProfile, syncRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    closeDb();
  });

  const post = (profileId) => fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { 'X-Profile-Id': String(profileId) },
  });

  it('409s when the active profile has no Concept2 connection', async () => {
    const p = auth.createProfile('Disconnected'); // created but never connected
    const res = await post(p.id);
    expect(res.status).toBe(409);
  });

  it('starts a sync for a connected profile', async () => {
    const p = auth.createProfile('Connected');
    auth.storeTokens(p.id, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });
    const res = await post(p.id);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('started');
  });
});
