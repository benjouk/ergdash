import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let computeMetricsForWorkout;
let computeAllMetrics;
let ANALYSIS_VERSION;
let METRICS_VERSION;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-analysis-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  ({ getDb, initDb, closeDb } = await import('../src/db.js'));
  ({
    computeMetricsForWorkout,
    computeAllMetrics,
    ANALYSIS_VERSION,
    METRICS_VERSION,
  } = await import('../src/analytics.js'));

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function insertWorkout(id, overrides = {}) {
  const w = {
    id, user_id: 42, date: `2024-01-0${id} 08:00:00`, type: 'rower',
    workout_type: 'FixedDistanceSplits', distance: 2000, time_ms: 480000,
    pace_ms: 120000, stroke_rate: 24, stroke_count: null,
    heart_rate_avg: null, heart_rate_max: null, has_stroke_data: 0,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO workouts (
      id, profile_id, user_id, date, type, workout_type, distance, time_ms,
      pace_ms, stroke_rate, stroke_count, heart_rate_avg, heart_rate_max,
      has_stroke_data, inferred_tag, synced_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    w.id, w.user_id, w.date, w.type, w.workout_type, w.distance, w.time_ms,
    w.pace_ms, w.stroke_rate, w.stroke_count, w.heart_rate_avg, w.heart_rate_max,
    w.has_stroke_data, w.inferred_tag ?? 'endurance'
  );
  return w;
}

function insertStrokes(workoutId, n, hr = 150) {
  const stmt = db.prepare(`
    INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m, pace_ms, watts, stroke_rate, heart_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < n; i++) {
    stmt.run(workoutId, i, i * 2, i * 20, 120000, 200, 24, hr);
  }
}

function insertPaddedStrokes(workoutId) {
  const stmt = db.prepare(`
    INSERT INTO strokes (workout_id, stroke_number, time_s, distance_m, pace_ms, watts, stroke_rate, heart_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let strokeNumber = 0;
  let timeS = 0;
  let distanceM = 0;

  const addSection = (count, { dt, pace, watts, rate, hr }) => {
    for (let i = 0; i < count; i++) {
      timeS += dt;
      distanceM += 10;
      stmt.run(workoutId, strokeNumber++, timeS, distanceM, pace, watts, rate, hr);
    }
  };

  addSection(50, { dt: 3, pace: 150000, watts: 100, rate: 20, hr: 130 });
  addSection(200, { dt: 2.4, pace: 120000, watts: 240, rate: 24, hr: 160 });
  addSection(50, { dt: 3.6, pace: 180000, watts: 60, rate: 18, hr: 110 });
}

describe('workout analysis persistence', () => {
  it('migration 016 adds analysis columns to computed_metrics', () => {
    const cols = db.prepare('PRAGMA table_info(computed_metrics)').all().map(c => c.name);
    expect(cols).toContain('analysis_json');
    expect(cols).toContain('analysis_version');
  });

  it('computeMetricsForWorkout stores a versioned analysis object', () => {
    insertWorkout(1);
    insertStrokes(1, 100);
    computeMetricsForWorkout(1);

    const row = db.prepare('SELECT analysis_json, analysis_version, metrics_version FROM computed_metrics WHERE workout_id = 1').get();
    expect(row.analysis_version).toBe(ANALYSIS_VERSION);
    expect(row.metrics_version).toBe(METRICS_VERSION);
    expect(METRICS_VERSION).toBe(7);
    const analysis = JSON.parse(row.analysis_json);
    expect(analysis.version).toBe(ANALYSIS_VERSION);
    expect(analysis.structure.value).toBe('continuous');
    expect(analysis.execution.pacing.value).toBe('even');
    expect(analysis.phases).toHaveLength(5);
  });

  it('computeAllMetrics recomputes rows with a stale analysis_version', () => {
    insertWorkout(1);
    insertStrokes(1, 100);
    computeMetricsForWorkout(1);
    // Simulate a pre-existing row written by an older analysis version.
    db.prepare('UPDATE computed_metrics SET analysis_version = 0, analysis_json = NULL WHERE workout_id = 1').run();

    computeAllMetrics(1);

    const row = db.prepare('SELECT analysis_json, analysis_version FROM computed_metrics WHERE workout_id = 1').get();
    expect(row.analysis_version).toBe(ANALYSIS_VERSION);
    expect(JSON.parse(row.analysis_json).structure.value).toBe('continuous');
  });

  it('computeAllMetrics recomputes rows with a stale metrics_version', () => {
    insertWorkout(1);
    insertStrokes(1, 100);
    computeMetricsForWorkout(1);
    db.prepare('UPDATE computed_metrics SET metrics_version = 0 WHERE workout_id = 1').run();

    computeAllMetrics(1);

    const row = db.prepare('SELECT metrics_version FROM computed_metrics WHERE workout_id = 1').get();
    expect(row.metrics_version).toBe(METRICS_VERSION);
  });

  it('recomputes piece-scoped metrics and cached zones from a scored window', () => {
    db.prepare("INSERT OR REPLACE INTO settings (profile_id, key, value) VALUES (1, 'max_hr', '200')").run();
    insertWorkout(1, {
      heart_rate_avg: 160,
      heart_rate_max: 170,
      has_stroke_data: 1,
    });
    insertPaddedStrokes(1);

    // Simulate the deployment state: computed metrics and zone rows already
    // exist, but were written by the pre-window persistence algorithm.
    db.prepare(`
      INSERT INTO computed_metrics (workout_id, metrics_version, analysis_version)
      VALUES (1, ?, ?)
    `).run(METRICS_VERSION - 1, ANALYSIS_VERSION);
    db.prepare(`
      INSERT INTO hr_zone_time (workout_id, zone, time_s, source)
      VALUES (1, 2, 810, 'strokes')
    `).run();

    computeAllMetrics(1);

    const metrics = db.prepare(`
      SELECT fade_index, consistency, watts_per_beat, metrics_version, analysis_json
      FROM computed_metrics WHERE workout_id = 1
    `).get();
    expect(metrics.metrics_version).toBe(METRICS_VERSION);
    expect(metrics.fade_index).toBeCloseTo(0, 6);
    expect(metrics.consistency).toBeCloseTo(100, 6);
    expect(metrics.watts_per_beat).toBeCloseTo(1.5, 6);
    expect(JSON.parse(metrics.analysis_json).analysis_window).not.toBeNull();

    const zones = db.prepare(`
      SELECT zone, time_s, source FROM hr_zone_time
      WHERE workout_id = 1 ORDER BY zone
    `).all();
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ zone: 3, source: 'strokes' });
    expect(zones[0].time_s).toBeCloseTo(480, 6);
  });

  it('excludes the current workout from its own intensity benchmark', () => {
    // No HR and only one workout at the distance → no benchmark → intensity
    // unknown, rather than judging the row as maximal against itself.
    insertWorkout(1);
    insertStrokes(1, 100, null);
    computeMetricsForWorkout(1);
    const analysis = JSON.parse(db.prepare('SELECT analysis_json FROM computed_metrics WHERE workout_id = 1').get().analysis_json);
    expect(analysis.execution.intensity.value).toBe('unknown');
  });

  it('reads an aerobic-HR row as easy/moderate, not maximal', () => {
    db.prepare("INSERT OR REPLACE INTO settings (profile_id, key, value) VALUES (1, 'max_hr', '190')").run();
    insertWorkout(1);
    insertStrokes(1, 100, 125); // ~Z2 against a 190 max
    computeMetricsForWorkout(1);
    const analysis = JSON.parse(db.prepare('SELECT analysis_json FROM computed_metrics WHERE workout_id = 1').get().analysis_json);
    expect(['easy', 'moderate']).toContain(analysis.execution.intensity.value);
    expect(analysis.execution.intensity.basis).toMatch(/HR zone/);
  });
});
