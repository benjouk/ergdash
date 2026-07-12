import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Encoder, Profile } from '@garmin/fitsdk';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

let dataDir;
let db;
let getDb;
let initDb;
let closeDb;
let insertWorkout;
let parseCsv;
let parseTcx;
let parseFit;
let validateNormalized;
let insertNormalizedWorkout;
let findDuplicate;
let computeMergeable;
let mergeIntoExisting;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ergdash-import-test-'));
  process.env.DATA_DIR = dataDir;

  vi.resetModules();
  const dbModule = await import('../src/db.js');
  const syncModule = await import('../src/sync.js');
  const csvModule = await import('../src/importers/csvImporter.js');
  const tcxModule = await import('../src/importers/tcxImporter.js');
  const fitModule = await import('../src/importers/fitImporter.js');
  const normalizeModule = await import('../src/importers/normalize.js');
  const dedupModule = await import('../src/importers/dedup.js');
  ({ getDb, initDb, closeDb } = dbModule);
  ({ insertWorkout } = syncModule);
  ({ parseCsv } = csvModule);
  ({ parseTcx } = tcxModule);
  ({ parseFit } = fitModule);
  ({ validateNormalized, insertNormalizedWorkout } = normalizeModule);
  ({ findDuplicate, computeMergeable, mergeIntoExisting } = dedupModule);

  initDb();
  db = getDb();
  db.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Test')").run();
});

afterEach(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function c2Workout(overrides) {
  return {
    id: 90000001,
    user_id: 42,
    date: '2024-03-01 06:30:00',
    timezone: 'UTC',
    type: 'rower',
    workout_type: 'FixedDistanceSplits',
    distance: 5000,
    time: 12000,
    stroke_rate: 22,
    stroke_count: 440,
    calories_total: 285,
    heart_rate: {},
    drag_factor: null,
    comments: null,
    ...overrides,
  };
}

// A minimal PM5-style FIT file: one session, one lap, per-10s records.
function buildFitBuffer() {
  const FIT_EPOCH_S = 631065600;
  const start = new Date('2024-06-07T09:00:00Z');
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'activity', manufacturer: 'concept2', timeCreated: start,
  });
  for (let i = 0; i < 30; i++) {
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(start.getTime() + i * 10000),
      distance: i * 45,
      speed: 4.2,
      heartRate: 130 + i,
      cadence: 24,
      power: 210,
    });
  }
  encoder.onMesg(Profile.MesgNum.LAP, {
    timestamp: new Date(start.getTime() + 290000), startTime: start,
    totalElapsedTime: 290, totalTimerTime: 290, totalDistance: 1305,
    avgHeartRate: 145, maxHeartRate: 160, avgCadence: 24, totalCalories: 80, totalCycles: 116,
  });
  encoder.onMesg(Profile.MesgNum.SESSION, {
    timestamp: new Date(start.getTime() + 290000), startTime: start,
    totalElapsedTime: 290, totalTimerTime: 290, totalDistance: 1305,
    avgHeartRate: 145, maxHeartRate: 160, avgCadence: 24, totalCalories: 80, totalCycles: 116,
    sport: 'rowing',
  });
  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: new Date(start.getTime() + 290000),
    // localDateTime is FIT-epoch seconds; UTC+2 machine clock.
    localTimestamp: Math.round((start.getTime() + 290000 + 2 * 3600 * 1000) / 1000) - FIT_EPOCH_S,
    numSessions: 1,
  });
  return Buffer.from(encoder.close());
}

