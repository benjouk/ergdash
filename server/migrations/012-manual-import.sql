-- Manual entry / file import / result corrections.
-- source: 'c2' (Logbook sync), 'manual' (hand-entered), 'import' (file import).
ALTER TABLE workouts ADD COLUMN source TEXT NOT NULL DEFAULT 'c2';
-- JSON array of workouts column names the user has overridden (or that an
-- import merge filled in); sync must not overwrite these. NULL = none.
ALTER TABLE workouts ADD COLUMN edited_fields TEXT;
-- sha256(file bytes) + ':' + workout index within the file; makes re-importing
-- the same file idempotent.
ALTER TABLE workouts ADD COLUMN import_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_workouts_source ON workouts(source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_import_fp
  ON workouts(import_fingerprint) WHERE import_fingerprint IS NOT NULL;
