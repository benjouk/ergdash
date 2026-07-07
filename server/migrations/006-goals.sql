CREATE TABLE IF NOT EXISTS goals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL CHECK (kind IN ('volume','performance')),
  -- volume goals
  period         TEXT CHECK (period IN ('weekly','monthly','season','year')),
  target_meters  INTEGER,
  -- performance goals
  distance       INTEGER,
  target_time_ms INTEGER,
  race_date      TEXT,
  label          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  achieved_at    TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT
);

-- One active volume goal per period keeps progress overlays unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_active_volume
  ON goals(period) WHERE kind = 'volume' AND active = 1;
CREATE INDEX IF NOT EXISTS idx_goals_active ON goals(active) WHERE active = 1;

-- The legacy annual goal lived in settings; it becomes a year-period volume
-- goal so all goals have one home.
INSERT INTO goals (kind, period, target_meters)
  SELECT 'volume', 'year', CAST(value AS INTEGER)
  FROM settings
  WHERE key = 'annual_goal_m' AND CAST(value AS INTEGER) > 0;

DELETE FROM settings WHERE key = 'annual_goal_m';
