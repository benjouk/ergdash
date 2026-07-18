-- Percentile anchor curves reconciled from the public Concept2 season
-- rankings, one row per (season, event, sex, age band, weight class) bucket.
-- Buckets are shared across profiles; anchors_json is [[percentile, paceS]]
-- ordered from fastest to slowest.
CREATE TABLE ranking_percentiles (
  bucket TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  total_entries INTEGER NOT NULL,
  anchors_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
