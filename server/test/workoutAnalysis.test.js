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
    pace_ms: 120000, stroke_rate: 24, ...overrides,
  };
  db.prepare(`
    INSERT INTO workouts (id, profile_id, user_id, date, type, workout_type, distance, time_ms, pace_ms, stroke_rate, inferred_tag, synced_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(w.id, w.user_id, w.date, w.type, w.workout_type, w.distance, w.time_ms, w.pace_ms, w.stroke_rate, w.inferred_tag ?? 'endurance');
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
    expect(METRICS_VERSION).toBe(4);
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
