import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

let dataDir;
let backupDir;
let db;
let closeDb;
let backup;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-backup-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  const dbModule = await import('../src/db.js');
  backup = await import('../src/backupSchedule.js');
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
  backupDir = backup.getBackupDir();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.BACKUP_KEEP;
  delete process.env.BACKUP_ENABLED;
});

function fakeBackup(name, mtime) {
  writeFileSync(join(backupDir, name), 'x');
  if (mtime) utimesSync(join(backupDir, name), mtime, mtime);
}

// The changed-since check compares file mtimes, which can land in the same
// clock tick as the write that follows in a fast test. Dating the newest
// backup into the past makes "the database changed afterwards" unambiguous.
function ageNewestBackup() {
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(backupDir, backup.listBackups()[0]), past, past);
}

describe('runScheduledBackup', () => {
  it('writes a restorable snapshot named for the backup time', async () => {
    const result = await backup.runScheduledBackup({ now: new Date(2026, 6, 19, 3, 30) });

    expect(result.file).toBe('ergdash-auto-2026-07-19-0330.sqlite3');
    expect(result.removed).toEqual([]);

    const snapshot = new Database(join(backupDir, result.file), { readonly: true });
    expect(snapshot.prepare('SELECT name FROM profiles').get().name).toBe('Test');
    snapshot.close();
  });

  it('skips when the database has not changed since the newest backup', async () => {
    const first = await backup.runScheduledBackup({ now: new Date(2026, 6, 19, 3, 30) });
    expect(first.file).toBeTruthy();

    const second = await backup.runScheduledBackup({ now: new Date(2026, 6, 20, 3, 30) });
    expect(second.skipped).toBe(true);
    expect(backup.listBackups()).toEqual([first.file]);
  });

  it('backs up again after a write touches the database', async () => {
    const first = await backup.runScheduledBackup({ now: new Date(2026, 6, 19, 3, 30) });

    ageNewestBackup();
    db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Second')").run();

    const second = await backup.runScheduledBackup({ now: new Date(2026, 6, 20, 3, 30) });
    expect(second.file).toBe('ergdash-auto-2026-07-20-0330.sqlite3');
    expect(backup.listBackups()).toEqual([second.file, first.file]);
  });

  it('rotates out the oldest backups beyond BACKUP_KEEP', async () => {
    process.env.BACKUP_KEEP = '3';
    await backup.runScheduledBackup({ now: new Date(2026, 6, 1, 3, 30) });
    for (const day of ['02', '03', '04']) {
      fakeBackup(`ergdash-auto-2026-06-${day}-0330.sqlite3`);
    }

    ageNewestBackup();
    db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Second')").run();
    const result = await backup.runScheduledBackup({ now: new Date(2026, 6, 5, 3, 30) });

    expect(result.removed).toEqual([
      'ergdash-auto-2026-06-03-0330.sqlite3',
      'ergdash-auto-2026-06-02-0330.sqlite3',
    ]);
    expect(backup.listBackups()).toEqual([
      'ergdash-auto-2026-07-05-0330.sqlite3',
      'ergdash-auto-2026-07-01-0330.sqlite3',
      'ergdash-auto-2026-06-04-0330.sqlite3',
    ]);
  });

  it('ignores files that are not automatic backups', async () => {
    await backup.runScheduledBackup({ now: new Date(2026, 6, 19, 3, 30) });
    writeFileSync(join(backupDir, 'manual-copy.sqlite3'), 'x');
    writeFileSync(join(backupDir, 'notes.txt'), 'x');
    process.env.BACKUP_KEEP = '1';

    ageNewestBackup();
    db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Second')").run();
    await backup.runScheduledBackup({ now: new Date(2026, 6, 20, 3, 30) });

    const files = readdirSync(backupDir).sort();
    expect(files).toContain('manual-copy.sqlite3');
    expect(files).toContain('notes.txt');
    expect(backup.listBackups()).toEqual(['ergdash-auto-2026-07-20-0330.sqlite3']);
  });
});

describe('lastBackupAt', () => {
  it('is null with no backups and the newest mtime once there are some', async () => {
    expect(backup.lastBackupAt()).toBe(null);
    const { file } = await backup.runScheduledBackup({ now: new Date(2026, 6, 19, 3, 30) });
    expect(backup.lastBackupAt()).toBe(statSync(join(backupDir, file)).mtime.toISOString());
  });
});

describe('config parsing', () => {
  it('defaults BACKUP_KEEP to 7 and rejects nonsense', () => {
    expect(backup.backupKeepCount()).toBe(7);
    process.env.BACKUP_KEEP = '14';
    expect(backup.backupKeepCount()).toBe(14);
    process.env.BACKUP_KEEP = '0';
    expect(backup.backupKeepCount()).toBe(7);
    process.env.BACKUP_KEEP = 'lots';
    expect(backup.backupKeepCount()).toBe(7);
  });

  it('is enabled unless BACKUP_ENABLED is 0 or false', () => {
    expect(backup.isBackupEnabled()).toBe(true);
    process.env.BACKUP_ENABLED = '1';
    expect(backup.isBackupEnabled()).toBe(true);
    process.env.BACKUP_ENABLED = '0';
    expect(backup.isBackupEnabled()).toBe(false);
    process.env.BACKUP_ENABLED = 'false';
    expect(backup.isBackupEnabled()).toBe(false);
  });
});
