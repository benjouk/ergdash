// Pure per-stroke metric functions: arrays in, values (or null) out, no DB.
// Callers write null straight to computed_metrics when data is insufficient.

const MIN_HR_STROKES = 20;
const MIN_DRIFT_STROKES = 40;
const HR_DRIFT_OPENING_TRIM_FRACTION = 0.1;
const HR_DRIFT_FINISH_TRIM_FRACTION = 0.05;
const MIN_RATE_STROKES = 20;
const RECOVERY_WINDOW = 5;
const MIN_RECOVERY_STROKES = 3;
// Clamp per-stroke time deltas so device gaps / paused sessions don't get
// credited as continuous effort.
export const MAX_STROKE_DT_S = 30;

// Concept2 power↔pace: watts = 2.80 / (seconds per metre)^3
export function wattsFromPace(paceMs) {
  if (!paceMs || paceMs <= 0) return null;
  const secPerMetre = paceMs / 1000 / 500;
  return 2.8 / Math.pow(secPerMetre, 3);
}

export function paceFromWatts(watts) {
  if (!watts || watts <= 0) return null;
  const secPerMetre = Math.cbrt(2.8 / watts);
  return Math.round(secPerMetre * 500 * 1000);
}

function strokeWatts(stroke) {
  if (stroke.watts > 0) return stroke.watts;
  return wattsFromPace(stroke.pace_ms);
}

