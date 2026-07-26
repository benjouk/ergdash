import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

let dataDir;
let db;
let closeDb;
let notifications;
let server;
let base;
// Set by the express test app; lets a single test flip which profile the
// notification routes believe they are acting for.
let activeProfileId;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-notifications-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();

  const dbModule = await import('../src/db.js');
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
  db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Housemate')").run();
  dbModule.seedDefaultSettings(db, 1);
  dbModule.seedDefaultSettings(db, 2);

  notifications = await import('../src/notifications.js');
  const notificationsRouter = (await import('../src/routes/notifications.js')).default;

  activeProfileId = 1;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.profileId = activeProfileId; next(); });
  app.use('/api/notifications', notificationsRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function setSetting(profileId, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (profile_id, key, value) VALUES (?, ?, ?)')
    .run(profileId, key, value);
}

function insertWorkout({ id, profileId = 1, date, distance, timeMs, paceMs }) {
  db.prepare(`
    INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, pace_ms, synced_at)
    VALUES (?, ?, 0, ?, 'rower', 'FixedDistanceSplits', ?, ?, ?, datetime('now'))
  `).run(id, profileId, date, distance, timeMs, paceMs);
}

function insertPlan({ profileId = 1, date, distance = 5000, status = 'planned' }) {
  db.prepare(`
    INSERT INTO planned_workouts (profile_id, date, type, target_distance, status)
    VALUES (?, ?, 'steady', ?, ?)
  `).run(profileId, date, distance, status);
}

function storedFor(profileId) {
  return db.prepare('SELECT * FROM notifications WHERE profile_id = ? ORDER BY id').all(profileId);
}

describe('notify()', () => {
  it('stores a notification and returns the row', () => {
    const row = notifications.notify(1, {
      kind: 'new_pb',
      title: 'New 2k PB',
      body: '6:48.2',
      link: '/session/7',
      dedupeKey: 'new_pb:7:2000',
    });

    expect(row).toMatchObject({ profile_id: 1, kind: 'new_pb', title: 'New 2k PB' });
    expect(storedFor(1)).toHaveLength(1);
  });

  it('ignores a repeat of the same dedupe key', () => {
    const emit = () => notifications.notify(1, {
      kind: 'new_pb', title: 'New 2k PB', dedupeKey: 'new_pb:7:2000',
    });

    expect(emit()).not.toBeNull();
    expect(emit()).toBeNull();
    expect(storedFor(1)).toHaveLength(1);
  });

  it('dedupes per profile, not globally', () => {
    const emit = profileId => notifications.notify(profileId, {
      kind: 'new_pb', title: 'New 2k PB', dedupeKey: 'new_pb:7:2000',
    });

    expect(emit(1)).not.toBeNull();
    expect(emit(2)).not.toBeNull();
    expect(storedFor(1)).toHaveLength(1);
    expect(storedFor(2)).toHaveLength(1);
  });

  it('drops kinds the profile has switched off', () => {
    setSetting(1, 'notify_kinds', JSON.stringify(['plan_reminder']));

    const row = notifications.notify(1, {
      kind: 'new_pb', title: 'New 2k PB', dedupeKey: 'new_pb:7:2000',
    });

    expect(row).toBeNull();
    expect(storedFor(1)).toHaveLength(0);
  });

  it('drops everything when no channel is enabled', () => {
    setSetting(1, 'notify_channels', JSON.stringify([]));

    const row = notifications.notify(1, {
      kind: 'new_pb', title: 'New 2k PB', dedupeKey: 'new_pb:7:2000',
    });

    expect(row).toBeNull();
    expect(storedFor(1)).toHaveLength(0);
  });

  it('rejects an unknown kind', () => {
    expect(() => notifications.notify(1, {
      kind: 'nonsense', title: 'x', dedupeKey: 'x',
    })).toThrow(/Unknown notification kind/);
  });
});

describe('webhook delivery', () => {
  it('posts the notification to the configured URL', async () => {
    setSetting(1, 'notify_webhook_url', 'https://ntfy.example/ergdash');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await notifications.deliverWebhook(1, {
      kind: 'new_pb', title: 'New 2k PB', body: '6:48.2', link: '/session/7',
      created_at: '2026-07-26 09:00:00',
    });

    expect(result).toEqual({ delivered: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ntfy.example/ergdash');
    expect(JSON.parse(options.body)).toMatchObject({ title: 'New 2k PB', message: '6:48.2' });

    vi.unstubAllGlobals();
  });

  it('does nothing when no webhook URL is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await notifications.deliverWebhook(1, { title: 'x' })).toEqual({ delivered: false });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('notifyNewWorkouts()', () => {
  it('sends one notification per workout for a small batch', () => {
    insertWorkout({ id: 11, date: '2026-07-26', distance: 6000, timeMs: 1_440_000, paceMs: 120_000 });
    insertWorkout({ id: 12, date: '2026-07-25', distance: 2000, timeMs: 408_000, paceMs: 102_000 });

    const sent = notifications.notifyNewWorkouts(1, [11, 12]);

    expect(sent).toHaveLength(2);
    expect(sent[0].title).toBe('New workout: 6 km');
    expect(sent[0].link).toBe('/session/11');
    expect(sent[0].body).toContain('/500m');
  });

  it('collapses a large batch into a single summary', () => {
    const ids = [];
    for (let i = 0; i < 6; i++) {
      insertWorkout({ id: 20 + i, date: '2026-07-2' + i, distance: 5000, timeMs: 1_200_000, paceMs: 120_000 });
      ids.push(20 + i);
    }

    const sent = notifications.notifyNewWorkouts(1, ids);

    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('6 new workouts synced');
    expect(sent[0].link).toBe('/workouts');
  });

  it('does nothing when the sync inserted no rows', () => {
    expect(notifications.notifyNewWorkouts(1, [])).toEqual([]);
    expect(storedFor(1)).toHaveLength(0);
  });

  it('does not re-notify when the same ids are seen again', () => {
    insertWorkout({ id: 11, date: '2026-07-26', distance: 6000, timeMs: 1_440_000, paceMs: 120_000 });

    expect(notifications.notifyNewWorkouts(1, [11])).toHaveLength(1);
    expect(notifications.notifyNewWorkouts(1, [11])).toHaveLength(0);
    expect(storedFor(1)).toHaveLength(1);
  });
});

describe('notifyNewPbs()', () => {
  it('formats the PB distance, time and pace', () => {
    const sent = notifications.notifyNewPbs(1, [
      { workout_id: 7, distance: 2000, pace_ms: 102_000, time_ms: 408_000, achieved_at: '2026-07-26' },
    ]);

    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe('New 2 km PB');
    expect(sent[0].body).toBe('6:48.0 · 1:42.0/500m');
    expect(sent[0].link).toBe('/session/7');
  });
});

describe('notifyPlanReminders()', () => {
  it('names the session when exactly one is planned', () => {
    insertPlan({ date: '2026-07-26', distance: 10000 });

    const row = notifications.notifyPlanReminders(1, '2026-07-26');

    expect(row.title).toBe("Today's session: 10 km");
    expect(row.link).toBe('/plan');
  });

  it('counts them when several are planned', () => {
    insertPlan({ date: '2026-07-26', distance: 5000 });
    insertPlan({ date: '2026-07-26', distance: 2000 });

    expect(notifications.notifyPlanReminders(1, '2026-07-26').title)
      .toBe('2 sessions planned today');
  });

  it('says nothing on a rest day', () => {
    insertPlan({ date: '2026-07-27', distance: 5000 });

    expect(notifications.notifyPlanReminders(1, '2026-07-26')).toBeNull();
  });

  it('ignores sessions that are already completed', () => {
    insertPlan({ date: '2026-07-26', distance: 5000, status: 'completed' });

    expect(notifications.notifyPlanReminders(1, '2026-07-26')).toBeNull();
  });

  it('does not leak another profile\'s plans', () => {
    insertPlan({ profileId: 2, date: '2026-07-26', distance: 5000 });

    expect(notifications.notifyPlanReminders(1, '2026-07-26')).toBeNull();
    expect(notifications.notifyPlanReminders(2, '2026-07-26')).not.toBeNull();
  });
});

describe('notifyMissedSessions()', () => {
  it('nudges when the day\'s plan is still open', () => {
    insertPlan({ date: '2026-07-26', distance: 5000 });

    expect(notifications.notifyMissedSessions(1, '2026-07-26').title)
      .toBe('Session still unlogged');
  });

  it('stays quiet once the plan is matched', () => {
    insertPlan({ date: '2026-07-26', distance: 5000, status: 'completed' });

    expect(notifications.notifyMissedSessions(1, '2026-07-26')).toBeNull();
  });
});

describe('notifyStreakRisk()', () => {
  // 2026-07-26 is a Sunday; 2026-07-20 is the Monday that starts its week.
  it('fires on a Sunday with nothing logged that week', () => {
    insertWorkout({ id: 1, date: '2026-07-12', distance: 5000, timeMs: 1_200_000, paceMs: 120_000 });

    const row = notifications.notifyStreakRisk(1, '2026-07-26');

    expect(row.title).toBe('Streak at risk');
    expect(row.link).toBe('/');
  });

  it('stays quiet when the week already has a workout', () => {
    insertWorkout({ id: 1, date: '2026-07-22', distance: 5000, timeMs: 1_200_000, paceMs: 120_000 });

    expect(notifications.notifyStreakRisk(1, '2026-07-26')).toBeNull();
  });

  it('only fires on a Sunday', () => {
    insertWorkout({ id: 1, date: '2026-07-12', distance: 5000, timeMs: 1_200_000, paceMs: 120_000 });

    expect(notifications.notifyStreakRisk(1, '2026-07-25')).toBeNull();
  });

  it('stays quiet for a profile that has never logged anything', () => {
    expect(notifications.notifyStreakRisk(1, '2026-07-26')).toBeNull();
  });

  it('starts weeks on Monday', () => {
    expect(notifications.mondayOf('2026-07-26')).toBe('2026-07-20');
    expect(notifications.mondayOf('2026-07-20')).toBe('2026-07-20');
  });
});

// The gating that decides whether a sync announces itself lives in
// runPostSyncAnalytics, so exercise it there rather than trusting the flags.
describe('runPostSyncAnalytics() notification gating', () => {
  let runPostSyncAnalytics;

  beforeEach(async () => {
    ({ runPostSyncAnalytics } = await import('../src/sync.js'));
  });

  it('announces workouts a background sync inserted', () => {
    insertWorkout({ id: 11, date: '2026-07-26', distance: 6000, timeMs: 1_440_000, paceMs: 120_000 });

    runPostSyncAnalytics(1, [11], [], []);

    expect(storedFor(1).map(row => row.kind)).toContain('workout_synced');
  });

  // A manual entry and a file import both pass notifySynced: false - the user
  // is already looking at the result of the thing they just did.
  it('stays quiet when the caller opts out', () => {
    insertWorkout({ id: 11, date: '2026-07-26', distance: 6000, timeMs: 1_440_000, paceMs: 120_000 });

    runPostSyncAnalytics(1, [11], [], [], { notifySynced: false });

    expect(storedFor(1).map(row => row.kind)).not.toContain('workout_synced');
  });
});

describe('runNotificationSchedule()', () => {
  it('fires plan reminders only in the configured hour', () => {
    const date = new Date().toISOString().slice(0, 10);
    insertPlan({ date, distance: 5000 });
    setSetting(1, 'notify_plan_hour', '7');
    setSetting(2, 'notify_plan_hour', '7');

    const atSix = new Date();
    atSix.setHours(6);
    expect(notifications.runNotificationSchedule(atSix)).toEqual([]);

    const atSeven = new Date();
    atSeven.setHours(7);
    expect(notifications.runNotificationSchedule(atSeven))
      .toEqual([{ profileId: 1, kind: 'plan_reminder' }]);
  });

  it('honours a per-profile reminder hour', () => {
    const date = new Date().toISOString().slice(0, 10);
    insertPlan({ profileId: 1, date, distance: 5000 });
    insertPlan({ profileId: 2, date, distance: 5000 });
    setSetting(1, 'notify_plan_hour', '7');
    setSetting(2, 'notify_plan_hour', '9');

    const atNine = new Date();
    atNine.setHours(9);
    expect(notifications.runNotificationSchedule(atNine))
      .toEqual([{ profileId: 2, kind: 'plan_reminder' }]);
  });
});

describe('GET /api/notifications', () => {
  it('lists newest first with an unread count', async () => {
    notifications.notify(1, { kind: 'new_pb', title: 'First', dedupeKey: 'a' });
    notifications.notify(1, { kind: 'new_pb', title: 'Second', dedupeKey: 'b' });

    const res = await fetch(`${base}/api/notifications`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unread_count).toBe(2);
    expect(body.notifications.map(n => n.title)).toEqual(['Second', 'First']);
    expect(body.notifications[0].read).toBe(false);
  });

  it('never returns another profile\'s notifications', async () => {
    notifications.notify(2, { kind: 'new_pb', title: 'Housemate PB', dedupeKey: 'a' });

    const body = await (await fetch(`${base}/api/notifications`)).json();

    expect(body.notifications).toEqual([]);
    expect(body.unread_count).toBe(0);
  });
});

describe('marking notifications read', () => {
  it('marks everything read for the profile', async () => {
    notifications.notify(1, { kind: 'new_pb', title: 'First', dedupeKey: 'a' });
    notifications.notify(1, { kind: 'new_pb', title: 'Second', dedupeKey: 'b' });

    const res = await fetch(`${base}/api/notifications/read`, { method: 'POST' });

    expect(await res.json()).toEqual({ marked: 2 });
    const body = await (await fetch(`${base}/api/notifications`)).json();
    expect(body.unread_count).toBe(0);
  });

  it('marks a single notification read', async () => {
    const row = notifications.notify(1, { kind: 'new_pb', title: 'First', dedupeKey: 'a' });

    const res = await fetch(`${base}/api/notifications/${row.id}/read`, { method: 'POST' });

    expect(await res.json()).toEqual({ marked: 1 });
  });

  it('404s on another profile\'s notification instead of marking it', async () => {
    const row = notifications.notify(2, { kind: 'new_pb', title: 'Housemate', dedupeKey: 'a' });

    const res = await fetch(`${base}/api/notifications/${row.id}/read`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(row.id).read_at)
      .toBeNull();
  });
});

describe('push subscriptions', () => {
  const subscription = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  };

  it('stores a subscription', async () => {
    const res = await fetch(`${base}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    expect(await res.json()).toEqual({ subscribed: true });
    const rows = db.prepare('SELECT * FROM push_subscriptions').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile_id: 1, endpoint: subscription.endpoint });
  });

  it('moves an existing endpoint to the profile that re-subscribed it', async () => {
    const post = () => fetch(`${base}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    await post();
    activeProfileId = 2;
    await post();

    const rows = db.prepare('SELECT * FROM push_subscriptions').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].profile_id).toBe(2);
  });

  it('rejects a subscription without an https endpoint', async () => {
    const res = await fetch(`${base}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'ftp://nope', keys: subscription.keys }),
    });

    expect(res.status).toBe(400);
  });

  it('removes a subscription on unsubscribe', async () => {
    await fetch(`${base}/api/notifications/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    const res = await fetch(`${base}/api/notifications/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });

    expect(await res.json()).toEqual({ unsubscribed: true });
    expect(db.prepare('SELECT * FROM push_subscriptions').all()).toHaveLength(0);
  });

  it('serves a VAPID public key and reuses it across calls', async () => {
    const first = await (await fetch(`${base}/api/notifications/vapid-key`)).json();
    const second = await (await fetch(`${base}/api/notifications/vapid-key`)).json();

    expect(first.public_key).toBeTruthy();
    expect(second.public_key).toBe(first.public_key);
  });
});
