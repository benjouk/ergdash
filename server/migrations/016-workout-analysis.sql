-- Versioned "observed execution" analysis, cached alongside the columnar metrics.
-- analysis_json holds the full analysis object (structure + execution + phases /
-- intervals) as JSON; analysis_version stamps the workoutExecution.js formula
-- version so computeAllMetrics recomputes cached rows when it is bumped.
--
-- Additive only; no backfill — existing rows have NULL analysis_version, which is
-- < ANALYSIS_VERSION, so the recompute gate refills them on the next analytics run.
ALTER TABLE computed_metrics ADD COLUMN analysis_json TEXT;
ALTER TABLE computed_metrics ADD COLUMN analysis_version INTEGER;
