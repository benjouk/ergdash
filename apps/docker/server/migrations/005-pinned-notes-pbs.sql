-- pinned/notes are user-owned columns; sync must never overwrite them.
ALTER TABLE workouts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workouts ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_workouts_pinned ON workouts(pinned) WHERE pinned = 1;

CREATE TABLE IF NOT EXISTS pb_history (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id),
  distance INTEGER NOT NULL,
  pace_ms REAL NOT NULL,
  time_ms INTEGER NOT NULL,
  achieved_at TEXT NOT NULL
);
