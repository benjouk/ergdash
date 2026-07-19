import { Router } from 'express';
import { statSync } from 'fs';
import { createRequire } from 'module';
import { getDb, getDbPath } from '../db.js';
import { hasValidSession } from '../auth.js';
import { lastBackupAt } from '../backupSchedule.js';

const router = Router();
const startTime = Date.now();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

export function aggregateSyncStatus(rows) {
  const statuses = new Set(rows.map(row => row.value));
  if (statuses.has('syncing')) return 'syncing';
  if (statuses.has('auth_error')) return 'auth_error';
  if (statuses.has('error')) return 'error';
  if (statuses.has('idle')) return 'idle';
  return 'never';
}

router.get('/', (req, res) => {
  // Unauthenticated callers (uptime monitors, container healthchecks) only
  // get a liveness signal; instance metadata requires a valid session.
  const authenticated = process.env.NODE_ENV !== 'production' || hasValidSession(req);
  if (!authenticated) {
    return res.json({ status: 'ok' });
  }

  const db = getDb();
  const workoutCount = db.prepare('SELECT COUNT(*) as count FROM workouts').get().count;

  let dbSize = 0;
  try {
    dbSize = statSync(getDbPath()).size;
  } catch {}

  const lastSync = db.prepare(`
    SELECT value FROM sync_state
    WHERE key LIKE 'profile:%:last_sync_completed'
    ORDER BY value DESC LIMIT 1
  `).get();
  const syncStatuses = db.prepare(`
    SELECT value FROM sync_state WHERE key LIKE 'profile:%:sync_status'
  `).all();
  const c2Count = db.prepare("SELECT COUNT(*) as count FROM workouts WHERE source = 'c2'").get().count;
  const enriched = db.prepare("SELECT COUNT(*) as count FROM workouts WHERE source = 'c2' AND has_stroke_data = 1").get().count;

  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    database: {
      size_bytes: dbSize,
      workout_count: workoutCount,
    },
    sync: {
      last_completed: lastSync?.value || null,
      status: aggregateSyncStatus(syncStatuses),
      enrichment: `${enriched}/${c2Count}`,
    },
    last_backup: lastBackupAt(),
    version,
  });
});

export default router;
