-- User-supplied purpose for a completed workout. Values are validated by the
-- API so the column remains easy to extend without rebuilding the SQLite table.
ALTER TABLE workouts ADD COLUMN intent TEXT;
