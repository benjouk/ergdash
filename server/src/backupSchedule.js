// Nightly automatic backups of the whole database, written alongside it in
// DATA_DIR/backups. This is the safety net for corruption, a migration gone
// wrong, or an accidental wipe - it lives on the same disk as the database,
// so protecting against disk failure still means copying the backups
// directory somewhere else (rsync, a NAS share, ...).
//
// Files are plain SQLite snapshots taken with the online backup API (safe
// while the app is writing), so any of them can be fed straight to the
// existing Settings -> restore flow.
import cron from 'node-cron';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { getDb, getDbPath, getDataDir } from './db.js';

const BACKUP_PATTERN = /^ergdash-auto-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite3$/;

export function isBackupEnabled() {
  const value = (process.env.BACKUP_ENABLED || '').toLowerCase();
  return value !== '0' && value !== 'false';
}

export function backupKeepCount() {
  const n = parseInt(process.env.BACKUP_KEEP || '7', 10);
  return Number.isInteger(n) && n > 0 ? n : 7;
}

export function getBackupDir() {
  return join(getDataDir(), 'backups');
}

// Newest first. Timestamped names sort lexically, so no stat calls needed.
export function listBackups(dir = getBackupDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => BACKUP_PATTERN.test(f)).sort().reverse();
}

export function lastBackupAt(dir = getBackupDir()) {
  const [newest] = listBackups(dir);
  if (!newest) return null;
  return statSync(join(dir, newest)).mtime.toISOString();
}

function backupFilename(now) {
  const pad = n => String(n).padStart(2, '0');
  return `ergdash-auto-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.sqlite3`;
}

// The database "changed" if the main file or its WAL sidecar was written to
// after the newest backup was taken. Idle instances skip the nightly copy
// instead of accumulating identical snapshots.
function dbChangedSince(dir) {
  const [newest] = listBackups(dir);
  if (!newest) return true;
  const backupMtime = statSync(join(dir, newest)).mtimeMs;
  return [getDbPath(), `${getDbPath()}-wal`].some(
    path => existsSync(path) && statSync(path).mtimeMs > backupMtime
  );
}

export function rotateBackups(dir = getBackupDir(), keep = backupKeepCount()) {
  const excess = listBackups(dir).slice(keep);
  for (const file of excess) {
    rmSync(join(dir, file), { force: true });
  }
  return excess;
}

export async function runScheduledBackup({ now = new Date() } = {}) {
  const dir = getBackupDir();
  mkdirSync(dir, { recursive: true });

  if (!dbChangedSince(dir)) {
    return { skipped: true };
  }

  // Snapshot to a temp name first so a crash mid-copy never leaves a partial
  // file that looks like (and would rotate out) a valid backup.
  const file = backupFilename(now);
  const tempPath = join(dir, `${file}.tmp`);
  try {
    await getDb().backup(tempPath);
    renameSync(tempPath, join(dir, file));
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }

  const removed = rotateBackups(dir);
  return { file, removed };
}

export function startBackupSchedule() {
  if (!isBackupEnabled()) {
    console.log('Automatic backups disabled (BACKUP_ENABLED=0)');
    return;
  }

  cron.schedule('30 3 * * *', async () => {
    try {
      const result = await runScheduledBackup();
      if (result.skipped) {
        console.log('[cron] Backup skipped: database unchanged since last backup');
      } else {
        console.log(`[cron] Backup written: ${result.file}${result.removed.length ? ` (rotated out ${result.removed.length})` : ''}`);
      }
    } catch (err) {
      console.error('Scheduled backup failed:', err);
    }
  });

  console.log(`Backups scheduled: nightly at 03:30, keeping the newest ${backupKeepCount()}`);
}