function avg(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Metres gained per stroke. Prefers workout totals (works without stroke
// data); falls back to the stroke stream. Clamped to a plausible 2-20 m.
export function distancePerStroke(workout, strokes = []) {
  let dps = null;

  if (workout?.stroke_count > 0 && workout?.distance > 0) {
    dps = workout.distance / workout.stroke_count;
  } else if (strokes.length >= 4) {
    const withDistance = strokes.filter(s => s?.distance_m >= 0);
    if (withDistance.length >= 4) {
      const first = withDistance[0];
      const last = withDistance[withDistance.length - 1];
      const span = last.distance_m - first.distance_m;
      if (span > 0) dps = span / (withDistance.length - 1);
    }
  }

  if (dps == null || dps < 2 || dps > 20) return null;
  return dps;
}

// Aerobic efficiency: average watts per heartbeat over strokes that carry HR.
export function wattsPerBeat(strokes = []) {
  const usable = strokes
    .map(s => ({ hr: s?.heart_rate, w: s ? strokeWatts(s) : null }))
    .filter(p => p.hr > 0 && p.w > 0);

  if (usable.length < MIN_HR_STROKES) return null;

  const meanWatts = avg(usable.map(p => p.w));
  const meanHr = avg(usable.map(p => p.hr));
  if (!meanHr || meanHr <= 0) return null;
  return meanWatts / meanHr;
}

// Aerobic decoupling (Pw:Hr): power-to-HR ratio of the first half vs the
// second half after discarding the warm-up transient and finishing effort.
// Positive = HR rose relative to output; < 5% is the classic "coupled"
// threshold. Caller gates this to steady sessions (endurance tag, >= 15 min).
export function hrDrift(strokes = []) {
  const usable = strokes
    .map(s => ({ t: s?.time_s, hr: s?.heart_rate, w: s ? strokeWatts(s) : null }))
    .filter(p => p.t >= 0 && p.hr > 0 && p.w > 0);

  const trimmed = usable.slice(
    Math.floor(usable.length * HR_DRIFT_OPENING_TRIM_FRACTION),
    Math.ceil(usable.length * (1 - HR_DRIFT_FINISH_TRIM_FRACTION))
  );
  if (trimmed.length < MIN_DRIFT_STROKES) return null;

  const tStart = trimmed[0].t;
  const tEnd = trimmed[trimmed.length - 1].t;
  const tMid = (tStart + tEnd) / 2;

  const firstHalf = trimmed.filter(p => p.t <= tMid);
  const secondHalf = trimmed.filter(p => p.t > tMid);
  if (firstHalf.length < 10 || secondHalf.length < 10) return null;

  const ratio1 = avg(firstHalf.map(p => p.w)) / avg(firstHalf.map(p => p.hr));
  const ratio2 = avg(secondHalf.map(p => p.w)) / avg(secondHalf.map(p => p.hr));
  if (!ratio2 || ratio2 <= 0) return null;

  return (ratio1 / ratio2 - 1) * 100;
}

// Maps strokes onto work intervals by cumulative time_s against interval
// boundaries (work + rest durations accumulate). If the stroke clock clearly
// doesn't span the rests (recorded work-only), falls back to cumulative
// distance boundaries.
export function segmentStrokesByIntervals(strokes = [], intervals = []) {
  const ordered = [...intervals].sort((a, b) => a.interval_index - b.interval_index);
  const workSegments = [];
  const restDurations = [];

  if (ordered.length === 0 || strokes.length === 0) {
    return { workSegments, restDurations };
  }

  const totalIntervalS = ordered.reduce((s, i) => s + (i.time_ms || 0), 0) / 1000;
  const lastStrokeT = strokes[strokes.length - 1]?.time_s || 0;
  const hasRestRows = ordered.some(i => i.type === 'rest');
  // Time boundaries only work when the intervals list accounts for the whole
  // stroke clock: rest rows must be present AND the clock must span them.
  // Concept2 often omits rest rows, in which case cumulative work distance is
  // the only reliable boundary.
  const useTime = hasRestRows && totalIntervalS > 0 && lastStrokeT >= totalIntervalS * 0.85;

  let bound = 0;
  let lastWasWork = false;
  for (const interval of ordered) {
    const isWork = interval.type !== 'rest';
    const size = useTime
      ? (interval.time_ms || 0) / 1000
      : (interval.distance || 0);
    const start = bound;
    bound += size;

    if (!isWork) {
      if (lastWasWork) restDurations.push((interval.time_ms || 0) / 1000);
      lastWasWork = false;
      continue;
    }

    const segment = strokes.filter(s => {
      const pos = useTime ? s?.time_s : s?.distance_m;
      return pos != null && pos >= start && pos < bound;
    });
    workSegments.push(segment);
    // A work rep with no explicit rest row still needs a slot so recoveries
    // stay aligned rep-to-rep; the rest duration is simply unknown.
    if (lastWasWork) restDurations.push(null);
    lastWasWork = true;
  }

  return { workSegments, restDurations };
}

// Rate discipline: how well stroke rate held a band. With no explicit target,
// the band is each segment's median rate ± tolerance (median so low-rate
// paddling can't drag it). Segments are scored independently and averaged so
// variable-rate interval pyramids aren't punished.
export function rateDiscipline(strokeSegments = [], toleranceSpm = 2) {
  const scores = [];

  for (const segment of strokeSegments) {
    const rates = (segment || [])
      .map(s => s?.stroke_rate)
      .filter(r => r > 0);
    if (rates.length < MIN_RATE_STROKES) continue;

    const target = median(rates);
    const inBand = rates.filter(r => Math.abs(r - target) <= toleranceSpm).length;
    scores.push((inBand / rates.length) * 100);
  }

  return scores.length > 0 ? avg(scores) : null;
}

// HR recovery between interval reps: avg HR over the last strokes of one work
// rep vs the first strokes of the next. Positive drop = recovery.
export function hrRecoveries(strokes = [], intervals = []) {
  const { workSegments, restDurations } = segmentStrokesByIntervals(strokes, intervals);
  const recoveries = [];

  for (let k = 0; k < workSegments.length - 1; k++) {
    const endWindow = workSegments[k]
      .slice(-RECOVERY_WINDOW)
      .map(s => s?.heart_rate)
      .filter(h => h > 0);
    const startWindow = workSegments[k + 1]
      .slice(0, RECOVERY_WINDOW)
      .map(s => s?.heart_rate)
      .filter(h => h > 0);

    if (endWindow.length < MIN_RECOVERY_STROKES || startWindow.length < MIN_RECOVERY_STROKES) {
      continue;
    }

    const hrEnd = Math.round(avg(endWindow));
    const hrNextStart = Math.round(avg(startWindow));
    recoveries.push({
      rep_index: k + 1,
      hr_end: hrEnd,
      hr_next_start: hrNextStart,
      drop_bpm: hrEnd - hrNextStart,
      rest_s: restDurations[k] ?? null,
    });
  }

  return recoveries;
}

// Time spent per HR zone. Each stroke credits its dt (clamped) to the zone of
// its HR reading. `bounds` are the five upper bpm bounds, ascending.
export function zoneTimes(strokes = [], bounds = []) {
  if (bounds.length !== 5) return null;

  const times = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let credited = false;
  let prevT = 0;

  for (const stroke of strokes) {
    const t = stroke?.time_s;
    if (t == null || t < 0) continue;
    const dt = Math.min(Math.max(t - prevT, 0), MAX_STROKE_DT_S);
    prevT = t;
    if (!(stroke.heart_rate > 0) || dt <= 0) continue;

    let zone = 5;
    for (let z = 0; z < 5; z++) {
      if (stroke.heart_rate <= bounds[z]) { zone = z + 1; break; }
    }
    times[zone] += dt;
    credited = true;
  }

  return credited ? times : null;
}

// Best sustained average watts over each duration window, via prefix sums of
// time-weighted power and a two-pointer sweep - O(n) per duration.
export function bestEfforts(strokes = [], durations = []) {
  const points = strokes
    .map(s => ({ t: s?.time_s, w: s ? strokeWatts(s) : null }))
    .filter(p => p.t != null && p.t >= 0 && p.w > 0);

  if (points.length < 2) return [];

  const n = points.length;
  // energy[i] = watt-seconds accumulated up to point i; effT = clamped elapsed time
  const energy = new Array(n).fill(0);
  const effT = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dt = Math.min(Math.max(points[i].t - points[i - 1].t, 0), MAX_STROKE_DT_S);
    energy[i] = energy[i - 1] + points[i].w * dt;
    effT[i] = effT[i - 1] + dt;
  }

  const totalT = effT[n - 1];
  const results = [];

  for (const duration of durations) {
    if (totalT < duration) continue;

    let best = null;
    let i = 0;
    for (let j = 1; j < n; j++) {
      while (effT[j] - effT[i + 1] >= duration) i++;
      const span = effT[j] - effT[i];
      if (span < duration) continue;
      const watts = (energy[j] - energy[i]) / span;
      if (!best || watts > best.avg_watts) {
        best = { avg_watts: watts, start_time_s: points[i].t };
      }
    }

    if (best) {
      results.push({
        duration_s: duration,
        avg_watts: best.avg_watts,
        avg_pace_ms: paceFromWatts(best.avg_watts),
        start_time_s: best.start_time_s,
      });
    }
  }

  return results;
}
