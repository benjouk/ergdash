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

async function req(path) {
  const res = await fetch(`${base}${path}`);
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
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-pbfilter-test-'));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const workoutsRouter = (await import('../src/routes/workouts.js')).default;
  const { reconcilePbDistances } = await import('../src/pbDetection.js');
  ({ closeDb } = dbModule);
  db = dbModule.initDb();
  db.prepare("INSERT INTO profiles (id, name, c2_user_id) VALUES (1, 'Test', 42)").run();

  // Two 2k efforts (id 2 is the current record) plus a 5k and a non-standard
  // distance that can never be a PB.
  insertWorkout({ id: 1, date: '2026-06-20 08:00:00', distance: 2000, timeMs: 460000 });
  insertWorkout({ id: 2, date: '2026-06-25 08:00:00', distance: 2000, timeMs: 400000 });
  insertWorkout({ id: 3, date: '2026-07-01 08:00:00', distance: 5000, timeMs: 1120000 });
  insertWorkout({ id: 4, date: '2026-07-02 08:00:00', distance: 1234, timeMs: 300000 });
  reconcilePbDistances(1, [2000, 5000]);

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

describe('GET /api/workouts?pb=1', () => {
  it('returns only workouts that currently hold a record', async () => {
    const { body } = await req('/api/workouts?pb=1&sort=date_asc');
    // id 2 (faster 2k) and id 3 (only 5k) are records; id 1 was beaten and
    // id 4 is a non-standard distance.
    expect(body.data.map(w => w.id)).toEqual([2, 3]);
    expect(body.meta.total).toBe(2);
  });

  it('reflects the PB filter in the footer totals', async () => {
    const { body } = await req('/api/workouts?pb=1');
    expect(body.meta.totals.distance).toBe(2000 + 5000);
  });

  it('returns every workout when pb is absent or falsy', async () => {
    const all = await req('/api/workouts');
    expect(all.body.meta.total).toBe(4);
    const off = await req('/api/workouts?pb=0');
    expect(off.body.meta.total).toBe(4);
  });

  it('drops a record holder once it is beaten', async () => {
    // A new, faster 2k takes the record; the previous holder falls out.
    insertWorkout({ id: 5, date: '2026-07-10 08:00:00', distance: 2000, timeMs: 390000 });
    const { reconcilePbDistances } = await import('../src/pbDetection.js');
    reconcilePbDistances(1, [2000]);

    const { body } = await req('/api/workouts?pb=1&sort=date_asc');
    expect(body.data.map(w => w.id)).toEqual([3, 5]);
  });

  it('rejects an invalid pb flag', async () => {
    const { status, body } = await req('/api/workouts?pb=maybe');
    expect(status).toBe(400);
    expect(body.details.join(' ')).toMatch(/pb/);
  });
});
