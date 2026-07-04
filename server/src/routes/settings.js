import { Router } from 'express';
import { getDb, seedDefaults } from '../db.js';
import { recomputeAllZoneTimes } from '../analytics.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const { key, value } of rows) {
    settings[key] = value;
  }
  res.json(settings);
});

router.patch('/', (req, res) => {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  );

  const allowedKeys = [
    'theme', 'units', 'sync_interval', 'time_range',
    'annual_goal_m', 'rate_band_tolerance', 'max_hr', 'hr_zones',
    'progress_layout', 'default_landing', 'feed_limit', 'week_start',
    'date_format', 'pb_last_seen_at',
  ];
  const updates = {};

  db.transaction(() => {
    for (const [key, value] of Object.entries(req.body)) {
      if (allowedKeys.includes(key)) {
        upsert.run(key, String(value));
        updates[key] = String(value);
      }
    }
  })();

  // Zone-model edits invalidate all cached zone times; the dataset is small
  // enough (single user) to recompute synchronously.
  if ('max_hr' in updates || 'hr_zones' in updates) {
    recomputeAllZoneTimes();
  }

  res.json(updates);
});

router.post('/reset', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM settings').run();
  seedDefaults(db);
  res.json({ ok: true });
});

export default router;
