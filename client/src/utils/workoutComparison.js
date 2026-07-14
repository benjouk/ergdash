import { paceToWatts } from './ergMath.js';

// betterDelta says which sign of (this session minus comparison) reads as
// favourable: pace and HR favour lower values; stroke rate is neutral.
export const COMPARISON_METRICS = {
  pace: { label: 'Pace', field: 'pace_ms', betterDelta: 'negative' },
  rate: { label: 'Stroke rate', field: 'stroke_rate', betterDelta: null },
  hr: { label: 'Heart rate', field: 'heart_rate', betterDelta: 'negative' },
};

const validNumber = value => Number.isFinite(Number(value)) && Number(value) > 0;
const finiteNumber = value => value != null && value !== '' && Number.isFinite(Number(value));

function average(values) {
  const valid = values.filter(validNumber).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

// Mean that keeps zero and negative values; average() drops them, which is
// wrong for signed quantities like pace deltas.
function meanSigned(values) {
  const valid = values.filter(value => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

// --- Stroke normalization ---------------------------------------------------
// stroke.distance_m is the raw device odometer: imported recordings include
// warmup, rest and cooldown metres, so the stream doesn't line up with the
// scored piece (workout.distance). All comparison maths below runs on strokes
// rebased so the scored work spans [0, workout.distance].

const normalizedCache = new WeakMap();

export function normalizeComparisonWorkout(workout) {
  if (!workout || typeof workout !== 'object') return workout;
  const cached = normalizedCache.get(workout);
  if (cached) return cached;
  const normalized = rebaseWorkout(workout);
  normalizedCache.set(workout, normalized);
  return normalized;
}

function rebaseWorkout(workout) {
  const strokes = cleanStrokes(workout.strokes);
  if (!strokes.length) return workout;
  const span = strokes[strokes.length - 1].distance_m - strokes[0].distance_m;
  const target = Number(workout.distance);

  // The stream is (about) the piece: at most shift it to start at zero.
  if (!validNumber(target) || span <= target * 1.02) {
    return { ...workout, strokes: offsetStrokes(strokes, strokes[0]) };
  }
  if (workIntervals(workout).length) {
    const rebased = rebaseIntervalStrokes(strokes, workout.intervals);
    if (rebased) return { ...workout, strokes: rebased };
  }
  return { ...workout, strokes: detectPieceWindow(strokes, workout) };
}

function cleanStrokes(strokes) {
  const cleaned = [];
  let maxDistance = -Infinity;
  for (const stroke of strokes || []) {
    const distance = Number(stroke?.distance_m);
    if (!Number.isFinite(distance) || distance < 0) continue;
    if (distance < maxDistance - 1) continue; // odometer glitch
    if (distance > maxDistance) maxDistance = distance;
    cleaned.push(stroke);
  }
  return cleaned;
}

function offsetStrokes(strokes, origin) {
  const distance0 = origin.distance_m;
  const time0 = Number.isFinite(origin.time_s) ? origin.time_s : null;
  if (!distance0 && !time0) return strokes;
  return strokes.map(stroke => ({
    ...stroke,
    distance_m: stroke.distance_m - distance0,
    time_s: time0 != null && Number.isFinite(stroke.time_s) ? stroke.time_s - time0 : stroke.time_s,
  }));
}

// Port of the server's segmentStrokesByIntervals boundary heuristic
// (server/src/strokeMetrics.js): time boundaries when rest rows exist and the
// stroke clock spans them, otherwise cumulative distance boundaries (work AND
// rest metres, which is what absorbs rest drift in the odometer). Work strokes
// are remapped onto a cumulative work-only axis.
function rebaseIntervalStrokes(strokes, intervals) {
  const ordered = [...(intervals || [])].sort((a, b) => (a.interval_index ?? 0) - (b.interval_index ?? 0));
  if (!ordered.length) return null;

  const totalIntervalS = ordered.reduce((sum, interval) => sum + (interval.time_ms || 0), 0) / 1000;
  const lastStrokeT = strokes[strokes.length - 1]?.time_s || 0;
  const hasRestRows = ordered.some(interval => interval.type === 'rest');
  const useTime = hasRestRows && totalIntervalS > 0 && lastStrokeT >= totalIntervalS * 0.85;
  if (!useTime && !ordered.some(interval => interval.type !== 'rest' && validNumber(interval.distance))) return null;

  const rebased = [];
  let bound = 0;
  let workDistance = 0;
  let workTimeMs = 0;
  for (const interval of ordered) {
    const isWork = interval.type !== 'rest';
    const size = useTime ? (interval.time_ms || 0) / 1000 : (interval.distance || 0);
    const start = bound;
    bound += size;
    if (!isWork) continue;

    const segment = strokes.filter(stroke => {
      const position = useTime ? stroke.time_s : stroke.distance_m;
      return position != null && position >= start && position < bound;
    });
    let width = validNumber(interval.distance) ? Number(interval.distance) : 0;
    if (segment.length) {
      const origin = segment[0];
      if (!width) width = segment[segment.length - 1].distance_m - origin.distance_m;
      for (const stroke of segment) {
        rebased.push({
          ...stroke,
          distance_m: workDistance + Math.min(Math.max(stroke.distance_m - origin.distance_m, 0), width || Infinity),
          time_s: Number.isFinite(stroke.time_s) && Number.isFinite(origin.time_s)
            ? workTimeMs / 1000 + (stroke.time_s - origin.time_s)
            : stroke.time_s,
        });
      }
    }
    workDistance += width;
    workTimeMs += interval.time_ms || 0;
  }
  return rebased.length ? rebased : null;
}

// The recording is materially longer than the scored piece: find the window
// spanning workout.distance whose duration best matches workout.time_ms, or
// the fastest such window when the total time is unknown (warmup and cooldown
// paddling is slower than the piece). Two pointers, O(n).
function detectPieceWindow(strokes, workout) {
  const target = Number(workout.distance);
  const targetS = validNumber(workout.time_ms) ? workout.time_ms / 1000 : null;
  const times = strokes.map(stroke => Number(stroke.time_s));
  const hasTimes = times.every(time => Number.isFinite(time));

  // Without usable timestamps, score windows by mean stroke pace against the
  // piece pace via prefix sums.
  let paceSum = null;
  let paceCount = null;
  if (!hasTimes) {
    if (!validNumber(workout.pace_ms)) return offsetStrokes(strokes, strokes[0]);
    paceSum = [0];
    paceCount = [0];
    for (const stroke of strokes) {
      const pace = Number(stroke.pace_ms);
      const usable = Number.isFinite(pace) && pace > 0;
      paceSum.push(paceSum[paceSum.length - 1] + (usable ? pace : 0));
      paceCount.push(paceCount[paceCount.length - 1] + (usable ? 1 : 0));
    }
  }

  let best = null;
  let j = 0;
  for (let i = 0; i < strokes.length; i++) {
    if (j < i + 1) j = i + 1;
    while (j < strokes.length && strokes[j].distance_m - strokes[i].distance_m < target) j++;
    if (j >= strokes.length) break;
    let score;
    if (hasTimes) {
      const duration = times[j] - times[i];
      score = targetS != null ? Math.abs(duration - targetS) : duration;
    } else {
      const count = paceCount[j + 1] - paceCount[i];
      if (!count) continue;
      score = Math.abs((paceSum[j + 1] - paceSum[i]) / count - Number(workout.pace_ms));
    }
    if (!best || score < best.score) best = { i, j, score };
  }
  if (!best) return offsetStrokes(strokes, strokes[0]);
  return offsetStrokes(strokes.slice(best.i, best.j + 1), strokes[best.i]);
}

// --- Overlay series ---------------------------------------------------------

function workoutPoints(workout, metric, axis) {
  const field = COMPARISON_METRICS[metric].field;
  const strokes = (workout?.strokes || []).filter(stroke => validNumber(stroke?.[field]));
  if (strokes.length) {
    const maxDistance = workout.distance || Math.max(...strokes.map(stroke => stroke.distance_m || 0));
    return strokes.map(stroke => ({
      x: axis === 'distance' ? stroke.distance_m
        : axis === 'time' ? stroke.time_s
          : ((stroke.distance_m || 0) / Math.max(1, maxDistance)) * 100,
      value: Number(stroke[field]),
    })).filter(point => Number.isFinite(point.x));
  }

  const intervals = (workout?.intervals || []).filter(interval => interval.type !== 'rest');
  const intervalField = metric === 'hr' ? 'heart_rate_avg' : field;
  if (intervals.some(interval => validNumber(interval[intervalField]))) {
    let distance = 0;
    let time = 0;
    return intervals.map((interval, index) => {
      distance += interval.distance || 0;
      time += (interval.time_ms || 0) / 1000;
      return {
        x: axis === 'distance' ? distance
          : axis === 'time' ? time
            : ((index + 0.5) / intervals.length) * 100,
        value: validNumber(interval[intervalField]) ? Number(interval[intervalField]) : null,
      };
    }).filter(point => point.value != null);
  }

  if (metric === 'pace' && workout?.pace_profile?.length >= 2) {
    return workout.pace_profile.filter(validNumber).map((value, index, values) => ({
      x: ((index + 0.5) / values.length) * 100,
      value: Number(value),
    }));
  }
  return [];
}

export function buildMetricSeries(workout1, workout2, metric = 'pace', axis = 'distance') {
  workout1 = normalizeComparisonWorkout(workout1);
  workout2 = normalizeComparisonWorkout(workout2);
  let resolvedAxis = axis;
  const hasTrace = workout => (workout?.strokes || []).some(stroke => validNumber(stroke?.[COMPARISON_METRICS[metric].field]))
    || (workout?.intervals || []).some(interval => interval.type !== 'rest' && validNumber(interval?.[metric === 'hr' ? 'heart_rate_avg' : COMPARISON_METRICS[metric].field]));
  if (resolvedAxis !== 'percent' && (!hasTrace(workout1) || !hasTrace(workout2))) resolvedAxis = 'percent';
  let points1 = workoutPoints(workout1, metric, resolvedAxis);
  let points2 = workoutPoints(workout2, metric, resolvedAxis);
  if ((!points1.length || !points2.length) && resolvedAxis !== 'percent') {
    resolvedAxis = 'percent';
    points1 = workoutPoints(workout1, metric, resolvedAxis);
    points2 = workoutPoints(workout2, metric, resolvedAxis);
  }
  if (!points1.length || !points2.length) return { data: [], axis: resolvedAxis };

  // Cap the axis at the scored piece rather than the last recorded stroke.
  const pieceSpan = workout => (resolvedAxis === 'distance'
    ? Number(workout?.distance) : Number(workout?.time_ms) / 1000) || 0;
  const maxX = resolvedAxis === 'percent' ? 100 : Math.max(
    pieceSpan(workout1) || points1.at(-1)?.x || 0,
    pieceSpan(workout2) || points2.at(-1)?.x || 0,
  );
  const bucketCount = resolvedAxis === 'percent' ? 50 : Math.min(100, Math.max(20, Math.round(maxX / 100)));
  const bucketSize = maxX / bucketCount;
  const bucket = (points, index) => average(points
    .filter(point => point.x >= index * bucketSize && point.x < (index + 1) * bucketSize)
    .map(point => point.value));

  return {
    axis: resolvedAxis,
    data: Array.from({ length: bucketCount }, (_, index) => {
      const value1 = bucket(points1, index);
      const value2 = bucket(points2, index);
      return {
        x: (index + 0.5) * bucketSize,
        value1,
        value2,
        delta: value1 != null && value2 != null ? value1 - value2 : null,
      };
    }),
  };
}

// --- Splits -----------------------------------------------------------------

function workIntervals(workout) {
  return (workout?.intervals || []).filter(interval => interval.type !== 'rest');
}

function splitFromStrokes(workout, start, end, label) {
  const strokes = (workout?.strokes || []).filter(stroke => stroke.distance_m >= start && stroke.distance_m < end);
  const pace = average(strokes.map(stroke => stroke.pace_ms));
  const distance = end - start;
  return {
    label,
    pace_ms: pace,
    stroke_rate: average(strokes.map(stroke => stroke.stroke_rate)),
    heart_rate: average(strokes.map(stroke => stroke.heart_rate)),
    time_ms: pace != null ? pace * distance / 500 : null,
  };
}

function intervalSplits(workout) {
  return workIntervals(workout).map((interval, index) => ({
    label: `Rep ${index + 1}`,
    pace_ms: interval.pace_ms,
    stroke_rate: interval.stroke_rate,
    heart_rate: interval.heart_rate_avg,
    time_ms: validNumber(interval.time_ms) ? Number(interval.time_ms)
      : validNumber(interval.pace_ms) && validNumber(interval.distance)
        ? interval.pace_ms * interval.distance / 500 : null,
  }));
}

function steadySplits(workout, percent = false) {
  if (!workout?.distance) return [];
  const strokes = workout.strokes || [];
  if (strokes.length === 0 && workout.pace_profile?.length >= 2) {
    return Array.from({ length: 10 }, (_, index) => {
      const start = Math.floor(workout.pace_profile.length * index / 10);
      const end = Math.max(start + 1, Math.floor(workout.pace_profile.length * (index + 1) / 10));
      const pace = average(workout.pace_profile.slice(start, end));
      return {
        label: percent ? `${index * 10}-${(index + 1) * 10}%` : `Segment ${index + 1}`,
        pace_ms: pace,
        stroke_rate: null,
        heart_rate: null,
        time_ms: pace != null ? pace * (workout.distance / 10) / 500 : null,
      };
    });
  }
  if (percent) {
    return Array.from({ length: 10 }, (_, index) => {
      const start = workout.distance * index / 10;
      const end = workout.distance * (index + 1) / 10;
      return splitFromStrokes(workout, start, end, `${index * 10}-${(index + 1) * 10}%`);
    });
  }
  const size = workout.distance <= 3000 ? 500 : 1000;
  return Array.from({ length: Math.ceil(workout.distance / size) }, (_, index) => {
    const start = index * size;
    const end = Math.min(workout.distance, (index + 1) * size);
    return splitFromStrokes(workout, start, end, `${start}-${end}m`);
  });
}

export function buildComparisonSplits(workout1, workout2, match = {}) {
  workout1 = normalizeComparisonWorkout(workout1);
  workout2 = normalizeComparisonWorkout(workout2);
  const bothIntervals = workIntervals(workout1).length && workIntervals(workout2).length;
  const percent = match.axis === 'percent' || match.level === 'other';
  const rows1 = bothIntervals && !percent ? intervalSplits(workout1) : steadySplits(workout1, percent);
  const rows2 = bothIntervals && !percent ? intervalSplits(workout2) : steadySplits(workout2, percent);
  const length = Math.max(rows1.length, rows2.length);
  const rows = Array.from({ length }, (_, index) => {
    const a = rows1[index] || {};
    const b = rows2[index] || {};
    return {
      label: a.label || b.label || `${index + 1}`,
      pace1_ms: a.pace_ms,
      pace2_ms: b.pace_ms,
      rate1: a.stroke_rate,
      rate2: b.stroke_rate,
      hr1: a.heart_rate,
      hr2: b.heart_rate,
      time1_ms: a.time_ms,
      time2_ms: b.time_ms,
      pace_delta_ms: validNumber(a.pace_ms) && validNumber(b.pace_ms) ? a.pace_ms - b.pace_ms : null,
      gap_s: null,
    };
  }).filter(row => row.pace1_ms != null || row.pace2_ms != null);

  // Cumulative gap: seconds ahead (negative) or behind at the end of each
  // split. Only meaningful when splits are like-for-like; stops at the first
  // row where either side is missing.
  if (!percent) {
    let gap = 0;
    for (const row of rows) {
      if (!validNumber(row.time1_ms) || !validNumber(row.time2_ms)) break;
      gap += (row.time1_ms - row.time2_ms) / 1000;
      row.gap_s = gap;
    }
  }
  return rows;
}

// --- Summary ----------------------------------------------------------------

function signed(value, decimals = 1) {
  if (!Number.isFinite(value)) return null;
  const rounded = value.toFixed(decimals);
  return `${value > 0 ? '+' : ''}${rounded}`;
}

const EVEN_SPLIT_THRESHOLD_S = 0.5;

// A session's own pacing shape: mean pace of the back half minus the front
// half, in s/500. Positive = faded.
function pacingDelta(workout) {
  const strokes = (workout?.strokes || [])
    .filter(stroke => validNumber(stroke.pace_ms) && Number.isFinite(Number(stroke.distance_m)));
  if (strokes.length >= 8) {
    const mid = strokes[strokes.length - 1].distance_m / 2;
    const first = meanSigned(strokes.filter(stroke => stroke.distance_m <= mid).map(stroke => Number(stroke.pace_ms)));
    const second = meanSigned(strokes.filter(stroke => stroke.distance_m > mid).map(stroke => Number(stroke.pace_ms)));
    if (first != null && second != null) return (second - first) / 1000;
  }
  const profile = (workout?.pace_profile || []).filter(validNumber).map(Number);
  if (profile.length >= 4) {
    const mid = Math.ceil(profile.length / 2);
    return (meanSigned(profile.slice(mid)) - meanSigned(profile.slice(0, mid))) / 1000;
  }
  return null;
}

function describePacing(delta) {
  if (delta > EVEN_SPLIT_THRESHOLD_S) return `faded ${signed(delta)}s/500 in the back half`;
  if (delta < -EVEN_SPLIT_THRESHOLD_S) return `negative-split the back half (${signed(delta)}s/500)`;
  return 'held even splits';
}

function buildPacingInsight(workout1, workout2) {
  const delta1 = pacingDelta(workout1);
  const delta2 = pacingDelta(workout2);
  if (delta1 == null || delta2 == null) return null;
  return `This session ${describePacing(delta1)}; the comparison ${describePacing(delta2)}.`;
}

export function buildComparisonSummary(workout1, workout2, match, splits = []) {
  workout1 = normalizeComparisonWorkout(workout1);
  workout2 = normalizeComparisonWorkout(workout2);
  const paceDelta = validNumber(workout1?.pace_ms) && validNumber(workout2?.pace_ms)
    ? workout1.pace_ms - workout2.pace_ms : null;
  let headline = 'Compare pacing and effort across both sessions';
  const isInterval = workout1?.inferred_tag === 'interval' && workout2?.inferred_tag === 'interval';
  if (isInterval && match?.level !== 'other' && paceDelta != null) {
    headline = `${Math.abs(paceDelta / 1000).toFixed(1)}s/500 ${paceDelta <= 0 ? 'faster' : 'slower'} average work pace`;
  } else if (match?.level !== 'other' && match?.axis === 'distance' && workout1.distance === workout2.distance && workout1.time_ms && workout2.time_ms) {
    const seconds = (workout1.time_ms - workout2.time_ms) / 1000;
    headline = `${Math.abs(seconds).toFixed(1)}s ${seconds <= 0 ? 'faster' : 'slower'}`;
  } else if (match?.level !== 'other' && match?.axis === 'time' && Math.abs(workout1.time_ms - workout2.time_ms) <= 1000 && workout1.distance && workout2.distance) {
    const metres = workout1.distance - workout2.distance;
    headline = `${Math.abs(Math.round(metres))}m ${metres >= 0 ? 'farther' : 'shorter'}`;
  } else if (paceDelta != null) {
    headline = `${Math.abs(paceDelta / 1000).toFixed(1)}s/500 ${paceDelta <= 0 ? 'faster' : 'slower'}`;
  }

  const validSplits = splits.filter(row => Number.isFinite(row.pace_delta_ms));
  const deltas = validSplits.map(row => row.pace_delta_ms);
  const midpoint = Math.ceil(deltas.length / 2);
  // Deltas are signed (negative = this session faster), so a signed mean is
  // required; average() silently drops non-positive values.
  const firstHalf = meanSigned(deltas.slice(0, midpoint));
  const secondHalf = meanSigned(deltas.slice(midpoint));
  const strongestIndex = deltas.length ? deltas.indexOf(Math.min(...deltas)) : -1;
  const weakestIndex = deltas.length ? deltas.indexOf(Math.max(...deltas)) : -1;
  const where = deltas.length ? {
    firstHalf: firstHalf != null ? signed(firstHalf / 1000) : null,
    secondHalf: secondHalf != null ? signed(secondHalf / 1000) : null,
    strongest: validSplits[strongestIndex]?.label,
    strongestDelta: signed(deltas[strongestIndex] / 1000),
    weakest: validSplits[weakestIndex]?.label,
    weakestDelta: signed(deltas[weakestIndex] / 1000),
  } : null;

  let effort = null;
  if (paceDelta != null && validNumber(workout1.heart_rate_avg) && validNumber(workout2.heart_rate_avg)) {
    const hrDelta = workout1.heart_rate_avg - workout2.heart_rate_avg;
    effort = paceDelta < 0 && hrDelta <= 0
      ? `Faster at ${Math.abs(Math.round(hrDelta))} bpm ${hrDelta < 0 ? 'lower' : 'the same'} average HR. This suggests improved efficiency.`
      : `${paceDelta < 0 ? 'Higher output' : 'Lower output'} at ${signed(hrDelta, 0)} bpm average HR.`;
  }

  return { headline, paceDelta, where, effort, pacing: buildPacingInsight(workout1, workout2) };
}

// --- Race replay --------------------------------------------------------------
// A head-to-head playback of the two sessions: boat position is interpolated
// from the normalized stroke stream, so both boats race the scored piece on a
// shared clock regardless of what the raw recordings contained.

function interpolateSeries(xs, ys, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const ratio = span > 0 ? (x - xs[lo]) / span : 0;
  return ys[lo] + (ys[hi] - ys[lo]) * ratio;
}

function indexAtTime(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

// Trailing mean so the live readouts don't flicker stroke to stroke.
function windowMean(values, endIndex, size = 5) {
  const window = values.slice(Math.max(0, endIndex - size + 1), endIndex + 1)
    .filter(value => value != null);
  return window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : null;
}

function raceTrack(workout) {
  const strokes = (workout?.strokes || []);
  const times = [];
  const dists = [];
  const paces = [];
  const rates = [];
  const hrs = [];
  let lastTime = -Infinity;
  let lastDist = -Infinity;
  for (const stroke of strokes) {
    const time = Number(stroke?.time_s);
    const dist = Number(stroke?.distance_m);
    if (!Number.isFinite(time) || !Number.isFinite(dist)) continue;
    if (time <= lastTime || dist < lastDist) continue;
    times.push(time);
    dists.push(dist);
    paces.push(validNumber(stroke.pace_ms) ? Number(stroke.pace_ms) : null);
    rates.push(validNumber(stroke.stroke_rate) ? Number(stroke.stroke_rate) : null);
    hrs.push(validNumber(stroke.heart_rate) ? Number(stroke.heart_rate) : null);
    lastTime = time;
    lastDist = dist;
  }
  if (times.length < 8) return null;
  const distance = dists[dists.length - 1] - dists[0];
  if (!(distance > 0)) return null;
  return { times, dists, paces, rates, hrs, distance };
}

function timeAtDistance(track, distance) {
  return interpolateSeries(track.dists, track.times, track.dists[0] + distance) - track.times[0];
}

export function buildRacePlayback(workout1, workout2) {
  const track1 = raceTrack(normalizeComparisonWorkout(workout1));
  const track2 = raceTrack(normalizeComparisonWorkout(workout2));
  if (!track1 || !track2) return null;
  // Racing only makes sense over (near) equal ground.
  if (Math.abs(track1.distance - track2.distance) > Math.max(track1.distance, track2.distance) * 0.05) return null;
  const distance = Math.min(track1.distance, track2.distance);
  const finish1 = timeAtDistance(track1, distance);
  const finish2 = timeAtDistance(track2, distance);
  if (!(finish1 > 0) || !(finish2 > 0)) return null;
  return {
    distance,
    duration_s: Math.max(finish1, finish2),
    boats: [
      { track: track1, finish_s: finish1 },
      { track: track2, finish_s: finish2 },
    ],
  };
}

export function sampleRacePlayback(playback, raceT) {
  const boats = playback.boats.map(({ track, finish_s }) => {
    const clamped = Math.min(Math.max(raceT, 0), finish_s);
    const absTime = track.times[0] + clamped;
    const distance = Math.min(
      interpolateSeries(track.times, track.dists, absTime) - track.dists[0],
      playback.distance,
    );
    const index = indexAtTime(track.times, absTime);
    return {
      distance_m: distance,
      pace_ms: windowMean(track.paces, index),
      stroke_rate: windowMean(track.rates, index),
      heart_rate: windowMean(track.hrs, index),
      finished: raceT >= finish_s,
      finish_s,
    };
  });
  return {
    boats,
    gap_m: boats[0].distance_m - boats[1].distance_m,
    complete: raceT >= playback.duration_s,
  };
}

// --- Metric tiles -------------------------------------------------------------

export function comparisonMetricCards(workout1, workout2) {
  const m1 = workout1?.metrics || {};
  const m2 = workout2?.metrics || {};
  const fields = [
    { label: 'Watts', a: validNumber(workout1?.pace_ms) ? paceToWatts(workout1.pace_ms / 1000) : null, b: validNumber(workout2?.pace_ms) ? paceToWatts(workout2.pace_ms / 1000) : null, unit: 'W', better: 'up' },
    { label: 'Distance / stroke', a: m1.distance_per_stroke, b: m2.distance_per_stroke, unit: 'm', better: 'up' },
    { label: 'W / beat', a: m1.watts_per_beat, b: m2.watts_per_beat, unit: ' W/beat', better: 'up' },
    { label: 'HR drift', a: m1.hr_drift_pct, b: m2.hr_drift_pct, unit: '%', better: 'down', allowNegative: true },
    { label: 'Fade', a: m1.fade_index, b: m2.fade_index, unit: '%', better: 'down', allowNegative: true },
    { label: 'Rate discipline', a: m1.rate_discipline, b: m2.rate_discipline, unit: '', better: 'up' },
    { label: 'Consistency', a: m1.consistency, b: m2.consistency, unit: '', better: 'up' },
    { label: 'HR recovery', a: m1.hr_recovery_avg, b: m2.hr_recovery_avg, unit: ' bpm', better: 'up' },
  ];
  return fields
    .filter(field => field.allowNegative
      ? finiteNumber(field.a) && finiteNumber(field.b)
      : validNumber(field.a) && validNumber(field.b))
    .map(field => ({
      label: field.label,
      value1: Number(field.a),
      value2: Number(field.b),
      delta: Number(field.a) - Number(field.b),
      unit: field.unit,
      better: field.better,
    }));
}
