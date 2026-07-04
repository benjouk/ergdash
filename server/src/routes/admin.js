import express, { Router } from 'express';
import { createReadStream, existsSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearAuth, clearAuthSession } from '../auth.js';
import { closeDb, getDataDir, getDb, getDbPath, reopenDb } from '../db.js';
import { runFullSync } from '../sync.js';

const router = Router();
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'binary');
const EXPORT_TABLES = [
  'workouts',
  'intervals',
  'strokes',
  'computed_metrics',
  'hr_zone_time',
  'best_efforts',
  'interval_recoveries',
  'fitness_log',
  'pb_history',
  'settings',
];
const WIPE_TABLES = [
  'pb_history',
  'interval_recoveries',
  'best_efforts',
  'hr_zone_time',
  'computed_metrics',
  'strokes',
  'intervals',
  'fitness_log',
  'workouts',
];
const SYNC_CURSOR_KEYS = [
  'last_sync_completed',
  'sync_progress',
  'last_enriched_workout_id',
];

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
  const tempPath = join(getDataDir(), `rowdash-backup-${Date.now()}.sqlite3`);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeIfExists(tempPath);
  };

  try {
    await db.backup(tempPath);
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="rowdash-backup-${todayStamp()}.sqlite3"`);
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
    res.setHeader('Content-Disposition', `attachment; filename="rowdash-export-${todayStamp()}.json"`);
    res.write(`{"exported_at":${JSON.stringify(new Date().toISOString())},"tables":{`);

    EXPORT_TABLES.forEach((table, tableIndex) => {
      if (tableIndex > 0) res.write(',');
      res.write(`${JSON.stringify(table)}:[`);
      let rowIndex = 0;
      for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
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

router.post('/disconnect', (req, res, next) => {
  try {
    clearAuth();
    clearAuthSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/wipe', (req, res, next) => {
  try {
    const db = getDb();
    db.transaction(() => {
      for (const table of WIPE_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.prepare(`DELETE FROM sync_state WHERE key IN (${SYNC_CURSOR_KEYS.map(() => '?').join(', ')})`).run(...SYNC_CURSOR_KEYS);
      db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('sync_status', 'idle', datetime('now'))").run();
    })();

    runFullSync().catch(err => console.error('Post-wipe sync failed:', err));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
