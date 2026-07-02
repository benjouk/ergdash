ALTER TABLE computed_metrics ADD COLUMN distance_per_stroke REAL;
ALTER TABLE computed_metrics ADD COLUMN watts_per_beat REAL;
ALTER TABLE computed_metrics ADD COLUMN hr_drift_pct REAL;
ALTER TABLE computed_metrics ADD COLUMN rate_discipline REAL;
ALTER TABLE computed_metrics ADD COLUMN hr_recovery_avg REAL;
ALTER TABLE computed_metrics ADD COLUMN metrics_version INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS interval_recoveries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id    INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    rep_index     INTEGER NOT NULL,
    hr_end        INTEGER,
    hr_next_start INTEGER,
    drop_bpm      INTEGER,
    rest_s        REAL,
    UNIQUE(workout_id, rep_index)
);
CREATE INDEX IF NOT EXISTS idx_recoveries_workout ON interval_recoveries(workout_id);
