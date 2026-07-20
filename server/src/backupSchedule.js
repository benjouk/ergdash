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
import { getDb, getDbPath, getDataDir, getInstanceSetting } from './db.js';

const BACKUP_PATTERN = /^ergdash-auto-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite3$/;

// Preferences live in instance_settings so the Settings page can change them
// without a restart; the BACKUP_* env vars act as defaults for installs that
// have never touched the UI. All three are read at fire time, not startup.
export function isBackupEnabled() {
  const stored = getInstanceSetting('backup_enabled');
  const value = (stored ?? process.env.BACKUP_ENABLED ?? '').toLowerCase();
  return value !== '0' && value !== 'false';
}

export function backupKeepCount() {
  const stored = getInstanceSetting('backup_keep');
  const n = parseInt(stored ?? process.env.BACKUP_KEEP ?? '7', 10);
  return Number.isInteger(n) && n > 0 ? n : 7;
}

// Hour of day (0-23) the nightly backup fires, at 30 minutes past.
export function backupHour() {
  const stored = getInstanceSetting('backup_hour');
  const n = parseInt(stored ?? process.env.BACKUP_HOUR ?? '3', 10);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 3;
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

// Detailed listing for the Settings page, newest first.
export function listBackupFiles(dir = getBackupDir()) {
  return listBackups(dir).map(file => {
    const stats = statSync(join(dir, file));
    return { file, size_bytes: stats.size, created_at: stats.mtime.toISOString() };
  });
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

export async function runScheduledBackup({ now = new Date(), force = false } = {}) {
  const dir = getBackupDir();
  mkdirSync(dir, { recursive: true });

  // force is the "Back up now" button: the user asked, so take a snapshot
  // even if nothing changed since the last one.
  if (!force && !dbChangedSince(dir)) {
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
  // Fire every hour at :30 and decide then, so enabling/disabling or moving
  // the hour from the Settings page takes effect without a restart.
  cron.schedule('30 * * * *', async () => {
    if (!isBackupEnabled() || new Date().getHours() !== backupHour()) return;
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

  if (isBackupEnabled()) {
    console.log(`Backups scheduled: nightly at ${String(backupHour()).padStart(2, '0')}:30, keeping the newest ${backupKeepCount()}`);
  } else {
    console.log('Automatic backups disabled; enable in Settings or unset BACKUP_ENABLED');
  }
}
