// Notification emit and delivery.
//
// One entry point, notify(), which persists an event and fans it out to the
// channels that profile has enabled. Everything downstream of the insert is
// best-effort: a dead push endpoint or an unreachable webhook must never fail
// the sync that produced the notification, so every delivery path swallows its
// own errors and logs.
//
// Idempotency lives in the database, not here. Every emit is an INSERT OR
// IGNORE against notifications(profile_id, dedupe_key), because both producers
// re-scan overlapping windows: the incremental sync deliberately re-reads a
// 30-day trailing window (see sync.js), and the schedule below fires hourly and
// decides at fire time. Callers pass a stable dedupe key and stop worrying.
import cron from 'node-cron';
import webpush from 'web-push';
import { getDb, getInstanceSetting, setInstanceSetting } from './db.js';
import { NOTIFY_CHANNELS, NOTIFY_KINDS, TEST_KIND } from './notificationTypes.js';
import { WEBHOOK_FORMATS, buildWebhookRequest } from './webhookFormats.js';
import { formatDistance, formatDuration, formatPace } from './format.js';

const WEBHOOK_TIMEOUT_MS = 5000;
// A push endpoint that returns these is gone for good (unsubscribed, or the
// browser profile was wiped); anything else is treated as transient.
const DEAD_SUBSCRIPTION_STATUSES = new Set([404, 410]);
// Beyond this many new workouts in one sync, notify once with a count instead
// of flooding. A first full sync inserts thousands and is suppressed entirely.
const WORKOUT_FANOUT_LIMIT = 3;

let vapidConfigured = false;

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function settingsFor(profileId) {
  // ESCAPE matters: '_' is a LIKE wildcard, so an unescaped 'notify_%' would
  // also match a future key like 'notifyfoo'.
  const rows = getDb()
    .prepare("SELECT key, value FROM settings WHERE profile_id = ? AND key LIKE ? ESCAPE '\\'")
    .all(profileId, 'notify\\_%');
  const settings = {};
  for (const { key, value } of rows) settings[key] = value;
  return settings;
}

function parseList(raw, allowed, fallback) {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter(item => allowed.includes(item));
  } catch {
    return fallback;
  }
}

export function enabledChannels(profileId) {
  return parseList(settingsFor(profileId).notify_channels, NOTIFY_CHANNELS, ['inapp']);
}

export function enabledKinds(profileId) {
  return parseList(settingsFor(profileId).notify_kinds, NOTIFY_KINDS, NOTIFY_KINDS);
}

