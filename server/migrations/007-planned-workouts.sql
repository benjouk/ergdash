CREATE TABLE IF NOT EXISTS planned_workouts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  date                 TEXT NOT NULL,
  type                 TEXT NOT NULL DEFAULT 'steady'
                         CHECK (type IN ('steady','intervals','test','race','other')),
  target_distance      INTEGER,
  target_duration_ms   INTEGER,
  target_pace_ms       INTEGER,
  target_rate          INTEGER,
  notes                TEXT,
  completed_workout_id INTEGER REFERENCES workouts(id) ON DELETE SET NULL,
  match_type           TEXT CHECK (match_type IN ('auto','manual')),
  status               TEXT NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','completed','skipped')),
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_planned_date ON planned_workouts(date);
CREATE INDEX IF NOT EXISTS idx_planned_completed ON planned_workouts(completed_workout_id);
