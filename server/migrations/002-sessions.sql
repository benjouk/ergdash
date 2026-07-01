CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Carry over the existing single session so the current device stays logged in
INSERT INTO sessions (token_hash, expires_at)
SELECT value, datetime('now', '+30 days') FROM sync_state WHERE key = 'session_token_hash';

DELETE FROM sync_state WHERE key = 'session_token_hash';