function hourSetting(settings, key, fallback) {
  const n = parseInt(settings[key] ?? '', 10);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

export function planReminderHour(profileId) {
  return hourSetting(settingsFor(profileId), 'notify_plan_hour', 7);
}

export function digestHour(profileId) {
  return hourSetting(settingsFor(profileId), 'notify_digest_hour', 20);
}

// ---------------------------------------------------------------------------
// VAPID keys
// ---------------------------------------------------------------------------

// Instance-wide, not per-profile: the keypair identifies this ErgDash server to
// the push services, and rotating it would invalidate every existing
// subscription. Generated once, on first use, and then left alone.
export function getVapidKeys() {
  let publicKey = getInstanceSetting('vapid_public_key');
  let privateKey = getInstanceSetting('vapid_private_key');

  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    setInstanceSetting('vapid_public_key', publicKey);
    setInstanceSetting('vapid_private_key', privateKey);
    console.log('Generated VAPID keypair for Web Push');
  }

  if (!vapidConfigured) {
    // Push services want a contact for the application server. There is no
    // operator email to hand in a self-hosted install, so use a stable mailto
    // that identifies the software.
    webpush.setVapidDetails('mailto:ergdash@localhost', publicKey, privateKey);
    vapidConfigured = true;
  }

  return { publicKey, privateKey };
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

// Returns the stored row, or null when the kind is disabled or the dedupe key
// has already been seen. Delivery is fire-and-forget: callers (the sync path,
// the cron) are synchronous and must not wait on the network.
export function notify(profileId, { kind, title, body = null, link = null, dedupeKey }) {
  if (kind !== TEST_KIND && !NOTIFY_KINDS.includes(kind)) {
    throw new Error(`Unknown notification kind: ${kind}`);
  }
  if (!dedupeKey) throw new Error('notify() requires a dedupeKey');

  const channels = enabledChannels(profileId);
  if (channels.length === 0) return null;
  // A test is requested by hand, so it skips the per-kind subscription filter -
  // but still honours the channels, since that is what it is testing.
  if (kind !== TEST_KIND && !enabledKinds(profileId).includes(kind)) return null;

  // The row is written whatever the channels are: it is what makes delivery
  // idempotent. `inapp` records whether the in-app centre was one of them, so
  // a webhook-only profile does not also collect a bell badge and toasts.
  const info = getDb().prepare(`
    INSERT OR IGNORE INTO notifications (profile_id, kind, title, body, link, dedupe_key, inapp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(profileId, kind, title, body, link, dedupeKey, channels.includes('inapp') ? 1 : 0);

  // Already delivered on an earlier pass - the whole point of the dedupe index.
  if (info.changes === 0) return null;

  const row = getDb()
    .prepare('SELECT * FROM notifications WHERE id = ?')
    .get(info.lastInsertRowid);

  // The in-app centre is served by reading the row back, so it needs no
  // delivery step; push and webhook go out of band.
  if (channels.includes('push')) {
    deliverPush(profileId, row).catch(err => console.error('Push delivery failed:', err));
  }
  if (channels.includes('webhook')) {
    deliverWebhook(profileId, row).catch(err => console.error('Webhook delivery failed:', err));
  }

  return row;
}

// Writes the row behind "Send test" and returns it, without fanning out to
// push or webhook. The test endpoint delivers to those itself so it can await
// each one and report what actually happened; notify()'s fire-and-forget
// delivery would both double-send and hide the outcome.
//
// Each press gets a unique dedupe key, so testing twice gives two rows.
export function recordTestNotification(profileId, now = Date.now()) {
  const inapp = enabledChannels(profileId).includes('inapp');
  const info = getDb().prepare(`
    INSERT INTO notifications (profile_id, kind, title, body, link, dedupe_key, inapp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    profileId,
    TEST_KIND,
    'ErgDash test notification',
    'If you can read this, notifications are working.',
    '/settings',
    `${TEST_KIND}:${now}`,
    inapp ? 1 : 0,
  );

  return getDb().prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export async function deliverPush(profileId, notification) {
  const db = getDb();
  const subscriptions = db
    .prepare('SELECT * FROM push_subscriptions WHERE profile_id = ?')
    .all(profileId);
  if (subscriptions.length === 0) return { sent: 0, pruned: 0 };

  const { publicKey } = getVapidKeys();
  if (!publicKey) return { sent: 0, pruned: 0 };

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    link: notification.link,
    kind: notification.kind,
    id: notification.id,
  });

  let sent = 0;
  let pruned = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload);
      db.prepare(
        "UPDATE push_subscriptions SET last_success_at = datetime('now'), failure_count = 0 WHERE id = ?"
      ).run(subscription.id);
      sent++;
    } catch (err) {
      if (DEAD_SUBSCRIPTION_STATUSES.has(err?.statusCode)) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id);
        pruned++;
      } else {
        db.prepare(
          'UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?'
        ).run(subscription.id);
        console.error(`Push to subscription ${subscription.id} failed:`, err?.message || err);
      }
    }
  }

  return { sent, pruned };
}

