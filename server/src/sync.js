import cron from 'node-cron';
import { getDb } from './db.js';
import { getValidToken, fetchC2Api } from './auth.js';
import {
  tagAllWorkouts,
  computeAllMetrics,
  computeFitnessLog,
  computePredictions,
  computeAllZoneTimes,
  computeAllBestEfforts,
  computeMetricsForWorkout,
  computeZoneTimesForWorkout,
  computeBestEffortsForWorkout,
} from './analytics.js';
import { detectNewPbs, reconcilePbDistances } from './pbDetection.js';
import { matchNewWorkouts } from './planMatching.js';
import { parseEditedFields, computePaceMs } from './workoutFields.js';

let syncInProgress = false;

export function isSyncInProgress() {
  return syncInProgress;
}

function setSyncState(key, value) {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
}

function getSyncStateValue(key) {
  const db = getDb();
  const row = db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key);
  return row?.value || null;
}

export function getSyncStatus() {
  const db = getDb();
  const workoutCount = db.prepare('SELECT COUNT(*) as count FROM workouts').get().count;
  // Enrichment only applies to Concept2-synced rows; manual/imported workouts
  // have no stroke stream to fetch and must not skew the progress numbers.
  const c2Count = db.prepare("SELECT COUNT(*) as count FROM workouts WHERE source = 'c2'").get().count;
  const enrichedCount = db.prepare("SELECT COUNT(*) as count FROM workouts WHERE source = 'c2' AND has_stroke_data = 1").get().count;
  const remaining = c2Count - enrichedCount;

  // Estimate based on 10 workouts per 5 minutes (1 req/sec + processing)
  const estimatedSecondsRemaining = remaining > 0 ? Math.ceil((remaining / 10) * 300) : 0;

  return {
    status: getSyncStateValue('sync_status') || 'idle',
    last_completed: getSyncStateValue('last_sync_completed'),
    total_workouts: workoutCount,
    enriched_workouts: enrichedCount,
    remaining_workouts: remaining,
    enrichment_progress: c2Count > 0 ? Math.round((enrichedCount / c2Count) * 100) : 100,
    estimated_seconds_remaining: estimatedSecondsRemaining,
    sync_progress: getSyncStateValue('sync_progress'),
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Expand C2 API interval objects into work+rest rows for our DB.
// C2 intervals are all work reps; rest is indicated by a rest_time field
// on each interval (the C2 "type" field means "time"/"distance", not work/rest).
function expandC2Intervals(c2Intervals) {
  const rows = [];
  for (const iv of c2Intervals) {
    rows.push({
      type: 'work',
      distance: iv.distance || 0,
      time: iv.time || null,
      stroke_rate: iv.stroke_rate || null,
      stroke_count: iv.stroke_count || null,
      calories_total: iv.calories_total || null,
      heart_rate: iv.heart_rate || null,
    });
    if (iv.rest_time > 0) {
      rows.push({
        type: 'rest',
        distance: iv.rest_distance || 0,
        time: iv.rest_time,
        stroke_rate: null,
        stroke_count: null,
        calories_total: null,
        heart_rate: null,
      });
    }
  }
  return rows;
}

// Extract C2 intervals from a result object.
// The bulk list nests them at result.workout.intervals;
// the detail endpoint wraps in { data: { ... workout: { intervals } } }.
function extractC2Intervals(result) {
  const raw = result?.workout?.intervals;
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return [];
}

// Fetch intervals from the C2 detail endpoint for a single workout.
// Returns expanded work+rest rows (may be empty).
async function fetchIntervalsFromC2(id, token) {
  try {
    const resp = await fetchC2Api(`/api/users/me/results/${id}`, token);
    const inner = resp.data || resp;
    const raw = extractC2Intervals(inner);
    if (raw.length > 0) {
      console.log(`  Workout ${id}: fetched ${raw.length} intervals from detail endpoint`);
      return expandC2Intervals(raw);
    }
  } catch (err) {
    console.log(`  Workout ${id}: detail endpoint failed (${err.message})`);
  }
  return [];
}

// Build interval rows from stroke data by detecting rest gaps (time jumps
// without distance progress). Used as a last resort when the C2 API doesn't
// return interval data but the workout is known to be interval-type.
function inferIntervalsFromStrokes(db, workoutId) {
  const workout = db.prepare(
    'SELECT rest_time_ms, distance FROM workouts WHERE id = ?'
  ).get(workoutId);
  if (!workout || !workout.rest_time_ms || workout.rest_time_ms <= 0) return [];

  const strokes = db.prepare(
    'SELECT time_s, distance_m, pace_ms, stroke_rate, heart_rate FROM strokes WHERE workout_id = ? ORDER BY stroke_number'
  ).all(workoutId);
  if (strokes.length < 4) return [];

  const reps = [];
  let repStart = 0;
  for (let i = 1; i < strokes.length; i++) {
    const dt = strokes[i].time_s - strokes[i - 1].time_s;
    const dd = strokes[i].distance_m - strokes[i - 1].distance_m;
    if (dt > 5 && dd < 5) {
      reps.push({ startIdx: repStart, endIdx: i - 1 });
      repStart = i;
    }
  }
  reps.push({ startIdx: repStart, endIdx: strokes.length - 1 });

  if (reps.length < 2) return [];

  const intervals = [];
  for (let r = 0; r < reps.length; r++) {
    const rep = reps[r];
    const repStrokes = strokes.slice(rep.startIdx, rep.endIdx + 1);
    const dist = repStrokes[repStrokes.length - 1].distance_m - repStrokes[0].distance_m;
    const timeSec = repStrokes[repStrokes.length - 1].time_s - repStrokes[0].time_s;
    const avgSR = repStrokes.reduce((s, st) => s + (st.stroke_rate || 0), 0) / repStrokes.length;
    const avgHR = repStrokes.filter(s => s.heart_rate).reduce((s, st) => s + st.heart_rate, 0)
      / (repStrokes.filter(s => s.heart_rate).length || 1);

    intervals.push({
      type: 'work',
      distance: Math.round(dist),
      time: Math.round(timeSec * 10),
      stroke_rate: Math.round(avgSR),
      stroke_count: repStrokes.length,
      calories_total: null,
      heart_rate: avgHR > 0 ? { average: Math.round(avgHR), max: null } : null,
    });

    if (r < reps.length - 1) {
      const restStart = strokes[rep.endIdx].time_s;
      const restEnd = strokes[reps[r + 1].startIdx].time_s;
      intervals.push({
        type: 'rest',
        distance: 0,
        time: Math.round((restEnd - restStart) * 10),
        stroke_rate: null,
        stroke_count: null,
        calories_total: null,
        heart_rate: null,
      });
    }
  }

  console.log(`  Workout ${workoutId}: inferred ${reps.length} reps from stroke data`);
  return intervals;
}

export function writeIntervals(db, workoutId, intervals) {
  db.prepare('DELETE FROM intervals WHERE workout_id = ?').run(workoutId);
  if (!intervals || intervals.length === 0) return;

  const intervalStmt = db.prepare(`
    INSERT INTO intervals (
      workout_id, interval_index, type, distance, time_ms,
      pace_ms, stroke_rate, stroke_count, calories,
      heart_rate_avg, heart_rate_max
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  intervals.forEach((iv, idx) => {
    const ivTimeMs = iv.time ? Math.round(iv.time * 100) : null;
    const ivPaceMs = (ivTimeMs > 0 && iv.distance > 0)
      ? Math.round((ivTimeMs / iv.distance) * 500)
      : null;
    intervalStmt.run(
      workoutId, idx, iv.type || 'work',
      iv.distance, ivTimeMs, ivPaceMs,
      iv.stroke_rate, iv.stroke_count, iv.calories_total,
      iv.heart_rate?.average || null, iv.heart_rate?.max || null
    );
  });
}

// Map a Concept2 API result object onto our workouts columns. Shared by sync
// updates and the revert-to-Concept2 endpoint so both apply the same
// conversions (C2 times are in tenths of seconds).
export function c2ColumnValues(workout) {
  const timeMs = workout.time ? Math.round(workout.time * 100) : 0;
  return {
    user_id: workout.user_id ?? null,
    date: workout.date ?? null,
    timezone: workout.timezone ?? null,
    type: workout.type || 'rower',
    workout_type: workout.workout_type || 'FixedDistanceSplits',
    distance: workout.distance ?? null,
    time_ms: timeMs,
    stroke_rate: workout.stroke_rate ?? null,
    stroke_count: workout.stroke_count ?? null,
    calories: workout.calories_total ?? null,
    heart_rate_avg: workout.heart_rate?.average || null,
    heart_rate_max: workout.heart_rate?.max || null,
    drag_factor: workout.drag_factor ?? null,
    comments: workout.comments ?? null,
    rest_distance: workout.rest_distance || null,
    rest_time_ms: workout.rest_time ? Math.round(workout.rest_time * 100) : null,
  };
}

// Returns { id, inserted, affectedDistances } — inserted is true only for
// brand-new workouts, so callers (e.g. PB detection) don't treat updates as
// new results. affectedDistances lists distances whose PB history may need
// reconciling because this update changed a C2-owned performance field.
export function insertWorkout(db, workout) {
  const rawJson = JSON.stringify(workout);
  const existing = db.prepare(
    'SELECT raw_json, distance, pace_ms, time_ms, source, edited_fields FROM workouts WHERE id = ?'
  ).get(workout.id);
  // Manual/imported rows are user-owned; sync must never touch them. (IDs
  // can't actually collide — non-C2 rows use negative IDs — but be explicit.)
  if (existing && existing.source !== 'c2') {
    return null;
  }
  if (existing && existing.raw_json === rawJson) {
    return null;
  }

  const cols = c2ColumnValues(workout);
  const paceMs = computePaceMs(cols.time_ms, cols.distance);

  if (existing) {
    // pinned/notes are user-owned columns; sync must never overwrite them.
    // Columns the user has corrected (edited_fields) are skipped too, so the
    // effective distance/time — and the pace/stroke-wipe decisions derived
    // from them — use the stored value wherever an override exists.
    const edited = parseEditedFields(existing.edited_fields);
    const effDistance = edited.includes('distance') ? existing.distance : cols.distance;
    const effTimeMs = edited.includes('time_ms') ? existing.time_ms : cols.time_ms;
    const effPaceMs = computePaceMs(effTimeMs, effDistance);

    const applied = Object.fromEntries(
      Object.entries(cols).filter(([name]) => !edited.includes(name))
    );
    applied.pace_ms = effPaceMs;
    applied.raw_json = rawJson;

    const setClause = Object.keys(applied).map(name => `${name} = ?`).join(', ');
    db.prepare(`
      UPDATE workouts SET ${setClause}, synced_at = datetime('now') WHERE id = ?
    `).run(...Object.values(applied), workout.id);
    const c2Intervals = extractC2Intervals(workout);
    if (c2Intervals.length > 0) {
      writeIntervals(db, workout.id, expandC2Intervals(c2Intervals));
    }

    const perfChanged = existing.distance !== effDistance
      || existing.pace_ms !== effPaceMs
      || existing.time_ms !== effTimeMs;
    if (perfChanged) {
      // A corrected result invalidates the per-stroke data too. Wipe it and
      // reset the flag so the enrichment cron (which picks has_stroke_data = 0
      // rows) refetches, instead of recomputing analytics from stale strokes.
      db.prepare('DELETE FROM strokes WHERE workout_id = ?').run(workout.id);
      db.prepare('UPDATE workouts SET has_stroke_data = 0 WHERE id = ?').run(workout.id);
    }
    const affectedDistances = perfChanged ? [existing.distance, effDistance] : [];
    return { id: workout.id, inserted: false, affectedDistances };
  }

  db.prepare(`
    INSERT INTO workouts (
      id, user_id, date, timezone, type, workout_type,
      distance, time_ms, pace_ms, stroke_rate, stroke_count,
      calories, heart_rate_avg, heart_rate_max, drag_factor,
      comments, rest_distance, rest_time_ms, raw_json, synced_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, datetime('now')
    )
  `).run(
    workout.id, cols.user_id, cols.date, cols.timezone, cols.type, cols.workout_type,
    cols.distance, cols.time_ms, paceMs, cols.stroke_rate, cols.stroke_count,
    cols.calories, cols.heart_rate_avg, cols.heart_rate_max, cols.drag_factor,
    cols.comments, cols.rest_distance, cols.rest_time_ms, rawJson,
  );
  const c2Intervals = extractC2Intervals(workout);
  const intervals = c2Intervals.length > 0
    ? expandC2Intervals(c2Intervals)
    : workout.intervals;
  writeIntervals(db, workout.id, intervals);
  return { id: workout.id, inserted: true };
}

export async function runFullSync() {
  if (syncInProgress) return;
  syncInProgress = true;
  setSyncState('sync_status', 'syncing');
  setSyncState('sync_progress', '0');

  try {
    const token = await getValidToken();
    if (!token) {
      setSyncState('sync_status', 'error');
      return;
    }

    const db = getDb();
    let page = 1;
    let totalSynced = 0;
    const insertedWorkoutIds = [];
    const updatedWorkoutIds = [];
    const affectedPbDistances = [];

    while (true) {
      const data = await fetchC2Api(`/api/users/me/results?page=${page}&per_page=250&type=rower`, token);
      const results = data.data || data;

      if (!results || results.length === 0) break;

      db.transaction(() => {
        for (const workout of results) {
          const result = insertWorkout(db, workout);
          if (!result) continue;
          if (result.inserted) {
            insertedWorkoutIds.push(result.id);
          } else {
            updatedWorkoutIds.push(result.id);
            if (result.affectedDistances) affectedPbDistances.push(...result.affectedDistances);
          }
        }
      })();

      totalSynced += results.length;
      setSyncState('sync_progress', String(totalSynced));

      const meta = data.meta;
      if (meta && meta.pagination && page >= meta.pagination.last_page) break;
      if (!Array.isArray(data.data) && results.length < 250) break;

      page++;
      await delay(200);
    }

    console.log(`Full sync complete: ${totalSynced} workouts synced`);
    runPostSyncAnalytics(insertedWorkoutIds, updatedWorkoutIds, affectedPbDistances);
    setSyncState('last_sync_completed', new Date().toISOString());
    setSyncState('sync_status', 'idle');
  } catch (err) {
    console.error('Full sync error:', err);
    setSyncState('sync_status', 'error');
  } finally {
    syncInProgress = false;
  }
}

export async function runIncrementalSync() {
  if (syncInProgress) return;
  syncInProgress = true;

  try {
    const token = await getValidToken();
    if (!token) return;

    const db = getDb();
    const lastSync = getSyncStateValue('last_sync_completed');
    const insertedWorkoutIds = [];
    const updatedWorkoutIds = [];
    const affectedPbDistances = [];
    setSyncState('sync_status', 'syncing');

    // Concept2 filters `from` by workout date, not upload/update time, so a
    // late-uploaded or edited older workout can fall outside a tight cursor.
    // Re-scan a trailing window on every run; insertWorkout() is a no-op for
    // unchanged rows, so the overlap is cheap.
    let fromParam = null;
    if (lastSync) {
      const windowStart = new Date(new Date(lastSync).getTime() - 30 * 24 * 60 * 60 * 1000);
      fromParam = windowStart.toISOString();
    }

    let page = 1;
    let totalFetched = 0;
    while (true) {
      let url = `/api/users/me/results?page=${page}&per_page=250&type=rower`;
      if (fromParam) url += `&from=${encodeURIComponent(fromParam)}`;

      const data = await fetchC2Api(url, token);
      const results = data.data || data;
      if (!results || results.length === 0) break;

      db.transaction(() => {
        for (const workout of results) {
          const result = insertWorkout(db, workout);
          if (!result) continue;
          if (result.inserted) {
            insertedWorkoutIds.push(result.id);
          } else {
            updatedWorkoutIds.push(result.id);
            if (result.affectedDistances) affectedPbDistances.push(...result.affectedDistances);
          }
        }
      })();
      totalFetched += results.length;

      const meta = data.meta;
      if (meta && meta.pagination && page >= meta.pagination.last_page) break;
      if (!Array.isArray(data.data) && results.length < 250) break;

      page++;
      await delay(200);
    }

    if (totalFetched > 0) {
      console.log(`Incremental sync: ${totalFetched} workouts scanned, ${insertedWorkoutIds.length} new, ${updatedWorkoutIds.length} updated`);
      runPostSyncAnalytics(insertedWorkoutIds, updatedWorkoutIds, affectedPbDistances);
    }

    setSyncState('last_sync_completed', new Date().toISOString());
    setSyncState('sync_status', 'idle');
  } catch (err) {
    console.error('Incremental sync error:', err);
    setSyncState('sync_status', 'error');
  } finally {
    syncInProgress = false;
  }
}

export function runPostSyncAnalytics(insertedWorkoutIds = [], updatedWorkoutIds = [], affectedPbDistances = []) {
  try {
    tagAllWorkouts();
    computeAllMetrics();
    computeFitnessLog();
    computePredictions();
    computeAllZoneTimes();
    computeAllBestEfforts();
    // computeAllX() above are cache-gated on existing rows, so changed
    // workouts (which already have stale rows) need an explicit recompute.
    for (const id of updatedWorkoutIds) {
      recomputeWorkoutAnalytics(id);
    }
    // A correction to an existing workout's distance/pace/time can invalidate
    // or restore PBs at that distance, so rebuild pb_history for it rather
    // than relying on detectNewPbs (which only looks at new workouts).
    if (affectedPbDistances.length > 0) {
      reconcilePbDistances(affectedPbDistances);
    }
    const newPbs = detectNewPbs(insertedWorkoutIds);
    if (newPbs.length > 0) {
      console.log(`Detected ${newPbs.length} new PB${newPbs.length === 1 ? '' : 's'}`);
    }
    const matchedPlans = matchNewWorkouts(insertedWorkoutIds);
    if (matchedPlans > 0) {
      console.log(`Auto-matched ${matchedPlans} planned workout${matchedPlans === 1 ? '' : 's'}`);
    }
    console.log('Post-sync analytics complete');
  } catch (err) {
    console.error('Post-sync analytics error:', err);
  }
}

async function fetchAndStoreStrokes(db, id, token) {
  let strokeData = [];

  try {
    const strokeResp = await fetchC2Api(`/api/users/me/results/${id}/strokes`, token);
    strokeData = strokeResp.data || strokeResp || [];
    if (!Array.isArray(strokeData)) strokeData = [];
  } catch {
    const detail = await fetchC2Api(`/api/users/me/results/${id}`, token);
    strokeData = detail.strokes || detail.stroke_data || [];
  }

  const strokeStmt = db.prepare(`
    INSERT OR IGNORE INTO strokes (
      workout_id, stroke_number, time_s, distance_m,
      pace_ms, watts, cal_hr, stroke_rate, heart_rate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (strokeData.length > 0) {
    db.transaction(() => {
      strokeData.forEach((s, idx) => {
        const timeS = s.t != null ? s.t / 10 : s.time || null;
        const distM = s.d != null ? s.d : s.distance || null;
        let sPaceMs = s.p ? Math.round(s.p * 100) : null;
        if (!sPaceMs && timeS > 0 && distM > 0 && idx > 0) {
          const prevD = strokeData[idx - 1]?.d ?? strokeData[idx - 1]?.distance ?? 0;
          const prevT = strokeData[idx - 1]?.t != null ? strokeData[idx - 1].t / 10 : strokeData[idx - 1]?.time ?? 0;
          const deltaD = distM - prevD;
          const deltaT = timeS - prevT;
          if (deltaD > 0 && deltaT > 0) {
            sPaceMs = Math.round((deltaT / deltaD) * 500 * 1000);
          }
        }
        strokeStmt.run(
          id, idx, timeS, distM, sPaceMs,
          s.watts || null, s.cal_hr || null,
          s.spm || s.stroke_rate || null,
          s.hr || s.heart_rate || null
        );
      });
    })();
    db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = ?').run(id);
  }

  // Fetch intervals if we don't have any yet.
  const hasIntervals = db.prepare(
    'SELECT COUNT(*) as c FROM intervals WHERE workout_id = ?'
  ).get(id).c > 0;

  if (!hasIntervals) {
    let intervals = [];
    const raw = db.prepare('SELECT raw_json FROM workouts WHERE id = ?').get(id);
    if (raw?.raw_json) {
      const c2 = extractC2Intervals(JSON.parse(raw.raw_json));
      if (c2.length > 0) intervals = expandC2Intervals(c2);
    }
    if (intervals.length === 0) {
      intervals = await fetchIntervalsFromC2(id, token);
    }
    if (intervals.length === 0) {
      intervals = inferIntervalsFromStrokes(db, id);
    }
    if (intervals.length > 0) {
      writeIntervals(db, id, intervals);
    }
  }

  return { strokes: strokeData.length };
}

export async function enrichSingleWorkout(id) {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');

  const db = getDb();
  db.prepare('DELETE FROM strokes WHERE workout_id = ?').run(id);
  db.prepare('UPDATE workouts SET has_stroke_data = 0 WHERE id = ?').run(id);

  const result = await fetchAndStoreStrokes(db, id, token);
  recomputeWorkoutAnalytics(id);
  console.log(`Manual enrichment for workout ${id}: ${result.strokes} strokes`);
  return result;
}

// Stroke-derived metrics are version-cached, so freshly enriched workouts
// must be recomputed explicitly.
export function recomputeWorkoutAnalytics(id) {
  try {
    computeMetricsForWorkout(id);
    computeZoneTimesForWorkout(id);
    computeBestEffortsForWorkout(id);
  } catch (err) {
    console.error(`Analytics recompute failed for workout ${id}:`, err);
  }
}

export function resetStrokeFlags() {
  const db = getDb();
  const updated = db.prepare(`
    UPDATE workouts SET has_stroke_data = 0
    WHERE has_stroke_data = 1
    AND source = 'c2'
    AND id NOT IN (SELECT DISTINCT workout_id FROM strokes)
  `).run();
  if (updated.changes > 0) {
    console.log(`Reset has_stroke_data for ${updated.changes} workouts with no actual strokes`);
  }
}

export async function runStrokeEnrichment() {
  const token = await getValidToken();
  if (!token) return;

  const db = getDb();
  const remaining = db.prepare("SELECT COUNT(*) as c FROM workouts WHERE has_stroke_data = 0 AND source = 'c2'").get().c;
  if (remaining === 0) return;

  const workouts = selectPendingStrokeWorkouts(db, 10);

  console.log(`Stroke enrichment: processing ${workouts.length} of ${remaining} remaining`);

  for (const { id } of workouts) {
    try {
      const result = await fetchAndStoreStrokes(db, id, token);
      recomputeWorkoutAnalytics(id);
      console.log(`  Workout ${id}: ${result.strokes} strokes`);
      setSyncState('last_enriched_workout_id', String(id));
      await delay(1000);
    } catch (err) {
      console.error(`Stroke enrichment failed for workout ${id}:`, err);
      setSyncState('last_enriched_workout_id', String(id));
    }
  }
}

// Walk the pending set by ID and wrap after reaching the end. Workouts with
// no available stroke stream are retried on later passes without pinning the
// queue to the same newest ten rows forever.
export function selectPendingStrokeWorkouts(db, limit = 10) {
  const cursorRow = db.prepare(
    "SELECT value FROM sync_state WHERE key = 'last_enriched_workout_id'"
  ).get();
  const cursor = Number(cursorRow?.value);
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 10));
  let workouts = [];

  if (Number.isInteger(cursor)) {
    workouts = db.prepare(`
      SELECT id FROM workouts
      WHERE has_stroke_data = 0 AND source = 'c2' AND id < ?
      ORDER BY id DESC LIMIT ?
    `).all(cursor, boundedLimit);
  }

  if (workouts.length === 0) {
    workouts = db.prepare(`
      SELECT id FROM workouts
      WHERE has_stroke_data = 0 AND source = 'c2'
      ORDER BY id DESC LIMIT ?
    `).all(boundedLimit);
  }

  return workouts;
}

export async function runIntervalBackfill() {
  const db = getDb();
  const workouts = db.prepare(`
    SELECT w.id, w.raw_json FROM workouts w
    WHERE w.has_stroke_data = 1
      AND w.source = 'c2'
      AND NOT EXISTS (SELECT 1 FROM intervals WHERE workout_id = w.id)
    ORDER BY w.date DESC LIMIT 10
  `).all();

  if (workouts.length === 0) return;
  console.log(`Interval backfill: processing ${workouts.length} workouts`);

  for (const { id, raw_json } of workouts) {
    try {
      let intervals = [];
      if (raw_json) {
        const stored = JSON.parse(raw_json);
        const c2 = extractC2Intervals(stored);
        if (c2.length > 0) {
          intervals = expandC2Intervals(c2);
          console.log(`  Workout ${id}: ${c2.length} intervals from stored data`);
        }
      }
      if (intervals.length === 0) {
        const token = await getValidToken();
        if (token) intervals = await fetchIntervalsFromC2(id, token);
      }
      if (intervals.length === 0) {
        intervals = inferIntervalsFromStrokes(db, id);
      }
      if (intervals.length > 0) {
        writeIntervals(db, id, intervals);
        recomputeWorkoutAnalytics(id);
      }
      await delay(1000);
    } catch (err) {
      console.error(`Interval backfill failed for workout ${id}:`, err);
    }
  }
}

let syncScheduleStarted = false;

export function startSyncSchedule() {
  if (syncScheduleStarted) return;
  syncScheduleStarted = true;

  resetStrokeFlags();

  const interval = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15', 10);

  cron.schedule(`*/${interval} * * * *`, () => {
    console.log('[cron] Running incremental sync');
    runIncrementalSync().catch(err => console.error('Scheduled sync failed:', err));
  });

  cron.schedule('*/5 * * * *', () => {
    console.log('[cron] Running stroke enrichment');
    runStrokeEnrichment().catch(err => console.error('Stroke enrichment failed:', err));
    runIntervalBackfill().catch(err => console.error('Interval backfill failed:', err));
  });

  console.log(`Sync scheduled: incremental every ${interval}min, stroke enrichment every 5min`);
}
