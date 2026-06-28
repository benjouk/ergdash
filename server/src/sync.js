import cron from 'node-cron';
import { getDb } from './db.js';
import { getValidToken, fetchC2Api } from './auth.js';
import { tagAllWorkouts, computeAllMetrics, computeFitnessLog } from './analytics.js';

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

  return {
    status: getSyncStateValue('sync_status') || 'idle',
    last_completed: getSyncStateValue('last_sync_completed'),
    total_workouts: workoutCount,
    enrichment_progress: `${enrichedCount}/${workoutCount}`,
    sync_progress: getSyncStateValue('sync_progress'),
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function insertWorkout(db, workout) {
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

  stmt.run(
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

    while (true) {
      const data = await fetchC2Api(`/api/users/me/results?page=${page}&per_page=250&type=rower`, token);
      const results = data.data || data;

      if (!results || results.length === 0) break;

      db.transaction(() => {
        for (const workout of results) {
          insertWorkout(db, workout);
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
    runPostSyncAnalytics();
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
          insertWorkout(db, workout);
        }
      })();
      console.log(`Incremental sync: ${results.length} new workouts`);
      runPostSyncAnalytics();
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

function runPostSyncAnalytics() {
  try {
    tagAllWorkouts();
    computeAllMetrics();
    computeFitnessLog();
    console.log('Post-sync analytics complete');
  } catch (err) {
    console.error('Post-sync analytics error:', err);
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

  const strokeStmt = db.prepare(`
    INSERT OR IGNORE INTO strokes (
      workout_id, stroke_number, time_s, distance_m,
      pace_ms, watts, cal_hr, stroke_rate, heart_rate
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const { id } of workouts) {
    try {
      const detail = await fetchC2Api(`/api/users/me/results/${id}`, token);
      const strokeData = detail.strokes || detail.stroke_data || [];

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
        console.log(`  Workout ${id}: ${strokeData.length} strokes`);
      } else {
        console.log(`  Workout ${id}: no stroke data available`);
      }

      db.prepare('UPDATE workouts SET has_stroke_data = 1 WHERE id = ?').run(id);
      await delay(1000);
    } catch (err) {
      console.error(`Stroke enrichment failed for workout ${id}:`, err);
    }
  }
}

export function startSyncSchedule() {
  const interval = parseInt(process.env.SYNC_INTERVAL_MINUTES || '15', 10);

  cron.schedule(`*/${interval} * * * *`, () => {
    runIncrementalSync().catch(err => console.error('Scheduled sync failed:', err));
  });

  cron.schedule('*/5 * * * *', () => {
    runStrokeEnrichment().catch(err => console.error('Stroke enrichment failed:', err));
  });

  console.log(`Sync scheduled every ${interval} minutes`);
}
