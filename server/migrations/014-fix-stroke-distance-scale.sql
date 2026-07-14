-- Concept2's compact stroke stream reports distance in tenths of a metre
-- (decimetres). The importer stored `d` verbatim while dividing `t` by 10,
-- so per-stroke distance_m landed 10x too large and the per-stroke charts
-- (pace, stroke rate, HR over distance) plotted a 2000 m piece out to 20000 m.
-- The importer now divides `d` by 10; correct the rows already stored.
--
-- Guarded to workouts whose stroke span is far larger than the recorded
-- distance (>5x), so correctly-scaled data - including seeded sessions and any
-- future re-syncs - is left untouched.
UPDATE strokes
   SET distance_m = distance_m / 10.0
 WHERE workout_id IN (
   SELECT s.workout_id
     FROM strokes s
     JOIN workouts w ON w.id = s.workout_id
    WHERE w.distance > 0
    GROUP BY s.workout_id
   HAVING MAX(s.distance_m) > w.distance * 5
 );
