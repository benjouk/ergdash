import { Router } from 'express';
import { getDb } from '../db.js';
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

export default router;
