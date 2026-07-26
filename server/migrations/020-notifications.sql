-- Notifications: a persistent, per-profile event log plus the Web Push
-- subscriptions to deliver it to. Until now the only user-facing signal was
-- the in-app toast stack, which needs the app open and forgets everything on
-- reload; the sync cron knew about new workouts and PBs and only logged them.
--
-- Ownership note: profile_id is the authorization boundary here, as on every
-- other owner table (see 013-profiles.sql).
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN
                ('plan_reminder','workout_synced','new_pb','missed_session','streak_risk')),
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,                -- in-app route: /session/412, /plan
  dedupe_key  TEXT NOT NULL,       -- 'plan_reminder:2026-07-26', 'workout_synced:412'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT
);

-- The reason the whole system is safe to re-run. Both producers re-scan
-- overlapping windows: the incremental sync deliberately re-reads a 30-day
-- trailing window, and the reminder cron fires hourly and decides at fire
-- time. Every emit is an INSERT OR IGNORE against this index, so a re-sync or
-- a restart never re-notifies.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(profile_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notifications_feed
  ON notifications(profile_id, created_at DESC);

-- One row per browser/device that granted permission. endpoint is the push
-- service URL and is globally unique, so re-subscribing the same device
-- updates in place rather than accumulating duplicates.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  failure_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
  ON push_subscriptions(profile_id);
