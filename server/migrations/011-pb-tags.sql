ALTER TABLE pb_history ADD COLUMN tag TEXT NOT NULL DEFAULT 'endurance';

-- Rebuild PB history with correct tags on next sync/startup.
DELETE FROM pb_history;
