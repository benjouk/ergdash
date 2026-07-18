// Predicted times across the benchmark distances, all from one engine.
//
// Distances the athlete actually trains get a trend projection (the same
// projectPerformance() the Targets card and race plan use, evaluated at
// today = "current form"). Distances without enough recent results are
// estimated from the nearest projected distance using pace-per-doubling
// (Paul's Law): split slows by roughly 5s/500m each time the distance
// doubles. With two or more projected distances the doubling rate is fitted
// to the athlete's own numbers instead of the folklore constant.
//
// Pure maths - callers supply the per-distance results/PBs.

import { projectPerformance } from './racePlan.js';
import { STANDARD_PB_DISTANCES } from './pbDetection.js';

export const PREDICTED_DISTANCES = STANDARD_PB_DISTANCES;

// Paul's Law default, and the sanity range a fitted slope may occupy
// (ms of split per doubling of distance). Fits outside the range mean the
// anchors don't describe a plausible fade curve; fall back to the default.
const DEFAULT_DOUBLING_MS = 5000;
const MIN_DOUBLING_MS = 2000;
const MAX_DOUBLING_MS = 9000;

function log2(value) {
  return Math.log(value) / Math.LN2;
}

// Least-squares fit of split (ms/500m) against log2(distance).
function fitDoublingSlope(anchors) {
  if (anchors.length < 2) return null;
  const xs = anchors.map(a => log2(a.distance));
  const ys = anchors.map(a => a.pace_ms);
  const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < xs.length; i++) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += Math.pow(xs[i] - meanX, 2);
  }
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  if (slope < MIN_DOUBLING_MS || slope > MAX_DOUBLING_MS) return null;
  return slope;
}

// resultsByDistance: Map/object of distance -> [{ date, time_ms, pace_ms }]
// pbByDistance: Map/object of distance -> time_ms (fastest ever, hard pieces)
// today: ISO YYYY-MM-DD
export function computePredictedTimes({ resultsByDistance, pbByDistance = {}, today }) {
  const results = resultsByDistance instanceof Map
    ? resultsByDistance
    : new Map(Object.entries(resultsByDistance || {}).map(([d, r]) => [Number(d), r]));
  const pbs = pbByDistance instanceof Map
    ? pbByDistance
    : new Map(Object.entries(pbByDistance || {}).map(([d, t]) => [Number(d), t]));

  const anchors = [];
  const trendByDistance = new Map();
  for (const distance of PREDICTED_DISTANCES) {
    const projection = projectPerformance({
      distance,
      results: results.get(distance) || [],
      toDate: today,
      today,
    });
    if (projection.projected_time_ms != null) {
      const pace = Math.round(projection.projected_time_ms / (distance / 500));
      trendByDistance.set(distance, { ...projection, pace_ms: pace });
      anchors.push({ distance, pace_ms: pace });
    }
  }

  const fitted = fitDoublingSlope(anchors);
  const doublingMs = fitted ?? DEFAULT_DOUBLING_MS;

  const rows = [];
  for (const distance of PREDICTED_DISTANCES) {
    const pbTime = pbs.get(distance) ?? null;
    const trend = trendByDistance.get(distance);

    if (trend) {
      rows.push({
        distance,
        predicted_time_ms: trend.projected_time_ms,
        pace_ms: trend.pace_ms,
        source: 'trend',
        sample_size: trend.sample_size,
        confidence: trend.confidence,
        anchor_distance: null,
        pb_time_ms: pbTime,
        delta_ms: pbTime != null ? trend.projected_time_ms - pbTime : null,
      });
      continue;
    }

    if (anchors.length === 0) continue;

    // Nearest anchor on the log-distance axis: a 6k estimate should lean on
    // the 5k trend, not the 500m one.
    const anchor = anchors.reduce((best, a) => (
      Math.abs(log2(distance / a.distance)) < Math.abs(log2(distance / best.distance)) ? a : best
    ));
    const pace = Math.round(anchor.pace_ms + doublingMs * log2(distance / anchor.distance));
    if (pace <= 0) continue;
    const predicted = Math.round(pace * (distance / 500));

    rows.push({
      distance,
      predicted_time_ms: predicted,
      pace_ms: pace,
      source: 'estimated',
      sample_size: null,
      confidence: null,
      anchor_distance: anchor.distance,
      pb_time_ms: pbTime,
      delta_ms: pbTime != null ? predicted - pbTime : null,
    });
  }

  return {
    predicted_times: rows,
    pace_per_doubling_ms: Math.round(doublingMs),
    doubling_source: fitted != null ? 'fitted' : 'default',
  };
}
