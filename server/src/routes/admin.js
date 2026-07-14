import express, { Router } from 'express';
import { createReadStream, existsSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearAuth } from '../auth.js';
import { closeDb, getDataDir, getDb, getDbPath, reopenDb } from '../db.js';
import { isSyncInProgress, runFullSync } from '../sync.js';

const router = Router();
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'binary');
export const EXPORT_TABLES = [
  'profiles',
  'workouts',
  'intervals',
  'strokes',
  'computed_metrics',
  'hr_zone_time',
  'best_efforts',
  'interval_recoveries',
  'fitness_log',
  'pb_history',
  'goals',
  'programs',
  'planned_workouts',
  'settings',
];
// Columns to project per table. profiles omits the encrypted token columns —
// a JSON export is meant to be portable/shareable, not a secret store (the
// binary /backup keeps everything). Tables absent here export all columns.
export const EXPORT_COLUMNS = {
  profiles: 'id, name, c2_user_id, user_info, created_at',
};
// Date-global derived tables rebuilt from scratch after a wipe (pb_history
// backfills on the next PB detection pass, fitness_log on the next sync).
// Per-workout child tables aren't listed: deleting the c2 workout rows
// cascades to them, which leaves manual/imported workouts' data intact.
export const WIPE_TABLES = [
  'pb_history',
  'fitness_log',
];
const SYNC_CURSOR_KEYS = [
  'last_sync_completed',
  'sync_progress',
  'last_enriched_workout_id',
];

// Wipes one profile's Concept2-synced data ahead of a fresh full sync. Manual
// and imported workouts are user-entered - a resync can't restore them - so
// they survive, along with their intervals/strokes/metrics (cascade only
// fires for the deleted c2 rows). Other profiles are untouched.
export function wipeWorkoutData(db, profileId) {
  db.transaction(() => {
    // Workout FKs are SET NULL on deletion, but completion is a property of
    // the link. Reset plans linked to c2 workouts so the fresh sync can match
    // them again; plans matched to surviving manual workouts stay completed.
    db.prepare(`
      UPDATE planned_workouts
      SET completed_workout_id = NULL, status = 'planned', match_type = NULL,
          updated_at = datetime('now')
      WHERE completed_workout_id IN (SELECT id FROM workouts WHERE source = 'c2' AND profile_id = ?)
    `).run(profileId);

    for (const table of WIPE_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
    }
    db.prepare("DELETE FROM workouts WHERE source = 'c2' AND profile_id = ?").run(profileId);
    for (const key of SYNC_CURSOR_KEYS) {
      db.prepare('DELETE FROM sync_state WHERE key = ?').run(`profile:${profileId}:${key}`);
    }
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, 'idle', datetime('now'))")
      .run(`profile:${profileId}:sync_status`);
  })();
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function removeIfExists(path) {
  if (existsSync(path)) rmSync(path, { force: true });
}

function removeDbSidecars(dbPath) {
  removeIfExists(`${dbPath}-wal`);
  removeIfExists(`${dbPath}-shm`);
}

router.get('/backup', async (req, res, next) => {
  const db = getDb();
  const tempPath = join(getDataDir(), `ergdash-backup-${Date.now()}.sqlite3`);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeIfExists(tempPath);
  };

  try {
    await db.backup(tempPath);
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="ergdash-backup-${todayStamp()}.sqlite3"`);
    res.on('finish', cleanup);
    res.on('close', cleanup);
    createReadStream(tempPath).on('error', next).pipe(res);
  } catch (err) {
    cleanup();
    next(err);
  }
});

router.get('/export', (req, res, next) => {
  try {
    const db = getDb();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ergdash-export-${todayStamp()}.json"`);
    res.write(`{"exported_at":${JSON.stringify(new Date().toISOString())},"tables":{`);

    EXPORT_TABLES.forEach((table, tableIndex) => {
      if (tableIndex > 0) res.write(',');
      res.write(`${JSON.stringify(table)}:[`);
      let rowIndex = 0;
      const cols = EXPORT_COLUMNS[table] || '*';
      for (const row of db.prepare(`SELECT ${cols} FROM ${table}`).iterate()) {
        if (rowIndex > 0) res.write(',');
        res.write(JSON.stringify(row));
        rowIndex += 1;
      }
      res.write(']');
    });

    res.end('}}');
  } catch (err) {
    next(err);
  }
});

router.post('/restore', express.raw({ type: 'application/octet-stream', limit: '500mb' }), (req, res, next) => {
  const uploaded = req.body;
  if (!Buffer.isBuffer(uploaded) || uploaded.length < SQLITE_MAGIC.length || !uploaded.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
    return res.status(400).json({ error: 'Uploaded file is not a SQLite database.' });
  }

  const dbPath = getDbPath();
  const safetyPath = `${dbPath}.pre-restore.sqlite3`;
  let movedCurrent = false;

  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
    closeDb();
    removeIfExists(safetyPath);
    if (existsSync(dbPath)) {
      renameSync(dbPath, safetyPath);
      movedCurrent = true;
    }
    removeDbSidecars(dbPath);
    writeFileSync(dbPath, uploaded);
    reopenDb();
    res.json({ ok: true });
  } catch (err) {
    try {
      closeDb();
      removeIfExists(dbPath);
      removeDbSidecars(dbPath);
      if (movedCurrent && existsSync(safetyPath)) {
        renameSync(safetyPath, dbPath);
      }
      reopenDb();
    } catch (restoreErr) {
      console.error('Failed to restore safety copy after restore error:', restoreErr);
    }
    next(err);
  }
});

// Disconnects the active profile from Concept2. The browser session stays —
// other household profiles remain usable on this device.
router.post('/disconnect', (req, res, next) => {
  try {
    clearAuth(req.profileId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/wipe', (req, res, next) => {
  if (isSyncInProgress(req.profileId)) {
    return res.status(409).json({ error: 'Cannot wipe local data while a sync is running' });
  }

  try {
    const db = getDb();
    wipeWorkoutData(db, req.profileId);

    runFullSync(req.profileId).catch(err => console.error('Post-wipe sync failed:', err));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
