import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let computeWeekStreak;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-week-streak-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const analyticsModule = await import('../src/analytics.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ computeWeekStreak } = analyticsModule);

  initDb();
  db = getDb();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

let nextId = 1;
function addWorkout(date) {
  db.prepare(`
    INSERT INTO workouts (id, user_id, date, type, workout_type, distance, time_ms, pace_ms, synced_at)
    VALUES (?, 1, ?, 'rower', 'FixedDistanceSplits', 5000, 1200000, 120000, datetime('now'))
  `).run(nextId++, date);
}

describe('computeWeekStreak', () => {
  it('returns 0 with no workouts', () => {
    expect(computeWeekStreak(db)).toBe(0);
  });

  it('counts consecutive weeks', () => {
    addWorkout('2026-06-01T06:30:00Z'); // Mon, week of 1 Jun
    addWorkout('2026-06-10T06:30:00Z'); // Wed, week of 8 Jun
    addWorkout('2026-06-20T06:30:00Z'); // Sat, week of 15 Jun
    expect(computeWeekStreak(db)).toBe(3);
  });

  it('breaks on a missed week', () => {
    addWorkout('2026-06-01T06:30:00Z');
    addWorkout('2026-06-15T06:30:00Z'); // skips week of 8 Jun
    addWorkout('2026-06-17T06:30:00Z');
    expect(computeWeekStreak(db)).toBe(1);
  });

  it('multiple sessions in one week count once', () => {
    addWorkout('2026-06-15T06:30:00Z');
    addWorkout('2026-06-16T06:30:00Z');
    addWorkout('2026-06-19T06:30:00Z');
    expect(computeWeekStreak(db)).toBe(1);
  });

  it('survives a year boundary', () => {
    addWorkout('2025-12-22T06:30:00Z'); // Mon, week of 22 Dec 2025
    addWorkout('2025-12-30T06:30:00Z'); // Tue, week of 29 Dec 2025
    addWorkout('2026-01-07T06:30:00Z'); // Wed, week of 5 Jan 2026
    expect(computeWeekStreak(db)).toBe(3);
  });
});
