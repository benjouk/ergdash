import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let getSessionBenchmark;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-session-benchmark-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const routeModule = await import('../src/routes/workouts.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ getSessionBenchmark } = routeModule);

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();

  const settings = db.prepare('INSERT OR REPLACE INTO settings (profile_id, key, value) VALUES (1, ?, ?)');
  settings.run('sex', 'M');
  settings.run('birth_year', '1989');
  settings.run('weight_kg', '90');
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

let nextId = 100;

function insert(fields = {}) {
  const w = {
    id: nextId++,
    profile_id: 1,
    date: '2026-07-01 07:00:00',
    type: 'rower',
    workout_type: 'FixedDistanceSplits',
    distance: 2000,
    time_ms: 480000,
    pace_ms: 120000,
    inferred_tag: null,
    ...fields,
  };
  db.prepare(`
    INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, pace_ms, inferred_tag, synced_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(w.id, w.profile_id, w.date, w.type, w.workout_type, w.distance, w.time_ms, w.pace_ms, w.inferred_tag);
  return w;
}

describe('getSessionBenchmark', () => {
  it('benchmarks the profile best and near-maximal efforts at ranked distances', () => {
    const pb = insert({ time_ms: 480000, pace_ms: 120000 });
    const nearMax = insert({ time_ms: 500000, pace_ms: 125000 }); // 4.2% off
    const easy = insert({ time_ms: 560000, pace_ms: 140000 }); // 16.7% off

    const pbResult = getSessionBenchmark(db, pb);
    expect(pbResult).not.toBeNull();
    expect(pbResult.source).toBe('model');
    expect(pbResult.age_band).toBe('30-39');

    expect(getSessionBenchmark(db, nearMax)).not.toBeNull();
    expect(getSessionBenchmark(db, easy)).toBeNull();
  });

  it('excludes interval sessions and unranked distances', () => {
    const interval = insert({ inferred_tag: 'interval' });
    expect(getSessionBenchmark(db, interval)).toBeNull();

    const odd = insert({ distance: 3000, inferred_tag: null });
    expect(getSessionBenchmark(db, odd)).toBeNull();
  });

  it('requires the athlete profile', () => {
    db.prepare("DELETE FROM settings WHERE profile_id = 1 AND key = 'sex'").run();
    const pb = insert({});
    expect(getSessionBenchmark(db, pb)).toBeNull();
  });

  it('benchmarks exact 30-minute fixed-time pieces on pace', () => {
    const piece = insert({
      workout_type: 'FixedTimeSplits', distance: 7500, time_ms: 1800000, pace_ms: 120000,
    });
    const result = getSessionBenchmark(db, piece);
    expect(result).not.toBeNull();
    expect(result.source).toBe('model');

    // 20:00 over a non-ranked distance: neither a distance event nor a
    // ranked fixed-time duration.
    const oddDuration = insert({
      workout_type: 'FixedTimeSplits', distance: 5400, time_ms: 1200000, pace_ms: 111111,
    });
    expect(getSessionBenchmark(db, oddDuration)).toBeNull();
  });

  it('prefers a reconciled live bucket when cached', () => {
    const anchors = [[99, 88], [95, 93], [90, 96], [75, 100], [50, 106], [25, 112], [10, 121], [5, 127]];
    db.prepare(`
      INSERT INTO ranking_percentiles (bucket, season, total_entries, anchors_json, fetched_at)
      VALUES ('2026|d2000|M|30-39|hwt', 2026, 1069, ?, datetime('now'))
    `).run(JSON.stringify(anchors));

    const pb = insert({ time_ms: 480000, pace_ms: 120000 });
    const result = getSessionBenchmark(db, pb);
    expect(result.source).toBe('live');
    expect(result.n).toBe(1069);
    expect(result.approximate).toBe(false);
  });
});
