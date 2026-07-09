import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

let dataDir;
let db;
let getDb;
let closeDb;
let server;
let base;

const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayStr = iso(Date.now());

// The Monday (ISO) on/after `fromMs`.
function nextMonday(fromMs) {
  const d = new Date(fromMs);
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon
  const add = dow === 0 ? 0 : 7 - dow;
  return iso(fromMs + add * DAY_MS);
}

function insertWorkout({ id, date, distance, timeMs }) {
  db.prepare(`
    INSERT INTO workouts (id, user_id, date, type, workout_type, distance, time_ms, pace_ms, synced_at)
    VALUES (?, 1, ?, 'rower', 'FixedDistanceSplits', ?, ?, ?, datetime('now'))
  `).run(id, date, distance, timeMs, Math.round((timeMs / distance) * 500));
}

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-programs-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const programsRouter = (await import('../src/routes/programs.js')).default;
  const plansRouter = (await import('../src/routes/plans.js')).default;
  ({ getDb, closeDb } = dbModule);
  dbModule.initDb();
  db = getDb();

  const app = express();
  app.use(express.json());
  app.use('/api/programs', programsRouter);
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

function programRows(programId) {
  return db.prepare('SELECT * FROM planned_workouts WHERE program_id = ? ORDER BY date, program_slot').all(programId);
}

describe('POST /api/programs', () => {
  it('creates a program and generates every session', async () => {
    const start = nextMonday(Date.now() + 7 * DAY_MS); // fully future
    const { status, body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });
    expect(status).toBe(201);
    expect(body.progress.total_weeks).toBe(12);
    expect(body.training_days).toEqual([0, 1, 2, 3, 4]);
    expect(programRows(body.id)).toHaveLength(60);
    expect(db.prepare('SELECT COUNT(*) as c FROM programs').get().c).toBe(1);
  });

  it('rejects a second in-progress program with 409', async () => {
    const start = nextMonday(Date.now() + 7 * DAY_MS);
    await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4],
    });
    const second = await req('POST', '/api/programs', {
      preset_id: 'beginner-pete', start_date: start, training_days: [0, 2, 4],
    });
    expect(second.status).toBe(409);
  });

  it('rejects a race date that is too soon', async () => {
    const soon = iso(Date.now() + 5 * DAY_MS);
    const { status, body } = await req('POST', '/api/programs', {
      preset_id: '2k-prep', training_days: [1, 3, 5, 6], race_date: soon,
    });
    expect(status).toBe(400);
    expect(body.details.join(' ')).toMatch(/weeks away/);
  });

  it('auto-matches a same-day synced workout to a generated session', async () => {
    // Start two weeks ago on a Monday so early sessions are in the past.
    const start = nextMonday(Date.now() - 20 * DAY_MS);
    // The first steady session (slot 1, template wk0) is 8000m; put a matching
    // workout on that date.
    const firstSteadyDate = iso(Date.parse(start) + 1 * DAY_MS); // Tue = slot 1
    insertWorkout({ id: 900, date: `${firstSteadyDate}T06:30:00Z`, distance: 8100, timeMs: 1980000 });

    const { body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });
    const matched = programRows(body.id).find(r => r.completed_workout_id === 900);
    expect(matched).toBeTruthy();
    expect(matched.status).toBe('completed');
    expect(matched.match_type).toBe('auto');
  });
});

describe('POST /api/programs/:id/shift', () => {
  it('moves only future planned rows, freezing past and completed ones', async () => {
    const start = nextMonday(Date.now() - 20 * DAY_MS);
    const pastSteadyDate = iso(Date.parse(start) + 1 * DAY_MS);
    insertWorkout({ id: 901, date: `${pastSteadyDate}T06:30:00Z`, distance: 8100, timeMs: 1980000 });
    const { body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });

    const before = programRows(body.id);
    const completed = before.find(r => r.status === 'completed');
    const pastPlanned = before.find(r => r.status === 'planned' && r.date < todayStr);
    const futurePlanned = before.find(r => r.status === 'planned' && r.date >= todayStr);
    expect(completed && pastPlanned && futurePlanned).toBeTruthy();

    const shift = await req('POST', `/api/programs/${body.id}/shift`, { weeks: 1 });
    expect(shift.status).toBe(200);

    const after = new Map(programRows(body.id).map(r => [r.id, r.date]));
    expect(after.get(completed.id)).toBe(completed.date);       // frozen
    expect(after.get(pastPlanned.id)).toBe(pastPlanned.date);   // frozen (past)
    expect(after.get(futurePlanned.id)).toBe(iso(Date.parse(futurePlanned.date) + 7 * DAY_MS));
  });
});

