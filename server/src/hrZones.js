// Heart-rate zone model: five zones defined by upper-bound percentages of max
// HR. Max HR comes from settings when set, otherwise it's estimated from the
// highest HR ever observed (workout summaries and stroke data).

export const DEFAULT_ZONE_PERCENTS = [60, 70, 80, 90, 100];
const HR_CAP = 220;

export function getZoneModel(db) {
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'max_hr'").get();
  const configuredMax = settingRow ? Number(settingRow.value) : NaN;

  let maxHr = null;
  let estimated = false;

  if (Number.isFinite(configuredMax) && configuredMax > 0) {
    maxHr = Math.min(configuredMax, HR_CAP);
  } else {
    const observed = getObservedMaxHr(db);
    if (observed) {
      maxHr = observed;
      estimated = true;
    }
  }

  if (!maxHr) return null;

  const percents = getZonePercents(db);
  const bounds = percents.map(p => Math.round((p / 100) * maxHr));

  return { maxHr, bounds, percents, estimated };
}

export function getObservedMaxHr(db) {
  const workoutMax = db.prepare(
    'SELECT MAX(heart_rate_max) as m FROM workouts WHERE heart_rate_max > 0'
  ).get()?.m || 0;
  const strokeMax = db.prepare(
    'SELECT MAX(heart_rate) as m FROM strokes WHERE heart_rate > 0'
  ).get()?.m || 0;

  const observed = Math.max(workoutMax, strokeMax);
  if (observed <= 0) return null;
  return Math.min(observed, HR_CAP);
}

function getZonePercents(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'hr_zones'").get();
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