describe('parseCsv', () => {
  it('parses a Concept2 Logbook export, skipping non-rowing rows', () => {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    const { workouts, errors } = parseCsv(buffer, 'concept2-export.csv');

    expect(errors).toEqual([]);
    expect(workouts).toHaveLength(2); // SkiErg row skipped

    const first = workouts[0];
    expect(first.date).toBe('2024-03-01 06:30:00');
    expect(first.distance).toBe(5000);
    expect(first.time_ms).toBe(1200000);
    expect(first.stroke_rate).toBe(22);
    expect(first.heart_rate_avg).toBe(148);
    expect(first.drag_factor).toBe(118);
    expect(first.comments).toBe('steady state, felt good'); // Comments beats Description
    expect(first.source_meta.c2_log_id).toBe(90000001);
    expect(validateNormalized(first).ok).toBe(true);
  });

  it('parses a generic training-log CSV and back-computes nothing it lacks', () => {
    const buffer = readFileSync(join(fixturesDir, 'generic.csv'));
    const { workouts, errors } = parseCsv(buffer, 'generic.csv');

    expect(errors).toEqual([]);
    expect(workouts).toHaveLength(2);
    expect(workouts[0].date).toBe('2024-04-01 00:00:00');
    expect(workouts[0].distance).toBe(10000);
    expect(workouts[0].time_ms).toBe(2550000);
    expect(workouts[0].heart_rate_avg).toBe(141);
    expect(workouts[0].comments).toBe('long steady row');
    expect(workouts[0].source_meta.c2_log_id).toBeNull();
    expect(validateNormalized(workouts[0]).ok).toBe(true);
  });

  it('reports a file error for CSVs without recognizable columns', () => {
    const { workouts, errors } = parseCsv(Buffer.from('a,b\n1,2\n'), 'junk.csv');
    expect(workouts).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('parseTcx', () => {
  it('maps laps to intervals (rest detected by zero distance) and trackpoints to samples', () => {
    const buffer = readFileSync(join(fixturesDir, 'sample.tcx'));
    const { workouts, errors } = parseTcx(buffer, 'sample.tcx');

    expect(errors).toEqual([]);
    expect(workouts).toHaveLength(1);
    const workout = workouts[0];
    expect(workout.distance).toBe(2000);
    expect(workout.time_ms).toBe(478000); // work laps only, rest excluded
    expect(workout.workout_type).toBe('VariableInterval');
    expect(workout.heart_rate_max).toBe(175);
    expect(workout.intervals.map(iv => iv.type)).toEqual(['work', 'rest', 'work']);
    expect(workout.samples).toHaveLength(3);
    expect(workout.samples[0].time_s).toBe(10);
    expect(validateNormalized(workout).ok).toBe(true);
  });
});

describe('parseFit', () => {
  it('decodes session totals, converts the machine clock, and maps records to samples', () => {
    const { workouts, errors } = parseFit(buildFitBuffer(), 'pm5.fit');

    expect(errors).toEqual([]);
    expect(workouts).toHaveLength(1);
    const workout = workouts[0];
    expect(workout.date).toBe('2024-06-07 11:00:00'); // UTC+2 wall clock
    expect(workout.distance).toBe(1305);
    expect(workout.time_ms).toBe(290000);
    expect(workout.heart_rate_avg).toBe(145);
    expect(workout.stroke_rate).toBe(24);
    expect(workout.samples).toHaveLength(30);
    expect(workout.samples[5].heart_rate).toBe(135);
    expect(workout.samples[5].watts).toBe(210);
    expect(validateNormalized(workout).ok).toBe(true);
  });

  it('rejects non-FIT bytes with a file error, not an exception', () => {
    const { workouts, errors } = parseFit(Buffer.from('definitely not fit data'), 'junk.fit');
    expect(workouts).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('findDuplicate', () => {
  function csvWorkout() {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    return parseCsv(buffer, 'concept2-export.csv').workouts[0];
  }

  it('matches by Concept2 log id first', () => {
    insertWorkout(db, c2Workout(), 1);
    const found = findDuplicate(db, csvWorkout(), 'aa:0', 1);
    expect(found.status).toBe('exact');
    expect(found.matched_on).toEqual(['log_id']);
    expect(found.match.id).toBe(90000001);
  });

  it('matches fuzzily on distance/time/start when there is no log id', () => {
    insertWorkout(db, c2Workout({ date: '2024-03-01 06:32:00' }), 1);
    const workout = csvWorkout();
    workout.source_meta.c2_log_id = null;

    const found = findDuplicate(db, workout, 'aa:0', 1);
    expect(found.status).toBe('exact');
    expect(found.matched_on).toContain('start_time');
  });

  it('flags same-day matches outside the start window as likely', () => {
    insertWorkout(db, c2Workout({ date: '2024-03-01 18:00:00' }), 1);
    const workout = csvWorkout();
    workout.source_meta.c2_log_id = null;

    const found = findDuplicate(db, workout, 'aa:0', 1);
    expect(found.status).toBe('likely');
  });

  it('returns null when nothing matches', () => {
    insertWorkout(db, c2Workout({ distance: 6000, time: 14000 }), 1);
    const workout = csvWorkout();
    workout.source_meta.c2_log_id = null;
    expect(findDuplicate(db, workout, 'aa:0', 1)).toBeNull();
  });

  it('short-circuits to already_imported on a fingerprint hit', () => {
    const workout = csvWorkout();
    insertNormalizedWorkout(db, workout, 'aa:0', 1);
    const found = findDuplicate(db, workout, 'aa:0', 1);
    expect(found.status).toBe('already_imported');
  });
});

describe('insertNormalizedWorkout', () => {
  it('writes a negative-id import row with intervals, samples, and derived summary fields', () => {
    const buffer = readFileSync(join(fixturesDir, 'sample.tcx'));
    const workout = parseTcx(buffer, 'sample.tcx').workouts[0];

    const id = insertNormalizedWorkout(db, workout, 'bb:0', 1);
    expect(id).toBe(-1);

    const row = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
    expect(row.source).toBe('import');
    expect(row.import_fingerprint).toBe('bb:0');
    expect(row.pace_ms).toBe(Math.round((478000 / 2000) * 500));
    expect(row.has_stroke_data).toBe(1);
    expect(row.heart_rate_avg).toBeGreaterThan(0); // derived from samples
    expect(db.prepare('SELECT COUNT(*) as c FROM intervals WHERE workout_id = ?').get(id).c).toBe(3);
    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = ?').get(id).c).toBe(3);
  });

  it('enforces fingerprint uniqueness', () => {
    const buffer = readFileSync(join(fixturesDir, 'sample.tcx'));
    const workout = parseTcx(buffer, 'sample.tcx').workouts[0];
    insertNormalizedWorkout(db, workout, 'cc:0', 1);
    expect(() => insertNormalizedWorkout(db, workout, 'cc:0', 1)).toThrow();
  });
});

describe('mergeIntoExisting', () => {
  it('fills only missing scalars, records them in edited_fields, and stamps the fingerprint', () => {
    insertWorkout(db, c2Workout(), 1); // no HR, no drag
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    const workout = parseCsv(buffer, 'concept2-export.csv').workouts[0];

    const existing = db.prepare('SELECT * FROM workouts WHERE id = 90000001').get();
    const mergeable = computeMergeable(db, existing, workout);
    expect(mergeable.fields).toContain('heart_rate_avg');
    expect(mergeable.fields).toContain('drag_factor');
    expect(mergeable.fields).not.toContain('stroke_rate'); // already present

    const result = mergeIntoExisting(db, existing, workout, 'dd:0');
    expect(result.filledFields.sort()).toEqual(['drag_factor', 'heart_rate_avg']);

    const after = db.prepare('SELECT * FROM workouts WHERE id = 90000001').get();
    expect(after.heart_rate_avg).toBe(148);
    expect(after.drag_factor).toBe(118);
    expect(after.stroke_rate).toBe(22); // untouched
    expect(after.import_fingerprint).toBe('dd:0');
    expect(JSON.parse(after.edited_fields).sort()).toEqual(['drag_factor', 'heart_rate_avg']);
  });

  it('a later sync does not null the merged fields back out', async () => {
    insertWorkout(db, c2Workout(), 1);
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    const workout = parseCsv(buffer, 'concept2-export.csv').workouts[0];
    const existing = db.prepare('SELECT * FROM workouts WHERE id = 90000001').get();
    mergeIntoExisting(db, existing, workout, 'ee:0');

    // C2 sends an updated payload still missing HR/drag.
    insertWorkout(db, c2Workout({ comments: 'edited on logbook' }), 1);

    const after = db.prepare('SELECT heart_rate_avg, drag_factor, comments FROM workouts WHERE id = 90000001').get();
    expect(after.heart_rate_avg).toBe(148);
    expect(after.drag_factor).toBe(118);
    expect(after.comments).toBe('edited on logbook');
  });

  it('adds strokes and intervals only when the target has none', () => {
    insertWorkout(db, c2Workout({
      distance: 2000, time: 4780, date: '2024-05-05 12:00:00',
      workout: { intervals: [{ type: 'distance', distance: 2000, time: 4780 }] },
    }), 1);
    const buffer = readFileSync(join(fixturesDir, 'sample.tcx'));
    const workout = parseTcx(buffer, 'sample.tcx').workouts[0];

    const existing = db.prepare('SELECT * FROM workouts WHERE id = 90000001').get();
    const mergeable = computeMergeable(db, existing, workout);
    expect(mergeable.intervals).toBe(false); // target already has intervals
    expect(mergeable.strokes).toBe(true);

    mergeIntoExisting(db, existing, workout, 'ff:0');
    expect(db.prepare('SELECT COUNT(*) as c FROM strokes WHERE workout_id = 90000001').get().c).toBe(3);
    expect(db.prepare('SELECT has_stroke_data FROM workouts WHERE id = 90000001').get().has_stroke_data).toBe(1);
    // Intervals kept from C2, not replaced by the import's 3 rows.
    expect(db.prepare('SELECT COUNT(*) as c FROM intervals WHERE workout_id = 90000001').get().c).toBe(1);
  });
});

describe('resolveMergeTarget', () => {
  function csvWorkout() {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    return parseCsv(buffer, 'concept2-export.csv').workouts[0];
  }

  it('accepts the target that duplicate detection actually finds', async () => {
    const { resolveMergeTarget } = await import('../src/importers/dedup.js');
    insertWorkout(db, c2Workout(), 1);

    const resolved = resolveMergeTarget(db, csvWorkout(), 'gg:0', 90000001, 1);
    expect(resolved.error).toBeUndefined();
    expect(resolved.target.id).toBe(90000001);
  });

  it('rejects a target_id that is not the detected duplicate', async () => {
    const { resolveMergeTarget } = await import('../src/importers/dedup.js');
    insertWorkout(db, c2Workout(), 1); // the real duplicate
    insertWorkout(db, c2Workout({ id: 90000009, date: '2023-01-01 06:00:00', distance: 6000, time: 15000 }), 1); // unrelated victim

    const resolved = resolveMergeTarget(db, csvWorkout(), 'gg:0', 90000009, 1);
    expect(resolved.error).toMatch(/does not match the detected duplicate/);
    // Unrelated row untouched.
    const victim = db.prepare('SELECT import_fingerprint, edited_fields FROM workouts WHERE id = 90000009').get();
    expect(victim.import_fingerprint).toBeNull();
    expect(victim.edited_fields).toBeNull();
  });

  it('rejects a merge when no duplicate exists at all', async () => {
    const { resolveMergeTarget } = await import('../src/importers/dedup.js');
    insertWorkout(db, c2Workout({ id: 90000009, date: '2023-01-01 06:00:00', distance: 6000, time: 15000 }), 1);

    const workout = csvWorkout();
    workout.source_meta.c2_log_id = null;
    const resolved = resolveMergeTarget(db, workout, 'gg:0', 90000009, 1);
    expect(resolved.error).toMatch(/no duplicate detected/);
  });
});

describe('spoofed c2_log_id', () => {
  function csvWorkout() {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    return parseCsv(buffer, 'concept2-export.csv').workouts[0];
  }

  it('ignores a log id whose workout data does not corroborate it', () => {
    // Victim workout with completely different distance/time.
    insertWorkout(db, c2Workout({ id: 90000009, date: '2023-01-01 06:00:00', distance: 6000, time: 15000 }), 1);

    const workout = csvWorkout(); // 5000m / 20:00
    workout.source_meta.c2_log_id = 90000009; // spoofed

    expect(findDuplicate(db, workout, 'hh:0', 1)).toBeNull();
  });

  it('rejects a merge commit that spoofs c2_log_id to name an arbitrary target', async () => {
    const { resolveMergeTarget } = await import('../src/importers/dedup.js');
    insertWorkout(db, c2Workout({ id: 90000009, date: '2023-01-01 06:00:00', distance: 6000, time: 15000 }), 1);

    const workout = csvWorkout();
    workout.source_meta.c2_log_id = 90000009;

    const resolved = resolveMergeTarget(db, workout, 'hh:0', 90000009, 1);
    expect(resolved.error).toMatch(/no duplicate detected/);
    const victim = db.prepare('SELECT import_fingerprint, edited_fields FROM workouts WHERE id = 90000009').get();
    expect(victim.import_fingerprint).toBeNull();
    expect(victim.edited_fields).toBeNull();
  });

  it('still honors a legitimate log id whose numbers agree', () => {
    insertWorkout(db, c2Workout(), 1); // 90000001, 5000m / 20:00 — matches the CSV row
    const found = findDuplicate(db, csvWorkout(), 'hh:0', 1);
    expect(found.status).toBe('exact');
    expect(found.matched_on).toEqual(['log_id']);
  });
});

describe('spoofed c2_log_id with matching distance/time', () => {
  function csvWorkout() {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));
    return parseCsv(buffer, 'concept2-export.csv').workouts[0]; // 5000m / 20:00 on 2024-03-01
  }

  it('ignores a log id naming a different-day workout even when distance/time agree', () => {
    // Victim: identical 5000m / 20:00 piece, months earlier.
    insertWorkout(db, c2Workout({ id: 90000009, date: '2023-11-14 06:30:00' }), 1);

    const workout = csvWorkout();
    workout.source_meta.c2_log_id = 90000009; // spoofed

    expect(findDuplicate(db, workout, 'ii:0', 1)).toBeNull();
  });

  it('rejects the corresponding merge commit', async () => {
    const { resolveMergeTarget } = await import('../src/importers/dedup.js');
    insertWorkout(db, c2Workout({ id: 90000009, date: '2023-11-14 06:30:00' }), 1);

    const workout = csvWorkout();
    workout.source_meta.c2_log_id = 90000009;

    const resolved = resolveMergeTarget(db, workout, 'ii:0', 90000009, 1);
    expect(resolved.error).toMatch(/no duplicate detected/);
    const victim = db.prepare('SELECT import_fingerprint, edited_fields FROM workouts WHERE id = 90000009').get();
    expect(victim.import_fingerprint).toBeNull();
    expect(victim.edited_fields).toBeNull();
  });

  it('still matches a legitimate log id when only the clock representation drifts', () => {
    // Same day, start times an hour apart (e.g. timezone representation drift
    // between the CSV export and the API payload).
    insertWorkout(db, c2Workout({ date: '2024-03-01 07:30:00' }), 1);
    const found = findDuplicate(db, csvWorkout(), 'ii:0', 1);
    expect(found.status).toBe('exact');
    expect(found.matched_on).toEqual(['log_id']);
    expect(found.match.id).toBe(90000001);
  });
});

describe('import route → active profile (end-to-end)', () => {
  let server;
  let base;

  beforeEach(async () => {
    const express = (await import('express')).default;
    const { resolveProfile } = await import('../src/middleware/profile.js');
    const importRouter = (await import('../src/routes/import.js')).default;
    // The file-level beforeEach already created profile 1 and the DB.
    db.prepare("INSERT INTO profiles (id, name) VALUES (2, 'Other')").run();

    const app = express();
    app.use('/api/import', resolveProfile, importRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  async function preview(profileId, buffer, filename) {
    const res = await fetch(`${base}/api/import/preview?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Profile-Id': String(profileId) },
      body: buffer,
    });
    return res.json();
  }

  async function commit(profileId, payload) {
    const res = await fetch(`${base}/api/import/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': String(profileId) },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  }

  function newRowsPayload(prev) {
    return prev.workouts
      .filter(w => w.suggested_action === 'new')
      .map(w => ({ index: w.index, action: 'new', normalized: w.normalized }));
  }

  const countImported = (profileId) =>
    db.prepare("SELECT COUNT(*) c FROM workouts WHERE profile_id = ? AND source = 'import'").get(profileId).c;

  it('commits imported runs under the active profile and keeps profiles independent', async () => {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));

    const prev1 = await preview(1, buffer, 'concept2-export.csv');
    const rows1 = newRowsPayload(prev1);
    expect(rows1.length).toBeGreaterThan(0);

    const commit1 = await commit(1, { fingerprint_base: prev1.fingerprint_base, workouts: rows1 });
    expect(commit1.status).toBe(200);
    expect(commit1.body.created.length).toBe(rows1.length);

    // The runs belong to the active profile only.
    expect(countImported(1)).toBe(rows1.length);
    expect(countImported(2)).toBe(0);

    // The same file imports independently under profile 2 — fingerprints are
    // per-profile, so profile 2 sees the rows as NEW, not already-imported.
    const prev2 = await preview(2, buffer, 'concept2-export.csv');
    const rows2 = newRowsPayload(prev2);
    expect(rows2.length).toBe(rows1.length);

    const commit2 = await commit(2, { fingerprint_base: prev2.fingerprint_base, workouts: rows2 });
    expect(commit2.status).toBe(200);
    expect(countImported(2)).toBe(rows1.length);
    expect(countImported(1)).toBe(rows1.length); // profile 1 untouched
  });

  it('re-importing the same file under the same profile is deduped', async () => {
    const buffer = readFileSync(join(fixturesDir, 'concept2-export.csv'));

    const prev = await preview(1, buffer, 'concept2-export.csv');
    await commit(1, { fingerprint_base: prev.fingerprint_base, workouts: newRowsPayload(prev) });
    const afterFirst = countImported(1);

    // A second preview of the same file flags its rows as already-imported for
    // this profile, so nothing new is suggested.
    const prev2 = await preview(1, buffer, 'concept2-export.csv');
    expect(prev2.workouts.some(w => w.duplicate?.status === 'already_imported')).toBe(true);
    expect(newRowsPayload(prev2).length).toBe(0);
    expect(countImported(1)).toBe(afterFirst);
  });
});
