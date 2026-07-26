-- Adds 'test' to the notifications.kind CHECK constraint.
--
-- "Send test" claimed the in-app centre had shown something while storing no
-- row at all, so it could not actually verify the bell and feed wiring - the
-- one thing an in-app test exists to prove. It now writes a real notification,
-- which needs a kind the constraint accepts.
--
-- 'test' is deliberately not in NOTIFY_KINDS: it is not a trigger anyone
-- subscribes to, so it never appears in Settings' "What to notify" list and
-- bypasses that filter when sent.
--
-- SQLite cannot alter a CHECK in place, so the table is rebuilt. No other
-- table references notifications, and the indexes are recreated below.

CREATE TABLE notifications_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN
                ('plan_reminder','workout_synced','new_pb','missed_session','streak_risk','test')),
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  dedupe_key  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  read_at     TEXT,
  inapp       INTEGER NOT NULL DEFAULT 1
);

INSERT INTO notifications_new
  (id, profile_id, kind, title, body, link, dedupe_key, created_at, read_at, inapp)
  SELECT id, profile_id, kind, title, body, link, dedupe_key, created_at, read_at, inapp
  FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(profile_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notifications_feed
  ON notifications(profile_id, created_at DESC);
