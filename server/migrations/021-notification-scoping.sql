-- Two corrections to the notification tables.
--
-- 1. push_subscriptions.endpoint was globally UNIQUE, which made a browser's
--    push endpoint belong to exactly one profile. On a shared browser,
--    enabling push for a second household member silently stole the endpoint
--    from the first: their settings still read "on" while they received
--    nothing. A subscription is per browser *and* per profile, so that is what
--    the key should be. Both rows point at the same endpoint and each profile's
--    notifications reach the device, matching how ErgDash already treats
--    profiles as data partitions on a shared session rather than as security
--    principals.
--
-- 2. notifications gains `inapp`, recording whether the in-app centre was an
--    enabled channel when the row was written. The row itself has to exist
--    either way - it is what makes delivery idempotent, via the dedupe index -
--    but a profile delivering only to a webhook should not also get a bell
--    badge and a toast.

CREATE TABLE push_subscriptions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL,
  endpoint        TEXT NOT NULL,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(endpoint, profile_id)
);

INSERT INTO push_subscriptions_new
  (id, profile_id, endpoint, p256dh, auth, user_agent, created_at, last_success_at, failure_count)
  SELECT id, profile_id, endpoint, p256dh, auth, user_agent, created_at, last_success_at, failure_count
  FROM push_subscriptions;

DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
  ON push_subscriptions(profile_id);
-- Revoking a dead endpoint has to clear it for every profile that used it.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);

ALTER TABLE notifications ADD COLUMN inapp INTEGER NOT NULL DEFAULT 1;
