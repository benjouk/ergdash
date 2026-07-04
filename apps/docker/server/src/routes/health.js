import { Router } from 'express';
import { statSync } from 'fs';
import { getDb, getDbPath } from '../db.js';

const router = Router();
const startTime = Date.now();

router.get('/', (req, res) => {
  const db = getDb();
  const workoutCount = db.prepare('SELECT COUNT(*) as count FROM workouts').get().count;

  let dbSize = 0;
  try {
    dbSize = statSync(getDbPath()).size;
  } catch {}

  const lastSync = db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync_completed'").get();
  const syncStatus = db.prepare("SELECT value FROM sync_state WHERE key = 'sync_status'").get();
  const enriched = db.prepare('SELECT COUNT(*) as count FROM workouts WHERE has_stroke_data = 1').get().count;

  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    database: {
      size_bytes: dbSize,
      workout_count: workoutCount,
    },
    sync: {
      last_completed: lastSync?.value || null,
      status: syncStatus?.value || 'never',
      enrichment: `${enriched}/${workoutCount}`,
    },
    version: '0.1.0',
  });
});

export default router;
