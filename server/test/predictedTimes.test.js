import { describe, it, expect } from 'vitest';
import { computePredictedTimes, PREDICTED_DISTANCES } from '../src/predictedTimes.js';

const TODAY = '2026-07-18';

// n recent results at the distance, improving slightly, all near-maximal.
function results(distance, basePaceMs, n = 4) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(Date.parse('2026-05-01T00:00:00Z') + i * 14 * 86400000)
      .toISOString().slice(0, 10);
    const pace = basePaceMs - i * 500;
    rows.push({ date, pace_ms: pace, time_ms: Math.round(pace * (distance / 500)) });
  }
  return rows;
}

describe('computePredictedTimes', () => {
  it('projects trained distances from their trend and estimates the rest', () => {
    const out = computePredictedTimes({
      resultsByDistance: new Map([
        [2000, results(2000, 102000)],
        [5000, results(5000, 110000)],
      ]),
      today: TODAY,
    });

    const byDistance = new Map(out.predicted_times.map(r => [r.distance, r]));
    expect(byDistance.get(2000).source).toBe('trend');
    expect(byDistance.get(5000).source).toBe('trend');
    expect(byDistance.get(10000).source).toBe('estimated');
    expect(byDistance.get(10000).anchor_distance).toBe(5000);
    expect(byDistance.get(500).anchor_distance).toBe(2000);

    // Longer distances predict slower splits, shorter ones faster.
    expect(byDistance.get(10000).pace_ms).toBeGreaterThan(byDistance.get(5000).pace_ms);
    expect(byDistance.get(500).pace_ms).toBeLessThan(byDistance.get(2000).pace_ms);

    // Every benchmark distance gets a row once any anchor exists.
    expect(out.predicted_times.map(r => r.distance)).toEqual(PREDICTED_DISTANCES);
  });

  it('fits the athlete-specific pace-per-doubling from two or more anchors', () => {
    // 2k at 1:42, 5k at 1:50: 8s over ~1.32 doublings => ~6.05s per doubling.
    const out = computePredictedTimes({
      resultsByDistance: new Map([
        [2000, results(2000, 102000)],
        [5000, results(5000, 110000)],
      ]),
      today: TODAY,
    });
    expect(out.doubling_source).toBe('fitted');
    expect(out.pace_per_doubling_ms).toBeGreaterThan(5000);
    expect(out.pace_per_doubling_ms).toBeLessThan(7500);
  });

  it('falls back to the Paul Law default with a single anchor', () => {
    const out = computePredictedTimes({
      resultsByDistance: new Map([[5000, results(5000, 110000)]]),
      today: TODAY,
    });
    expect(out.doubling_source).toBe('default');
    expect(out.pace_per_doubling_ms).toBe(5000);

    const byDistance = new Map(out.predicted_times.map(r => [r.distance, r]));
    // One doubling up from 5k: split slows by ~5s.
    const anchor = byDistance.get(5000);
    expect(byDistance.get(10000).pace_ms).toBe(anchor.pace_ms + 5000);
  });

  it('rejects an implausible fitted slope and uses the default', () => {
    // Identical splits at 2k and 21k implies zero fade - outside the sane range.
    const out = computePredictedTimes({
      resultsByDistance: new Map([
        [2000, results(2000, 110000)],
        [21097, results(21097, 110000)],
      ]),
      today: TODAY,
    });
    expect(out.doubling_source).toBe('default');
    expect(out.pace_per_doubling_ms).toBe(5000);
  });

  it('returns nothing without a single projectable distance', () => {
    const out = computePredictedTimes({
      resultsByDistance: new Map([[2000, results(2000, 102000, 2)]]), // below sample threshold
      today: TODAY,
    });
    expect(out.predicted_times).toEqual([]);
  });

  it('reports the gap to the PB where one exists', () => {
    const out = computePredictedTimes({
      resultsByDistance: new Map([[2000, results(2000, 102000)]]),
      pbByDistance: new Map([[2000, 399000]]),
      today: TODAY,
    });
    const row = out.predicted_times.find(r => r.distance === 2000);
    expect(row.pb_time_ms).toBe(399000);
    expect(row.delta_ms).toBe(row.predicted_time_ms - 399000);
  });
});
