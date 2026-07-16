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
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-narrative-route-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const workoutsRouter = (await import('../src/routes/workouts.js')).default;
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
  db.prepare(`
    INSERT INTO workouts (
      id, profile_id, user_id, date, type, workout_type, inferred_tag,
      distance, time_ms, pace_ms, stroke_rate, heart_rate_avg, synced_at
    ) VALUES (
      1, 1, 42, '2026-07-15T07:00:00', 'rower', 'FixedDistanceSplits', 'endurance',
      5000, 1200000, 120000, 24, 150, datetime('now')
    )
  `).run();

  const analysis = {
    version: 5,
    structure: { value: 'continuous' },
    execution: {
      pacing: {
        value: 'even',
        shape: { fast_start: false, even_core: true, late_fade: false, fast_finish: true },
      },
      finish: { value: 'accelerated' },
      rate: { value: 'stable', average_spm: 24.2, variation_spm: 1.1 },
      intensity: { value: 'moderate', dominant_zone: 3 },
      hr_drift: { value: 'low', drift_percent: 3.2 },
    },
    phases: [
      { name: 'start', avg_pace_ms: 120000 },
      { name: 'middle', avg_pace_ms: 120000 },
    ],
    intervals: null,
  };
  db.prepare(`
    INSERT INTO computed_metrics (workout_id, hr_drift_pct, analysis_json, analysis_version)
    VALUES (1, 3.2, ?, 5)
  `).run(JSON.stringify(analysis));
  db.prepare(`
    INSERT INTO planned_workouts (
      profile_id, date, type, target_distance, target_duration_ms,
      target_pace_ms, target_rate, notes, completed_workout_id, match_type, status
    ) VALUES (
      1, '2026-07-15', 'test', 5000, 1200000,
      121000, 24, 'Practise the race warm-up and first 500m', 1, 'manual', 'completed'
    )
  `).run();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.profileId = 1; next(); });
  app.use('/api/workouts', workoutsRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function req(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

describe('workout narrative routes', () => {
  it('migration 017 adds the nullable intent column', () => {
    const intentColumn = db.prepare('PRAGMA table_info(workouts)').all()
      .find(column => column.name === 'intent');
    expect(intentColumn).toBeTruthy();
    expect(intentColumn.notnull).toBe(0);
  });

  it('validates intent updates, supports clearing, and never marks them as corrections', async () => {
    const invalid = await req('PATCH', '/api/workouts/1', { intent: 'tempo' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.details.join(' ')).toContain('intent must be null or one of');

    const updated = await req('PATCH', '/api/workouts/1', { intent: 'technique' });
    expect(updated.status).toBe(200);
    expect(updated.body.intent).toBe('technique');
    expect(db.prepare('SELECT intent, edited_fields FROM workouts WHERE id = 1').get()).toEqual({
      intent: 'technique', edited_fields: null,
    });

    const cleared = await req('PATCH', '/api/workouts/1', { intent: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.intent).toBeNull();
    expect(db.prepare('SELECT intent FROM workouts WHERE id = 1').get().intent).toBeNull();
  });

  it('returns plan prescriptions and composes the detail narrative at request time', async () => {
    const detail = await req('GET', '/api/workouts/1');
    expect(detail.status).toBe(200);
    expect(detail.body.intent).toBeNull();
    expect(detail.body.plan).toMatchObject({
      type: 'test',
      target_distance: 5000,
      target_duration_ms: 1200000,
      target_pace_ms: 121000,
      target_rate: 24,
      notes: 'Practise the race warm-up and first 500m',
    });
    expect(detail.body.narrative).toMatchObject({
      headline: 'Controlled middle with a strong finish',
      intent: 'test_race',
      intent_source: 'plan',
      needs_intent: false,
      plan_review: {
        planned: {
          target_pace_ms: 121000,
          target_rate: 24,
          notes: 'Practise the race warm-up and first 500m',
        },
        actual: {
          pace_ms: 120000,
          avg_rate: 24.2,
          dominant_zone: 3,
          hr_drift_pct: 3.2,
        },
      },
    });
    expect(Array.isArray(detail.body.insight)).toBe(true);

    await req('PATCH', '/api/workouts/1', { intent: 'recovery' });
    const recomposed = await req('GET', '/api/workouts/1');
    expect(recomposed.body.narrative.intent).toBe('recovery');
    expect(recomposed.body.narrative.intent_source).toBe('workout');
    expect(recomposed.body.narrative.recommendation).toContain('For recovery work');
  });

  it('adds the prescription fields to plan objects in the workout list', async () => {
    const list = await req('GET', '/api/workouts');
    expect(list.status).toBe(200);
    expect(list.body.data[0].plan).toMatchObject({
      target_distance: 5000,
      target_duration_ms: 1200000,
      target_pace_ms: 121000,
      target_rate: 24,
      notes: 'Practise the race warm-up and first 500m',
    });
  });
});
