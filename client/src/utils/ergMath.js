const CAL_HR_FACTOR = 4 * 0.8604;

export function paceToWatts(paceSecondsPer500) {
  const pace = Number(paceSecondsPer500);
  if (!Number.isFinite(pace) || pace <= 0) return null;
  return 2.80 / Math.pow(pace / 500, 3);
}

export function wattsToPace(watts) {
  const value = Number(watts);
  if (!Number.isFinite(value) || value <= 0) return null;
  return 500 * Math.cbrt(2.80 / value);
}

export function wattsToCalHr(watts) {
  const value = Number(watts);
  if (!Number.isFinite(value) || value < 0) return null;
  return value * CAL_HR_FACTOR + 300;
}

export function calHrToWatts(calHr) {
  const value = Number(calHr);
  if (!Number.isFinite(value) || value <= 300) return null;
  return (value - 300) / CAL_HR_FACTOR;
}

export function buildRacePlan(targetDistance, targetTimeSeconds, intervalMeters = 500) {
  const distance = Number(targetDistance);
  const time = Number(targetTimeSeconds);
  const interval = Number(intervalMeters);

  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(time) || time <= 0) {
    return null;
  }

  const splitSeconds = (time / distance) * 500;
  const splits = [];
  let covered = 0;
  let elapsed = 0;

  while (covered < distance) {
    const splitDistance = Math.min(interval > 0 ? interval : 500, distance - covered);
    const splitTimeSeconds = (splitDistance / distance) * time;
    covered += splitDistance;
    elapsed += splitTimeSeconds;
    splits.push({
      index: splits.length + 1,
      distance: splitDistance,
      cumulativeDistance: covered,
      splitTimeSeconds,
      cumulativeTimeSeconds: elapsed,
      paceSeconds: splitSeconds,
    });
  }

  if (splits.length > 0) {
    splits[splits.length - 1].cumulativeTimeSeconds = time;
  }

  return { targetDistance: distance, targetTimeSeconds: time, splitSeconds, splits };
}

export function parsePaceInput(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (!text.includes(':')) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  const [minutesPart, secondsPart] = text.split(':');
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0 || seconds >= 60) {
    return null;
  }

  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function formatPaceSeconds(seconds, digits = 1) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  const minutes = Math.floor(value / 60);
  const remaining = value - minutes * 60;
  return `${minutes}:${remaining.toFixed(digits).padStart(2 + digits + 1, '0')}`;
}

export function parseTimeInput(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const parts = text.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 1) return parts[0] > 0 ? parts[0] : null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function formatDuration(seconds, digits = 1) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '';

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remaining = value - hours * 3600 - minutes * 60;
  const secondsText = remaining.toFixed(digits).padStart(2 + digits + 1, '0');

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`;
  return `${minutes}:${secondsText}`;
}
