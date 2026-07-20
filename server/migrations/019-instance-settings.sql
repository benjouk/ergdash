-- Instance-wide key/value settings, as opposed to the per-profile `settings`
-- table. First use: automatic backup preferences, which apply to the whole
-- database rather than any one household member.
CREATE TABLE IF NOT EXISTS instance_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
