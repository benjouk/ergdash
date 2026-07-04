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
import { detectNewPbs } from './pbDetection.js';

let syncInProgress = false;

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
  const enrichedCount = db.prepare('SELECT COUNT(*) as count FROM workouts WHERE has_stroke_data = 1').get().count;
  const remaining = workoutCount - enrichedCount;

  // Estimate based on 10 workouts per 5 minutes (1 req/sec + processing)
  const estimatedSecondsRemaining = remaining > 0 ? Math.ceil((remaining / 10) * 300) : 0;

  return {
    status: getSyncStateValue('sync_status') || 'idle',
    last_completed: getSyncStateValue('last_sync_completed'),
    total_workouts: workoutCount,
    enriched_workouts: enrichedCount,
    remaining_workouts: remaining,
    enrichment_progress: workoutCount > 0 ? Math.round((enrichedCount / workoutCount) * 100) : 100,
    estimated_seconds_remaining: estimatedSecondsRemaining,
    sync_progress: getSyncStateValue('sync_progress'),
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function insertWorkout(db, workout) {
  // pinned/notes are user-owned columns; sync must never overwrite them.
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO workouts (
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
  `);

  const timeMs = workout.time ? Math.round(workout.time * 100) : 0;
  const paceMs = (timeMs > 0 && workout.distance > 0)
    ? Math.round((timeMs / workout.distance) * 500)
    : null;

  const result = stmt.run(
    workout.id,
    workout.user_id,
    workout.date,
    workout.timezone,
    workout.type || 'rower',
    workout.workout_type || 'FixedDistanceSplits',
    workout.distance,
    timeMs,
    paceMs,
    workout.stroke_rate,
    workout.stroke_count,
    workout.calories_total,
    workout.heart_rate?.average || null,
    workout.heart_rate?.max || null,
    workout.drag_factor,
    workout.comments,
    workout.rest_distance || null,
    workout.rest_time ? Math.round(workout.rest_time * 100) : null,
    JSON.stringify(workout)
  );

  if (workout.intervals && workout.intervals.length > 0) {
    const intervalStmt = db.prepare(`
      INSERT OR IGNORE INTO intervals (
        workout_id, interval_index, type, distance, time_ms,
        pace_ms, stroke_rate, stroke_count, calories,
        heart_rate_avg, heart_rate_max
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    workout.intervals.forEach((iv, idx) => {
      const ivTimeMs = iv.time ? Math.round(iv.time * 100) : null;
      const ivPaceMs = (ivTimeMs > 0 && iv.distance > 0)
        ? Math.round((ivTimeMs / iv.distance) * 500)
        : null;
      intervalStmt.run(
        workout.id, idx, iv.type || 'work',
        iv.distance, ivTimeMs, ivPaceMs,
        iv.stroke_rate, iv.stroke_count, iv.calories_total,
        iv.heart_rate?.average || null, iv.heart_rate?.max || null
      );
    });
  }

  return result.changes > 0 ? workout.id : null;
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

    while (true) {
      const data = await fetchC2Api(`/api/users/me/results?page=${page}&per_page=250&type=rower`, token);
      const results = data.data || data;

      if (!results || results.length === 0) break;

      db.transaction(() => {
        for (const workout of results) {
          const insertedId = insertWorkout(db, workout);
          if (insertedId != null) insertedWorkoutIds.push(insertedId);
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
    runPostSyncAnalytics(insertedWorkoutIds);
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
    setSyncState('sync_status', 'syncing');

    let url = '/api/users/me/results?per_page=50&type=rower';
    if (lastSync) {
      url += `&from=${encodeURIComponent(lastSync)}`;
    }

    const data = await fetchC2Api(url, token);
    const results = data.data || data;

    if (results && results.length > 0) {
      db.transaction(() => {
        for (const workout of results) {
          const insertedId = insertWorkout(db, workout);
          if (insertedId != null) insertedWorkoutIds.push(insertedId);
        }
      })();
      console.log(`Incremental sync: ${results.length} new workouts`);
      runPostSyncAnalytics(insertedWorkoutIds);
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

function runPostSyncAnalytics(insertedWorkoutIds = []) {
  try {
    tagAllWorkouts();
    computeAllMetrics();
    computeFitnessLog();
    computePredictions();
    computeAllZoneTimes();
    computeAllBestEfforts();
    const newPbs = detectNewPbs(insertedWorkoutIds);
    if (newPbs.length > 0) {
      console.log(`Detected ${newPbs.length} new PB${newPbs.length === 1 ? '' : 's'}`);
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
function recomputeWorkoutAnalytics(id) {
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
  const remaining = db.prepare('SELECT COUNT(*) as c FROM workouts WHERE has_stroke_data = 0').get().c;
  if (remaining === 0) return;

  const workouts = db.prepare(
    'SELECT id FROM workouts WHERE has_stroke_data = 0 ORDER BY date DESC LIMIT 10'
  ).all();

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
  });

  console.log(`Sync scheduled: incremental every ${interval}min, stroke enrichment every 5min`);
}
