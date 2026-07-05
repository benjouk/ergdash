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

export const RACE_STRATEGIES = ['even', 'negative', 'aggressive'];

// Per-500m pace offset (seconds) as a function of race progress p ∈ [0, 1].
// Positive = slower than the average split, negative = faster. The overall
// plan is re-scaled to the target time afterwards, so these only set the
// *shape*; the total is always conserved.
const STRATEGY_SPREAD = 2.5;
function paceOffset(strategy, p) {
  switch (strategy) {
    // Start controlled, finish fast: slow → fast across the piece.
    case 'negative': return STRATEGY_SPREAD * (1 - 2 * p);
    // Fly and die: quick out of the gate, fading through the back half.
    case 'aggressive': return STRATEGY_SPREAD * (2 * p - 1);
    default: return 0;
  }
}

export function buildRacePlan(targetDistance, targetTimeSeconds, intervalMeters = 500, strategy = 'even') {
  const distance = Number(targetDistance);
  const time = Number(targetTimeSeconds);
  const interval = Number(intervalMeters);
  const mode = RACE_STRATEGIES.includes(strategy) ? strategy : 'even';

  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(time) || time <= 0) {
    return null;
  }

  const splitSeconds = (time / distance) * 500;
  const step = interval > 0 ? interval : 500;

  // Lay out the split geometry first so we know how many there are.
  const segments = [];
  let covered = 0;
  while (covered < distance) {
    const splitDistance = Math.min(step, distance - covered);
    covered += splitDistance;
    segments.push({ splitDistance, cumulativeDistance: covered });
  }

  // Shape a raw target time per split, then scale everything so the plan sums
  // exactly to the target time regardless of strategy.
  const denom = Math.max(1, segments.length - 1);
  const rawTimes = segments.map((seg, i) => {
    const p = segments.length === 1 ? 0.5 : i / denom;
    const pace = splitSeconds + paceOffset(mode, p);
    return pace * (seg.splitDistance / 500);
  });
  const rawTotal = rawTimes.reduce((sum, t) => sum + t, 0);
  const scale = rawTotal > 0 ? time / rawTotal : 1;

  const splits = [];
  let elapsed = 0;
  segments.forEach((seg, i) => {
    const splitTimeSeconds = rawTimes[i] * scale;
    elapsed += splitTimeSeconds;
    splits.push({
      index: i + 1,
      distance: seg.splitDistance,
      cumulativeDistance: seg.cumulativeDistance,
      splitTimeSeconds,
      cumulativeTimeSeconds: elapsed,
      paceSeconds: (splitTimeSeconds / seg.splitDistance) * 500,
    });
  });

  if (splits.length > 0) {
    splits[splits.length - 1].cumulativeTimeSeconds = time;
  }

  return { targetDistance: distance, targetTimeSeconds: time, splitSeconds, strategy: mode, splits };
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
