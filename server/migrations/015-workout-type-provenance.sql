-- Provenance for workout_type. Previously a missing Concept2 value was silently
-- defaulted to 'FixedDistanceSplits', which is indistinguishable from Concept2
-- actually reporting that type. Record where the effective workout_type came from.
--
-- workout_type       : effective/normalized value (unchanged; still what code reads)
-- raw_workout_type   : exactly what the source reported (NULL if it reported none)
-- workout_type_source: where the effective value came from —
--   'concept2' (Logbook sync), 'manual' (hand-entered), 'import' (file import),
--   'fallback' (no value reported, defaulted), 'legacy' (pre-provenance backfill),
--   'unknown' (reserved for truly-unknowable cases)
ALTER TABLE workouts ADD COLUMN raw_workout_type TEXT;
ALTER TABLE workouts ADD COLUMN workout_type_source TEXT;

-- Existing rows predate provenance tracking, so we can't prove where their
-- workout_type came from: mark them 'legacy' and copy the effective value across.
UPDATE workouts
  SET raw_workout_type = workout_type,
      workout_type_source = 'legacy'
  WHERE workout_type_source IS NULL;
