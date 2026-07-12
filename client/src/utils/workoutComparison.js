import { paceToWatts } from './ergMath.js';

export const COMPARISON_METRICS = {
  pace: { label: 'Pace', field: 'pace_ms', lowerIsBetter: true },
  rate: { label: 'Stroke rate', field: 'stroke_rate', lowerIsBetter: false },
  hr: { label: 'Heart rate', field: 'heart_rate', lowerIsBetter: false },
};

const validNumber = value => Number.isFinite(Number(value)) && Number(value) > 0;

function average(values) {
  const valid = values.filter(validNumber).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function workoutPoints(workout, metric, axis) {
  const field = COMPARISON_METRICS[metric].field;
  const strokes = (workout?.strokes || []).filter(stroke => validNumber(stroke?.[field]));
  if (strokes.length) {
    const maxDistance = workout.distance || Math.max(...strokes.map(stroke => stroke.distance_m || 0));
    const maxTime = workout.time_ms / 1000 || Math.max(...strokes.map(stroke => stroke.time_s || 0));
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

  const maxX = resolvedAxis === 'percent' ? 100 : Math.max(points1.at(-1)?.x || 0, points2.at(-1)?.x || 0);
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

function workIntervals(workout) {
  return (workout?.intervals || []).filter(interval => interval.type !== 'rest');
}

function splitFromStrokes(workout, start, end, label) {
  const strokes = (workout?.strokes || []).filter(stroke => stroke.distance_m >= start && stroke.distance_m < end);
  return {
    label,
    pace_ms: average(strokes.map(stroke => stroke.pace_ms)),
    stroke_rate: average(strokes.map(stroke => stroke.stroke_rate)),
    heart_rate: average(strokes.map(stroke => stroke.heart_rate)),
  };
}

function intervalSplits(workout) {
  return workIntervals(workout).map((interval, index) => ({
    label: `Rep ${index + 1}`,
    pace_ms: interval.pace_ms,
    stroke_rate: interval.stroke_rate,
    heart_rate: interval.heart_rate_avg,
  }));
}

function steadySplits(workout, percent = false) {
  if (!workout?.distance) return [];
  const strokes = workout.strokes || [];
  if (strokes.length === 0 && workout.pace_profile?.length >= 2) {
    return Array.from({ length: 10 }, (_, index) => {
      const start = Math.floor(workout.pace_profile.length * index / 10);
      const end = Math.max(start + 1, Math.floor(workout.pace_profile.length * (index + 1) / 10));
      return {
        label: percent ? `${index * 10}–${(index + 1) * 10}%` : `Segment ${index + 1}`,
        pace_ms: average(workout.pace_profile.slice(start, end)),
        stroke_rate: null,
        heart_rate: null,
      };
    });
  }
  if (percent) {
    return Array.from({ length: 10 }, (_, index) => {
      const start = workout.distance * index / 10;
      const end = workout.distance * (index + 1) / 10;
      return splitFromStrokes(workout, start, end, `${index * 10}–${(index + 1) * 10}%`);
    });
  }
  const size = workout.distance <= 3000 ? 500 : 1000;
  return Array.from({ length: Math.ceil(workout.distance / size) }, (_, index) => {
    const start = index * size;
    const end = Math.min(workout.distance, (index + 1) * size);
    return splitFromStrokes(workout, start, end, `${start}–${end}m`);
  });
}

export function buildComparisonSplits(workout1, workout2, match = {}) {
  const bothIntervals = workIntervals(workout1).length && workIntervals(workout2).length;
  const percent = match.axis === 'percent' || match.level === 'other';
  const rows1 = bothIntervals && !percent ? intervalSplits(workout1) : steadySplits(workout1, percent);
  const rows2 = bothIntervals && !percent ? intervalSplits(workout2) : steadySplits(workout2, percent);
  const length = Math.max(rows1.length, rows2.length);
  return Array.from({ length }, (_, index) => {
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
      pace_delta_ms: validNumber(a.pace_ms) && validNumber(b.pace_ms) ? a.pace_ms - b.pace_ms : null,
    };
  }).filter(row => row.pace1_ms != null || row.pace2_ms != null);
}

function signed(value, decimals = 1) {
  if (!Number.isFinite(value)) return null;
  const rounded = value.toFixed(decimals);
  return `${value > 0 ? '+' : ''}${rounded}`;
}

export function buildComparisonSummary(workout1, workout2, match, splits = []) {
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
  const firstHalf = average(deltas.slice(0, midpoint));
  const secondHalf = average(deltas.slice(midpoint));
  const strongestIndex = deltas.length ? deltas.indexOf(Math.min(...deltas)) : -1;
  const weakestIndex = deltas.length ? deltas.indexOf(Math.max(...deltas)) : -1;
  const where = deltas.length ? {
    firstHalf: Number.isFinite(firstHalf) ? signed(firstHalf / 1000) : null,
    secondHalf: Number.isFinite(secondHalf) ? signed(secondHalf / 1000) : null,
    strongest: validSplits[strongestIndex]?.label,
    weakest: validSplits[weakestIndex]?.label,
  } : null;

  let effort = null;
  if (paceDelta != null && validNumber(workout1.heart_rate_avg) && validNumber(workout2.heart_rate_avg)) {
    const hrDelta = workout1.heart_rate_avg - workout2.heart_rate_avg;
    effort = paceDelta < 0 && hrDelta <= 0
      ? `Faster at ${Math.abs(Math.round(hrDelta))} bpm ${hrDelta < 0 ? 'lower' : 'the same'} average HR. This suggests improved efficiency.`
      : `${paceDelta < 0 ? 'Higher output' : 'Lower output'} at ${signed(hrDelta, 0)} bpm average HR.`;
  }
  return { headline, paceDelta, where, effort };
}

export function comparisonMetricCards(workout1, workout2) {
  const fields = [
    ['Watts', validNumber(workout1?.pace_ms) ? paceToWatts(workout1.pace_ms / 1000) : null, validNumber(workout2?.pace_ms) ? paceToWatts(workout2.pace_ms / 1000) : null, 'W'],
    ['Distance / stroke', workout1?.metrics?.distance_per_stroke, workout2?.metrics?.distance_per_stroke, 'm'],
    ['HR drift', workout1?.metrics?.hr_drift_pct, workout2?.metrics?.hr_drift_pct, '%'],
    ['Rate discipline', workout1?.metrics?.rate_discipline, workout2?.metrics?.rate_discipline, ''],
    ['Consistency', workout1?.metrics?.consistency, workout2?.metrics?.consistency, ''],
    ['HR recovery', workout1?.metrics?.hr_recovery_avg, workout2?.metrics?.hr_recovery_avg, ' bpm'],
  ];
  return fields.filter(([, a, b]) => validNumber(a) && validNumber(b)).map(([label, a, b, unit]) => ({
    label, value1: Number(a), value2: Number(b), delta: Number(a) - Number(b), unit,
  }));
}
