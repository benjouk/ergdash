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

async function req(body, { method = 'PATCH', path = '/api/settings' } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-settings-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const settingsRouter = (await import('../src/routes/settings.js')).default;
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.profileId = 1; next(); });
  app.use('/api/settings', settingsRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('PATCH /api/settings validation', () => {
  it('accepts known valid values', async () => {
    const { status, body } = await req({
      theme: 'dark',
      units: 'calhr',
      sync_interval: 30,
      hr_zones: JSON.stringify([60, 70, 80, 90, 100]),
      progress_layout: JSON.stringify(['fitness', 'pace']),
      default_landing: '/progress',
    });
    expect(status).toBe(200);
    expect(body.units).toBe('calhr');
    expect(body.default_landing).toBe('/progress');
  });

  it('rejects malformed values instead of storing arbitrary strings', async () => {
    const { status, body } = await req({
      theme: 'neon',
      sync_interval: 1,
      hr_zones: '[90,80,70]',
      default_landing: 'https://evil.example/',
    });
    expect(status).toBe(400);
    expect(body.details.length).toBeGreaterThanOrEqual(4);
  });

  it('recomputes effort confidence when max HR is set and reset', async () => {
    db.prepare(`
      INSERT INTO workouts (
        id, profile_id, user_id, date, type, workout_type, inferred_tag,
        distance, time_ms, pace_ms, stroke_rate, heart_rate_avg,
        heart_rate_max, synced_at
      ) VALUES (
        1, 1, 42, '2026-07-15T07:00:00', 'rower',
        'FixedDistanceSplits', 'endurance', 5000, 1200000, 120000,
        24, 150, 180, datetime('now')
      )
    `).run();
    const { computeMetricsForWorkout } = await import('../src/analytics.js');
    computeMetricsForWorkout(1);

    const intensity = () => JSON.parse(db.prepare(
      'SELECT analysis_json FROM computed_metrics WHERE workout_id = 1'
    ).get().analysis_json).execution.intensity;

    expect(intensity()).toMatchObject({ estimated: true, dominant_zone: 4 });

    expect((await req({ max_hr: 200 })).status).toBe(200);
    expect(intensity()).toMatchObject({ estimated: false, dominant_zone: 3 });

    expect((await req(undefined, { method: 'POST', path: '/api/settings/reset' })).status).toBe(200);
    expect(intensity()).toMatchObject({ estimated: true, dominant_zone: 4 });
  });
});
