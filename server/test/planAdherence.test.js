import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

let dataDir;
let db;
let closeDb;
let server;
let base;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-adherence-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();

  const dbModule = await import('../src/db.js');
  const plansRouter = (await import('../src/routes/plans.js')).default;
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();

  const app = express();
  app.use((req, res, next) => { req.profileId = 1; next(); });
  app.use('/api/plans', plansRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function insertPlan(date, status, distance) {
  db.prepare(`
    INSERT INTO planned_workouts (profile_id, date, type, target_distance, status)
    VALUES (1, ?, 'steady', ?, ?)
  `).run(date, distance, status);
}

describe('GET /api/plans/adherence', () => {
  it('honours an explicit selected range and reports it', async () => {
    insertPlan('2026-05-20', 'completed', 5000);
    insertPlan('2026-06-10', 'completed', 10000);
    insertPlan('2026-06-17', 'planned', 8000);
    insertPlan('2026-07-03', 'completed', 6000);

    const response = await fetch(`${base}/api/plans/adherence?from=2026-06-01&to=2026-07-01`);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.range).toEqual({ from: '2026-06-01', to: '2026-07-01' });
    expect(body.weeks).toHaveLength(2);
    expect(body.weeks.reduce((sum, week) => sum + week.planned_total, 0)).toBe(2);
    expect(body.weeks.reduce((sum, week) => sum + week.planned_meters, 0)).toBe(18000);
  });

  it('allows the client to request the complete plan history explicitly', async () => {
    insertPlan('2020-05-20', 'completed', 5000);
    insertPlan('2026-06-10', 'completed', 10000);

    const response = await fetch(`${base}/api/plans/adherence?from=1900-01-01`);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.range.from).toBe('1900-01-01');
    expect(body.weeks).toHaveLength(2);
    expect(body.weeks.reduce((sum, week) => sum + week.planned_meters, 0)).toBe(15000);
  });
});
