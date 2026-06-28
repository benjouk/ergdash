CREATE TABLE IF NOT EXISTS workouts (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    date            TEXT NOT NULL,
    timezone        TEXT,
    type            TEXT NOT NULL,
    workout_type    TEXT NOT NULL,
    inferred_tag    TEXT,
    distance        INTEGER NOT NULL,
    time_ms         INTEGER NOT NULL,
    pace_ms         INTEGER,
    stroke_rate     REAL,
    stroke_count    INTEGER,
    calories        INTEGER,
    heart_rate_avg  INTEGER,
    heart_rate_max  INTEGER,
    drag_factor     INTEGER,
    comments        TEXT,
    rest_distance   INTEGER,
    rest_time_ms    INTEGER,
    has_stroke_data INTEGER DEFAULT 0,
    raw_json        TEXT,
    synced_at       TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intervals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    interval_index  INTEGER NOT NULL,
    type            TEXT,
    distance        INTEGER,
    time_ms         INTEGER,
    pace_ms         INTEGER,
    stroke_rate     REAL,
    stroke_count    INTEGER,
    calories        INTEGER,
    heart_rate_avg  INTEGER,
    heart_rate_max  INTEGER,
    UNIQUE(workout_id, interval_index)
);

CREATE TABLE IF NOT EXISTS strokes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    stroke_number   INTEGER NOT NULL,
    time_s          REAL,
    distance_m      REAL,
    pace_ms         INTEGER,
    watts           REAL,
    cal_hr          REAL,
    stroke_rate     REAL,
    heart_rate      INTEGER,
    UNIQUE(workout_id, stroke_number)
);

CREATE TABLE IF NOT EXISTS computed_metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    fade_index      REAL,
    consistency     REAL,
    effort_score    REAL,
    drag_delta      REAL,
    computed_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(workout_id)
);

CREATE TABLE IF NOT EXISTS fitness_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL UNIQUE,
    fitness         REAL,
    fatigue         REAL,
    form            REAL,
    computed_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    distance        INTEGER NOT NULL,
    predicted_time  INTEGER,
    confidence      REAL,
    window_start    TEXT,
    window_end      TEXT,
    computed_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(distance)
);

CREATE TABLE IF NOT EXISTS ai_insights (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL,
    workout_id      INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
    week_start      TEXT,
    content         TEXT NOT NULL,
    prompt_tokens   INTEGER,
    response_tokens INTEGER,
    model           TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_state (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_type ON workouts(workout_type);
CREATE INDEX IF NOT EXISTS idx_workouts_distance ON workouts(distance);
CREATE INDEX IF NOT EXISTS idx_workouts_tag ON workouts(inferred_tag);
CREATE INDEX IF NOT EXISTS idx_strokes_workout ON strokes(workout_id);
CREATE INDEX IF NOT EXISTS idx_intervals_workout ON intervals(workout_id);
CREATE INDEX IF NOT EXISTS idx_computed_workout ON computed_metrics(workout_id);
CREATE INDEX IF NOT EXISTS idx_fitness_date ON fitness_log(date);
CREATE INDEX IF NOT EXISTS idx_insights_type ON ai_insights(type);
CREATE INDEX IF NOT EXISTS idx_insights_workout ON ai_insights(workout_id);