export async function deliverWebhook(profileId, notification) {
  const settings = settingsFor(profileId);
  const url = settings.notify_webhook_url;
  if (!url) return { delivered: false };

  // The payload shape is per-target: see webhookFormats.js for why one shape
  // cannot serve them all.
  const format = WEBHOOK_FORMATS.includes(settings.notify_webhook_format)
    ? settings.notify_webhook_format
    : 'json';
  const { headers, body } = buildWebhookRequest(format, notification, {
    appOrigin: process.env.APP_ORIGIN || null,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.error(`Webhook returned ${response.status} for profile ${profileId}`);
    return { delivered: false, status: response.status };
  }
  return { delivered: true, status: response.status };
}

// ---------------------------------------------------------------------------
// Triggers: sync-driven
// ---------------------------------------------------------------------------

// Called from runPostSyncAnalytics() with the ids the sync actually inserted.
// Whether to call it at all is that function's decision - the first full sync
// of a logbook, a manual entry and a file import all opt out there.
export function notifyNewWorkouts(profileId, insertedWorkoutIds = []) {
  if (insertedWorkoutIds.length === 0) return [];

  const placeholders = insertedWorkoutIds.map(() => '?').join(',');
  const workouts = getDb().prepare(`
    SELECT id, date, distance, time_ms, pace_ms
    FROM workouts
    WHERE profile_id = ? AND id IN (${placeholders})
    ORDER BY date DESC, id DESC
  `).all(profileId, ...insertedWorkoutIds);
  if (workouts.length === 0) return [];

  // A backlog upload (several sessions at once) becomes one summary rather
  // than a burst of near-identical pushes.
  if (workouts.length > WORKOUT_FANOUT_LIMIT) {
    const total = workouts.reduce((sum, workout) => sum + (workout.distance || 0), 0);
    const notification = notify(profileId, {
      kind: 'workout_synced',
      title: `${workouts.length} new workouts synced`,
      body: `${formatDistance(total)} total`,
      link: '/workouts',
      // Keyed on the batch, so re-syncing the same window stays quiet.
      dedupeKey: `workout_synced:batch:${workouts.map(w => w.id).sort().join(',')}`,
    });
    return notification ? [notification] : [];
  }

  return workouts
    .map(workout => notify(profileId, {
      kind: 'workout_synced',
      title: `New workout: ${formatDistance(workout.distance)}`,
      body: describeWorkout(workout),
      link: `/session/${workout.id}`,
      dedupeKey: `workout_synced:${workout.id}`,
    }))
    .filter(Boolean);
}

function describeWorkout(workout) {
  const parts = [];
  if (workout.time_ms > 0) parts.push(formatDuration(workout.time_ms));
  if (workout.pace_ms > 0) parts.push(`${formatPace(workout.pace_ms)}/500m`);
  return parts.join(' · ') || null;
}

// pbEvents is the array detectNewPbs() already returns from the sync path:
// { workout_id, distance, pace_ms, time_ms, achieved_at, tag }.
export function notifyNewPbs(profileId, pbEvents = []) {
  return pbEvents
    .map(event => notify(profileId, {
      kind: 'new_pb',
      title: `New ${formatDistance(event.distance)} PB`,
      body: `${formatDuration(event.time_ms)} · ${formatPace(event.pace_ms)}/500m`,
      link: `/session/${event.workout_id}`,
      dedupeKey: `new_pb:${event.workout_id}:${event.distance}`,
    }))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Triggers: schedule-driven
// ---------------------------------------------------------------------------

// The server's local calendar date.
//
// Deliberately not toISOString().slice(0,10), which is UTC. Reminders fire on
// the local clock, so pairing a local hour with a UTC date gets the wrong day
// for most of the world: a 07:00 reminder in UTC+12 would look up yesterday's
// plans, and a 20:00 digest anywhere in the Americas tomorrow's. Plans are
// authored against the user's local calendar, so that is what to match.
export function today(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function planSummary(plan) {
  if (plan.target_distance > 0) return formatDistance(plan.target_distance);
  if (plan.target_duration_ms > 0) return formatDuration(plan.target_duration_ms);
  return plan.type;
}

export function notifyPlanReminders(profileId, date = today()) {
  const plans = getDb().prepare(`
    SELECT id, type, target_distance, target_duration_ms, notes
    FROM planned_workouts
    WHERE profile_id = ? AND date = ? AND status = 'planned'
    ORDER BY id ASC
  `).all(profileId, date);
  if (plans.length === 0) return null;

  const summary = plans.map(planSummary).join(', ');
  return notify(profileId, {
    kind: 'plan_reminder',
    title: plans.length === 1 ? `Today's session: ${summary}` : `${plans.length} sessions planned today`,
    body: plans.length === 1 ? (plans[0].notes || null) : summary,
    link: '/plan',
    dedupeKey: `plan_reminder:${date}`,
  });
}

// End-of-day nudge. "Missed" is derived the same way adherenceOf() derives it
// in routes/plans.js: still 'planned' once the day is behind you.
export function notifyMissedSessions(profileId, date = today()) {
  const plans = getDb().prepare(`
    SELECT id, type, target_distance, target_duration_ms
    FROM planned_workouts
    WHERE profile_id = ? AND date = ? AND status = 'planned'
    ORDER BY id ASC
  `).all(profileId, date);
  if (plans.length === 0) return null;

  const summary = plans.map(planSummary).join(', ');
  return notify(profileId, {
    kind: 'missed_session',
    title: plans.length === 1 ? 'Session still unlogged' : `${plans.length} sessions still unlogged`,
    body: `${summary} — still open for today`,
    link: '/plan',
    dedupeKey: `missed_session:${date}`,
  });
}

// The Dashboard streak counts *weeks* with at least one row (computeWeekStreak
// in analytics.js), so the streak is at risk on the last day of a week with
// nothing logged in it. Weeks start Monday, matching that function.
export function mondayOf(date) {
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export function notifyStreakRisk(profileId, date = today()) {
  // Sunday only: any earlier and the week is still comfortably rescuable.
  if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 0) return null;

  const weekStart = mondayOf(date);
  const logged = getDb().prepare(`
    SELECT COUNT(*) AS c FROM workouts
    WHERE profile_id = ? AND type = 'rower' AND date(date) BETWEEN ? AND ?
  `).get(profileId, weekStart, date).c;
  if (logged > 0) return null;

  // Nothing to protect if there was no streak to begin with.
  const everLogged = getDb()
    .prepare("SELECT COUNT(*) AS c FROM workouts WHERE profile_id = ? AND type = 'rower'")
    .get(profileId).c;
  if (everLogged === 0) return null;

  return notify(profileId, {
    kind: 'streak_risk',
    title: 'Streak at risk',
    body: 'Nothing logged this week yet — a row today keeps the streak alive.',
    link: '/',
    dedupeKey: `streak_risk:${weekStart}`,
  });
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export function runNotificationSchedule(now = new Date()) {
  const hour = now.getHours();
  const date = today(now);
  const results = [];

  for (const { id } of getDb().prepare('SELECT id FROM profiles').all()) {
    try {
      if (hour === planReminderHour(id)) {
        if (notifyPlanReminders(id, date)) results.push({ profileId: id, kind: 'plan_reminder' });
      }
      if (hour === digestHour(id)) {
        if (notifyMissedSessions(id, date)) results.push({ profileId: id, kind: 'missed_session' });
        if (notifyStreakRisk(id, date)) results.push({ profileId: id, kind: 'streak_risk' });
      }
    } catch (err) {
      console.error(`Notification schedule failed for profile ${id}:`, err);
    }
  }

  return results;
}

export function startNotificationSchedule() {
  // Fire every hour on the hour and decide then, so changing the reminder or
  // digest hour in Settings takes effect without a restart. Same shape as
  // startBackupSchedule().
  //
  // Both the hour and the date come from the server's local clock, so set TZ
  // in the container. Note this only fires while the process is running: a
  // server down across the reminder hour skips that day rather than sending
  // late.
  cron.schedule('0 * * * *', () => {
    const fired = runNotificationSchedule();
    if (fired.length > 0) {
      console.log(`[cron] Sent ${fired.length} notification${fired.length === 1 ? '' : 's'}`);
    }
  });

  console.log('Notifications scheduled: hourly check for plan reminders and end-of-day digests');
}
