CREATE TABLE IF NOT EXISTS hr_zone_time (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    zone        INTEGER NOT NULL CHECK (zone BETWEEN 1 AND 5),
    time_s      REAL NOT NULL,
    source      TEXT NOT NULL DEFAULT 'strokes',
    UNIQUE(workout_id, zone)
);
CREATE INDEX IF NOT EXISTS idx_zone_time_workout ON hr_zone_time(workout_id);

CREATE TABLE IF NOT EXISTS best_efforts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id   INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    duration_s   INTEGER NOT NULL,
    avg_watts    REAL NOT NULL,
    avg_pace_ms  INTEGER,
    start_time_s REAL,
    UNIQUE(workout_id, duration_s)
);
CREATE INDEX IF NOT EXISTS idx_best_efforts_duration ON best_efforts(duration_s);
CREATE INDEX IF NOT EXISTS idx_best_efforts_workout ON best_efforts(workout_id);
