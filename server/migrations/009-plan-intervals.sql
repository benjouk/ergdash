-- Interval structure for planned workouts: "4×2000m / 5:00r" style sessions.
-- Work is either distance- or duration-based per rep; rest is duration-only
-- (rest-distance plans are rare enough to leave out). Totals still live in
-- target_distance/target_duration_ms so matching and adherence are unchanged.
ALTER TABLE planned_workouts ADD COLUMN interval_reps INTEGER;
ALTER TABLE planned_workouts ADD COLUMN interval_distance INTEGER;
ALTER TABLE planned_workouts ADD COLUMN interval_duration_ms INTEGER;
ALTER TABLE planned_workouts ADD COLUMN interval_rest_ms INTEGER;
