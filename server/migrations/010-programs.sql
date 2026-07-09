-- Training programs: a user starts a preset (Pete Plan, 2k prep, ...) which
-- materialises into ordinary planned_workouts rows tagged with program_id.
-- Preset definitions live in code (server/src/programPresets.js); only the
-- user's chosen instance is stored here. One active-or-paused program at a
-- time is enforced in the route, not the schema.
CREATE TABLE IF NOT EXISTS programs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  start_date     TEXT NOT NULL,          -- date of the first generated session
  duration_weeks INTEGER NOT NULL,
  training_days  TEXT NOT NULL,          -- JSON array of ints, 0=Mon..6=Sun, sorted
  race_date      TEXT,                   -- race-anchored presets only
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','paused')),
  paused_at      TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT
);

-- Link generated sessions back to their program. ON DELETE SET NULL keeps
-- completed/past history rows on the calendar as ordinary plans if the
-- program is deleted.
ALTER TABLE planned_workouts ADD COLUMN program_id INTEGER
  REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE planned_workouts ADD COLUMN program_week INTEGER;  -- 0-based
ALTER TABLE planned_workouts ADD COLUMN program_slot INTEGER;  -- 0-based within the week

CREATE INDEX IF NOT EXISTS idx_planned_program
  ON planned_workouts(program_id, program_week, program_slot);
CREATE INDEX IF NOT EXISTS idx_programs_status ON programs(status);
