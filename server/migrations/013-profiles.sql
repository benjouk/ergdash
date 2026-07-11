-- Multi-profile (household) support. Each profile is one household member
-- with their own Concept2 logbook connection; tokens move out of the global
-- sync_state keys into per-profile columns.
--
-- Ownership note: profile_id is the ErgDash authorization boundary on every
-- owner table. workouts.user_id remains the raw Concept2 user id (source
-- identity only) — routes must never authorize by it.

CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  c2_user_id INTEGER UNIQUE,          -- Concept2 logbook user id, null until connected
  user_info TEXT,                     -- JSON blob from /api/users/me
  access_token TEXT,                  -- AES-GCM encrypted (enc:v1:)
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed profile 1 from the legacy single-user install, but only when legacy
-- data exists. Fresh installs start with zero profiles and create the first
-- one through the OAuth connect flow.
INSERT INTO profiles (id, name, c2_user_id, user_info, access_token, refresh_token, token_expires_at)
SELECT 1,
  COALESCE(
    json_extract((SELECT value FROM sync_state WHERE key = 'user_info'), '$.first_name'),
    json_extract((SELECT value FROM sync_state WHERE key = 'user_info'), '$.username'),
    'Athlete'),
  json_extract((SELECT value FROM sync_state WHERE key = 'user_info'), '$.id'),
  (SELECT value FROM sync_state WHERE key = 'user_info'),
  (SELECT value FROM sync_state WHERE key = 'access_token'),
  (SELECT value FROM sync_state WHERE key = 'refresh_token'),
  (SELECT value FROM sync_state WHERE key = 'token_expires_at')
WHERE EXISTS (SELECT 1 FROM sync_state WHERE key = 'access_token')
   OR EXISTS (SELECT 1 FROM workouts)
   OR EXISTS (SELECT 1 FROM goals)
   OR EXISTS (SELECT 1 FROM planned_workouts);

-- Owner tables gain profile_id. SQLite cannot ADD COLUMN with NOT NULL +
-- REFERENCES, so the column is nullable and app-enforced. workouts is not
-- rebuilt because seven tables FK into it.
ALTER TABLE workouts         ADD COLUMN profile_id INTEGER;
ALTER TABLE pb_history       ADD COLUMN profile_id INTEGER;
ALTER TABLE goals            ADD COLUMN profile_id INTEGER;
ALTER TABLE planned_workouts ADD COLUMN profile_id INTEGER;
ALTER TABLE programs         ADD COLUMN profile_id INTEGER;

UPDATE workouts         SET profile_id = 1 WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
UPDATE pb_history       SET profile_id = 1 WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
UPDATE goals            SET profile_id = 1 WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
UPDATE planned_workouts SET profile_id = 1 WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
UPDATE programs         SET profile_id = 1 WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);

CREATE INDEX idx_workouts_profile ON workouts(profile_id, date DESC);
CREATE INDEX idx_pb_history_profile ON pb_history(profile_id, distance);
CREATE INDEX idx_goals_profile ON goals(profile_id);
CREATE INDEX idx_planned_profile ON planned_workouts(profile_id, date);
CREATE INDEX idx_programs_profile ON programs(profile_id);

-- Uniqueness that was global becomes per-profile.
DROP INDEX IF EXISTS idx_goals_active_volume;
CREATE UNIQUE INDEX idx_goals_active_volume
  ON goals(profile_id, period) WHERE kind = 'volume' AND active = 1;

DROP INDEX IF EXISTS idx_workouts_import_fp;
CREATE UNIQUE INDEX idx_workouts_import_fp
  ON workouts(profile_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL;

-- fitness_log / predictions / settings carry per-profile UNIQUE constraints,
-- so they are rebuilt (small tables, no incoming FKs).
CREATE TABLE fitness_log_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL,
  date            TEXT NOT NULL,
  fitness         REAL,
  fatigue         REAL,
  form            REAL,
  computed_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(profile_id, date)
);
INSERT INTO fitness_log_new (profile_id, date, fitness, fatigue, form, computed_at)
  SELECT 1, date, fitness, fatigue, form, computed_at FROM fitness_log
  WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
DROP TABLE fitness_log;
ALTER TABLE fitness_log_new RENAME TO fitness_log;
CREATE INDEX idx_fitness_date ON fitness_log(profile_id, date);

CREATE TABLE predictions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL,
  distance        INTEGER NOT NULL,
  predicted_time  INTEGER,
  confidence      REAL,
  window_start    TEXT,
  window_end      TEXT,
  computed_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(profile_id, distance)
);
INSERT INTO predictions_new (profile_id, distance, predicted_time, confidence, window_start, window_end, computed_at)
  SELECT 1, distance, predicted_time, confidence, window_start, window_end, computed_at FROM predictions
  WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
DROP TABLE predictions;
ALTER TABLE predictions_new RENAME TO predictions;

-- All settings become per-profile (physiological ones must be; keeping the
-- cosmetic ones per-profile too keeps a single code path). Existing values
-- are copied to profile 1 before defaults, so customized values win.
CREATE TABLE settings_new (
  profile_id      INTEGER NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  PRIMARY KEY (profile_id, key)
);
INSERT INTO settings_new (profile_id, key, value)
  SELECT 1, key, value FROM settings
  WHERE EXISTS (SELECT 1 FROM profiles WHERE id = 1);
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- Per-profile sync cursors: namespaced keys.
UPDATE sync_state SET key = 'profile:1:' || key
 WHERE key IN ('last_sync_completed', 'sync_status', 'sync_progress', 'last_enriched_workout_id')
   AND EXISTS (SELECT 1 FROM profiles WHERE id = 1);

-- Tokens and user info now live on profiles; oauth_state becomes per-flow rows.
DELETE FROM sync_state
 WHERE key IN ('access_token', 'refresh_token', 'token_expires_at', 'user_info', 'oauth_state');
