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

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function insertWorkout({ id, date, distance, timeMs, tag = null, intent = null }) {
  const paceMs = Math.round(timeMs / (distance / 500));
  db.prepare(`
    INSERT INTO workouts (
      id, profile_id, user_id, date, type, workout_type, inferred_tag,
      distance, time_ms, pace_ms, stroke_rate, intent, synced_at
    ) VALUES (?, 1, 42, ?, 'rower', 'FixedDistanceSplits', ?, ?, ?, ?, 24, ?, datetime('now'))
  `).run(id, date, tag, distance, timeMs, paceMs, intent);
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-intent-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const workoutsRouter = (await import('../src/routes/workouts.js')).default;
  const statsRouter = (await import('../src/routes/stats.js')).default;
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name, c2_user_id) VALUES (1, 'Test', 42)").run();

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.profileId = 1; next(); });
  app.use('/api/workouts', workoutsRouter);
  app.use('/api/stats', statsRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe('PATCH /api/workouts/:id intent', () => {
  it('stores a valid intent and clears it with null', async () => {
    insertWorkout({ id: 1, date: '2026-07-01 08:00:00', distance: 2000, timeMs: 460000 });

    let res = await req('/api/workouts/1', { method: 'PATCH', body: { intent: 'warmup' } });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe('warmup');

    res = await req('/api/workouts/1', { method: 'PATCH', body: { intent: null } });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBeNull();
  });

  it('rejects unknown intent values', async () => {
    insertWorkout({ id: 1, date: '2026-07-01 08:00:00', distance: 2000, timeMs: 460000 });
    const res = await req('/api/workouts/1', { method: 'PATCH', body: { intent: 'party' } });
    expect(res.status).toBe(400);
    expect(res.body.details.join(' ')).toMatch(/intent/);
  });

  it('survives a c2 re-sync style column update', async () => {
    insertWorkout({ id: 1, date: '2026-07-01 08:00:00', distance: 2000, timeMs: 460000 });
    await req('/api/workouts/1', { method: 'PATCH', body: { intent: 'warmup' } });
    // Sync only rewrites C2-owned columns; intent is not among them.
    db.prepare('UPDATE workouts SET time_ms = time_ms WHERE id = 1').run();
    const res = await req('/api/workouts/1');
    expect(res.body.intent).toBe('warmup');
  });
});

describe('warm-up exclusions', () => {
  beforeEach(() => {
    // A fast 2k test and a slow 2k warm-up before a 5k steady row.
    insertWorkout({ id: 1, date: '2026-06-20 08:00:00', distance: 2000, timeMs: 400000 });
    insertWorkout({ id: 2, date: '2026-07-01 08:00:00', distance: 2000, timeMs: 460000, intent: 'warmup' });
    insertWorkout({ id: 3, date: '2026-07-01 09:00:00', distance: 5000, timeMs: 1120000 });
    insertWorkout({ id: 4, date: '2026-07-02 08:00:00', distance: 3000, timeMs: 640000, tag: 'interval' });
  });

  it('keeps warm-ups out of the pace trend but in weekly volume', async () => {
    const pace = await req('/api/stats/trends?metric=pace&period=all');
    expect(pace.body.pace_trend.map(r => r.distance)).toEqual([2000, 5000, 3000]);

    const volume = await req('/api/stats/trends?metric=volume&period=all');
    const totalMeters = volume.body.weekly_volume.reduce((s, w) => s + w.distance, 0);
    expect(totalMeters).toBe(2000 + 2000 + 5000 + 3000);
  });

  it('keeps warm-ups out of the session mix and steady pace, but in totals', async () => {
    const { body } = await req('/api/stats/summary');
    expect(body.total_meters).toBe(12000);
    expect(body.split_steady_m).toBe(2000 + 5000);
    expect(body.split_interval_m).toBe(3000);
    // Steady pace averages the 2k test and the 5k row only (both continuous,
    // neither a warm-up): (100000 + 112000) / 2.
    expect(body.steady_pace).toBe(106000);
  });

  it('keeps warm-ups out of personal bests', async () => {
    // Make the warm-up the fastest 2k on paper - it still must not be the PB.
    db.prepare('UPDATE workouts SET time_ms = 390000, pace_ms = 97500 WHERE id = 2').run();
    const { body } = await req('/api/stats/personal-bests');
    const pb2k = body.personal_bests.find(pb => pb.distance === 2000 && pb.tag === 'endurance');
    expect(pb2k.workout_id).toBe(1);
  });

  it('rebuilds PB history when a PB piece is tagged as a warm-up', async () => {
    const { reconcilePbDistances } = await import('../src/pbDetection.js');
    reconcilePbDistances(1, [2000]);
    let holders = db.prepare('SELECT workout_id FROM pb_history WHERE distance = 2000').all();
    expect(holders.map(h => h.workout_id)).toEqual([1]);

    // Tagging the only hard 2k as a warm-up leaves no eligible PB candidate
    // (the other 2k is already a warm-up).
    await req('/api/workouts/1', { method: 'PATCH', body: { intent: 'warmup' } });
    holders = db.prepare('SELECT workout_id FROM pb_history WHERE distance = 2000').all();
    expect(holders).toEqual([]);

    // Clearing the tag restores the record.
    await req('/api/workouts/1', { method: 'PATCH', body: { intent: null } });
    holders = db.prepare('SELECT workout_id FROM pb_history WHERE distance = 2000').all();
    expect(holders.map(h => h.workout_id)).toEqual([1]);
  });
});
