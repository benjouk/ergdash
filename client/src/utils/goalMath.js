// Client-side port of the pure goal maths used by the demo shim (demoApi.js)
// so the deployed VITE_DEMO build can create/edit/delete goals without a
// backend. This MIRRORS the server logic and must be kept in sync with it:
//   - server/src/goalProgress.js        (GOAL_PERIODS, periodWindow,
//                                        volumeProgress, performanceGap)
//   - server/src/pbDetection.js         (STANDARD_PB_DISTANCES)
//   - server/src/middleware/validate.js (isStrictDate)
// The real app never imports this - it hits the server. All date arithmetic
// is UTC; windows are ISO YYYY-MM-DD strings, which compare correctly against
// the ISO datetime strings in workout rows.

export const GOAL_PERIODS = ['weekly', 'monthly', 'season', 'year'];

export const STANDARD_PB_DISTANCES = [500, 1000, 2000, 5000, 6000, 10000, 21097, 42195];

export function isStrictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function periodWindow(period, now = new Date(), weekStart = 'monday') {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let fromMs;
  let toMs;

  if (period === 'weekly') {
    const dow = weekStart === 'sunday' ? now.getUTCDay() : (now.getUTCDay() + 6) % 7;
    fromMs = Date.UTC(y, m, now.getUTCDate() - dow);
    toMs = fromMs + 7 * 86400000;
  } else if (period === 'monthly') {
    fromMs = Date.UTC(y, m, 1);
    toMs = Date.UTC(y, m + 1, 1);
  } else if (period === 'season') {
    // Rowing season starts May 1 (same convention as stats/summary).
    const seasonYear = m >= 4 ? y : y - 1;
    fromMs = Date.UTC(seasonYear, 4, 1);
    toMs = Date.UTC(seasonYear + 1, 4, 1);
  } else if (period === 'year') {
    fromMs = Date.UTC(y, 0, 1);
    toMs = Date.UTC(y + 1, 0, 1);
  } else {
    throw new Error(`Unknown goal period: ${period}`);
  }

  const elapsed = (now.getTime() - fromMs) / (toMs - fromMs);
  return {
    from: isoDay(fromMs),
    to: isoDay(toMs),
    elapsedFraction: Math.min(1, Math.max(0, elapsed)),
  };
}

export function volumeProgress(targetMeters, meters, elapsedFraction) {
  const target = targetMeters > 0 ? targetMeters : 0;
  const expected = Math.round(target * elapsedFraction);
  return {
    meters,
    target_meters: target,
    percent: target > 0 ? (meters / target) * 100 : 0,
    remaining_meters: Math.max(0, target - meters),
    expected_by_now: expected,
    on_pace: meters >= expected,
  };
}

// pb / prediction are { time_ms } / { predicted_time } shaped rows (or null).
// Deltas are positive when the current mark is slower than the target, i.e.
// the amount still to shave off.
export function performanceGap(goal, pb, prediction, now = new Date()) {
  const splits = goal.distance / 500;
  const targetPace = Math.round(goal.target_time_ms / splits);

  const pbDelta = pb ? pb.time_ms - goal.target_time_ms : null;
  const predDelta = prediction?.predicted_time != null
    ? prediction.predicted_time - goal.target_time_ms
    : null;

  let daysToRace = null;
  if (goal.race_date) {
    const race = Date.parse(goal.race_date);
    if (!Number.isNaN(race)) {
      daysToRace = Math.round((race - Date.parse(now.toISOString().slice(0, 10))) / 86400000);
    }
  }

  return {
    target_pace_ms: targetPace,
    pb_delta_ms: pbDelta,
    pb_pace_delta_ms: pbDelta != null ? Math.round(pbDelta / splits) : null,
    prediction_delta_ms: predDelta,
    prediction_pace_delta_ms: predDelta != null ? Math.round(predDelta / splits) : null,
    days_to_race: daysToRace,
    achieved: pb != null && pb.time_ms <= goal.target_time_ms,
  };
}
