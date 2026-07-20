import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

let dataDir;
let db;
let closeDb;
let server;
let base;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-admin-backups-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();

  const dbModule = await import('../src/db.js');
  const adminRouter = (await import('../src/routes/admin.js')).default;
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.profileId = 1; next(); });
  app.use('/api/admin', adminRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('GET /api/admin/backups', () => {
  it('reports the defaults before any backup exists', async () => {
    const response = await fetch(`${base}/api/admin/backups`);
    const body = await response.json();
    expect(body).toEqual({ enabled: true, keep: 7, hour: 3, last_backup: null, files: [] });
  });
});

describe('PATCH /api/admin/backups', () => {
  it('persists preference changes and returns the new status', async () => {
    const response = await fetch(`${base}/api/admin/backups`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, keep: 14, hour: 22 }),
    });
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(body.keep).toBe(14);
    expect(body.hour).toBe(22);

    const reread = await (await fetch(`${base}/api/admin/backups`)).json();
    expect(reread).toMatchObject({ enabled: false, keep: 14, hour: 22 });
  });

  it('rejects invalid values without applying any of them', async () => {
    const response = await fetch(`${base}/api/admin/backups`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes', keep: 0, hour: 24 }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details).toHaveLength(3);

    const reread = await (await fetch(`${base}/api/admin/backups`)).json();
    expect(reread).toMatchObject({ enabled: true, keep: 7, hour: 3 });
  });

  it('applies a lowered keep count to existing backups immediately', async () => {
    const backupDir = join(dataDir, 'backups');
    mkdirSync(backupDir, { recursive: true });
    for (const day of ['01', '02', '03']) {
      writeFileSync(join(backupDir, `ergdash-auto-2026-06-${day}-0330.sqlite3`), 'x');
    }

    const response = await fetch(`${base}/api/admin/backups`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: 1 }),
    });
    const body = await response.json();
    expect(body.files.map(f => f.file)).toEqual(['ergdash-auto-2026-06-03-0330.sqlite3']);
  });
});

describe('POST /api/admin/backups/run', () => {
  it('forces a snapshot and reports it in the status', async () => {
    const response = await fetch(`${base}/api/admin/backups/run`, { method: 'POST' });
    const body = await response.json();
    expect(body.file).toMatch(/^ergdash-auto-.*\.sqlite3$/);
    expect(body.status.last_backup).not.toBe(null);
    expect(body.status.files.map(f => f.file)).toContain(body.file);
  });
});