describe('PATCH /api/programs/:id — pause and resume', () => {
  it('resume shifts future sessions forward by the elapsed weeks', async () => {
    const start = nextMonday(Date.now() + 7 * DAY_MS);
    const { body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });
    const futureBefore = programRows(body.id).find(r => r.date >= todayStr);

    await req('PATCH', `/api/programs/${body.id}`, { status: 'paused' });
    // Simulate a 10-day-old pause (→ ceil(10/7) = 2 weeks).
    const pausedAt = iso(Date.now() - 10 * DAY_MS);
    db.prepare('UPDATE programs SET paused_at = ? WHERE id = ?').run(pausedAt, body.id);

    const resume = await req('PATCH', `/api/programs/${body.id}`, { status: 'active' });
    expect(resume.status).toBe(200);
    expect(resume.body.status).toBe('active');
    expect(resume.body.paused_at).toBeNull();

    const after = db.prepare('SELECT date FROM planned_workouts WHERE id = ?').get(futureBefore.id).date;
    expect(after).toBe(iso(Date.parse(futureBefore.date) + 14 * DAY_MS));
  });
});

describe('PATCH /api/programs/:id — training days', () => {
  it('remaps future sessions to the new weekdays within their week', async () => {
    const start = nextMonday(Date.now() + 7 * DAY_MS);
    const { body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });
    const slot4Before = programRows(body.id).find(r => r.program_slot === 4 && r.program_week === 0);
    // Move to Mon/Tue/Wed/Thu/Sun — slot 4 goes from Fri (4) to Sun (6).
    const patch = await req('PATCH', `/api/programs/${body.id}`, { training_days: [0, 1, 2, 3, 6] });
    expect(patch.status).toBe(200);
    expect(patch.body.training_days).toEqual([0, 1, 2, 3, 6]);

    const slot4After = db.prepare('SELECT date FROM planned_workouts WHERE id = ?').get(slot4Before.id).date;
    expect(slot4After).toBe(iso(Date.parse(slot4Before.date) + 2 * DAY_MS)); // Fri → Sun
  });
});

describe('DELETE /api/programs/:id', () => {
  it('removes future planned rows but keeps history with program_id nulled', async () => {
    const start = nextMonday(Date.now() - 20 * DAY_MS);
    const pastSteadyDate = iso(Date.parse(start) + 1 * DAY_MS);
    insertWorkout({ id: 902, date: `${pastSteadyDate}T06:30:00Z`, distance: 8100, timeMs: 1980000 });
    const { body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });
    const completed = programRows(body.id).find(r => r.status === 'completed');

    const del = await req('DELETE', `/api/programs/${body.id}`);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as c FROM programs').get().c).toBe(0);

    // Completed history survives, now unlinked from the (deleted) program.
    const survivor = db.prepare('SELECT * FROM planned_workouts WHERE id = ?').get(completed.id);
    expect(survivor).toBeTruthy();
    expect(survivor.program_id).toBeNull();
    expect(survivor.status).toBe('completed');
    // No future program rows remain.
    const futureLeft = db.prepare(
      "SELECT COUNT(*) as c FROM planned_workouts WHERE program_id IS NOT NULL AND date >= ?"
    ).get(todayStr).c;
    expect(futureLeft).toBe(0);
  });
});

describe('generated rows work with the existing plans API', () => {
  it('allows editing and deleting a single generated session', async () => {
    const start = nextMonday(Date.now() + 7 * DAY_MS);
    const { body } = await req('POST', '/api/programs', {
      preset_id: 'pete-plan', start_date: start, training_days: [0, 1, 2, 3, 4], duration_weeks: 12,
    });
    const row = programRows(body.id)[0];

    const patch = await req('PATCH', `/api/plans/${row.id}`, { notes: 'felt strong' });
    expect(patch.status).toBe(200);
    expect(patch.body.notes).toBe('felt strong');
    // Program linkage is preserved through an ordinary plan edit.
    expect(db.prepare('SELECT program_id FROM planned_workouts WHERE id = ?').get(row.id).program_id).toBe(body.id);

    const del = await req('DELETE', `/api/plans/${row.id}`);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as c FROM planned_workouts WHERE id = ?').get(row.id).c).toBe(0);
  });
});
