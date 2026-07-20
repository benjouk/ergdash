import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let dataDir;
let closeDb;
let server;
let base;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-health-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const healthRouter = (await import('../src/routes/health.js')).default;
  ({ closeDb } = dbModule);
  const db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
  db.prepare(`
    INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, source, has_stroke_data, synced_at)
    VALUES (1, 1, 1, '2026-07-01', 'rower', 'JustRow', 2000, 420000, 'c2', 1, datetime('now'))
  `).run();
  db.prepare("INSERT INTO sync_state (key, value) VALUES ('profile:1:last_sync_completed', '2026-07-15T12:00:00.000Z')").run();
  db.prepare("INSERT INTO sync_state (key, value) VALUES ('profile:1:sync_status', 'idle')").run();

  const app = express();
  app.use('/health', healthRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('GET /health authenticated metadata', () => {
  it('reports namespaced profile sync state and the package version', async () => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();

    expect(body.sync).toEqual({
      last_completed: '2026-07-15T12:00:00.000Z',
      status: 'idle',
      enrichment: '1/1',
    });
    expect(body.version).toBe(version);
  });
});
