// Heart-rate zone model: five zones defined by upper-bound percentages of max
// HR. Max HR comes from the profile's settings when set, otherwise it's
// estimated from the highest HR that profile has ever recorded (workout
// summaries and stroke data).

export const DEFAULT_ZONE_PERCENTS = [60, 70, 80, 90, 100];
const HR_CAP = 220;

export function getZoneModel(db, profileId) {
  const settingRow = db.prepare("SELECT value FROM settings WHERE profile_id = ? AND key = 'max_hr'").get(profileId);
  const configuredMax = settingRow ? Number(settingRow.value) : NaN;

  let maxHr = null;
  let estimated = false;

  if (Number.isFinite(configuredMax) && configuredMax > 0) {
    maxHr = Math.min(configuredMax, HR_CAP);
  } else {
    const observed = getObservedMaxHr(db, profileId);
    if (observed) {
      maxHr = observed;
      estimated = true;
    }
  }

  if (!maxHr) return null;

  const percents = getZonePercents(db, profileId);
  const bounds = percents.map(p => Math.round((p / 100) * maxHr));

  return { maxHr, bounds, percents, estimated };
}

export function getObservedMaxHr(db, profileId) {
  const workoutMax = db.prepare(
    'SELECT MAX(heart_rate_max) as m FROM workouts WHERE heart_rate_max > 0 AND profile_id = ?'
  ).get(profileId)?.m || 0;
  const strokeMax = db.prepare(
    `SELECT MAX(s.heart_rate) as m FROM strokes s
     JOIN workouts w ON w.id = s.workout_id
     WHERE s.heart_rate > 0 AND w.profile_id = ?`
  ).get(profileId)?.m || 0;

  const observed = Math.max(workoutMax, strokeMax);
  if (observed <= 0) return null;
  return Math.min(observed, HR_CAP);
}

function getZonePercents(db, profileId) {
  const row = db.prepare("SELECT value FROM settings WHERE profile_id = ? AND key = 'hr_zones'").get(profileId);
  if (!row) return DEFAULT_ZONE_PERCENTS;

  try {
    const parsed = JSON.parse(row.value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 5 &&
      parsed.every(p => Number.isFinite(p) && p > 0 && p <= 100) &&
      parsed.every((p, i) => i === 0 || p > parsed[i - 1])
    ) {
      return parsed;
    }
  } catch {
    // fall through to defaults on malformed JSON
  }
  return DEFAULT_ZONE_PERCENTS;
}

export function zoneForHr(hr, bounds) {
  for (let z = 0; z < 5; z++) {
    if (hr <= bounds[z]) return z + 1;
  }
  return 5;
}
