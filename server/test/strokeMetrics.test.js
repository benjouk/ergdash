import { describe, it, expect } from 'vitest';
import {
  wattsFromPace,
  paceFromWatts,
  distancePerStroke,
  wattsPerBeat,
  hrDrift,
  segmentStrokesByIntervals,
  rateDiscipline,
  hrRecoveries,
  zoneTimes,
  bestEfforts,
} from '../src/strokeMetrics.js';

// Synthetic stroke stream: one stroke every `dt` seconds.
function makeStrokes(count, { dt = 2, pace = 120000, rate = 22, hr = 150, dps = 10 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    stroke_number: i + 1,
    time_s: (i + 1) * dt,
    distance_m: (i + 1) * dps,
    pace_ms: typeof pace === 'function' ? pace(i) : pace,
    watts: null,
    stroke_rate: typeof rate === 'function' ? rate(i) : rate,
    heart_rate: typeof hr === 'function' ? hr(i) : hr,
  }));
}

describe('wattsFromPace / paceFromWatts', () => {
  it('matches the Concept2 reference point (2:00/500m ≈ 202.5W)', () => {
    expect(wattsFromPace(120000)).toBeCloseTo(202.8, 0);
  });

  it('round-trips pace → watts → pace', () => {
    expect(paceFromWatts(wattsFromPace(105000))).toBeCloseTo(105000, -1);
  });

  it('returns null for invalid pace', () => {
    expect(wattsFromPace(0)).toBeNull();
    expect(wattsFromPace(null)).toBeNull();
  });
});

describe('distancePerStroke', () => {
  it('prefers workout totals', () => {
    expect(distancePerStroke({ distance: 2000, stroke_count: 200 }, [])).toBeCloseTo(10);
  });

  it('falls back to the stroke stream', () => {
    const strokes = makeStrokes(100, { dps: 9.5 });
    const dps = distancePerStroke({}, strokes);
    expect(dps).toBeCloseTo(9.5, 1);
  });

  it('rejects implausible values', () => {
    expect(distancePerStroke({ distance: 2000, stroke_count: 10 }, [])).toBeNull(); // 200 m/stroke
    expect(distancePerStroke({ distance: 100, stroke_count: 200 }, [])).toBeNull(); // 0.5 m/stroke
  });

  it('returns null with no data', () => {
    expect(distancePerStroke({}, [])).toBeNull();
  });
});

describe('wattsPerBeat', () => {
  it('computes avg watts / avg HR', () => {
    const strokes = makeStrokes(100, { pace: 120000, hr: 150 });
    expect(wattsPerBeat(strokes)).toBeCloseTo(wattsFromPace(120000) / 150, 3);
  });

  it('prefers recorded watts over derived', () => {
    const strokes = makeStrokes(100, { hr: 150 }).map(s => ({ ...s, watts: 300 }));
    expect(wattsPerBeat(strokes)).toBeCloseTo(2, 3);
  });

  it('returns null below the stroke threshold', () => {
    expect(wattsPerBeat(makeStrokes(10))).toBeNull();
  });

  it('ignores strokes without HR', () => {
    const strokes = makeStrokes(100, { hr: (i) => (i % 2 === 0 ? 150 : 0) });
    expect(wattsPerBeat(strokes)).toBeCloseTo(wattsFromPace(120000) / 150, 3);
  });
});

describe('hrDrift', () => {
  it('is ~0 for constant pace and HR', () => {
    const strokes = makeStrokes(200);
    expect(Math.abs(hrDrift(strokes))).toBeLessThan(0.01);
  });

  it('is positive when HR creeps at constant power', () => {
    const strokes = makeStrokes(200, { hr: (i) => 140 + i * 0.1 });
    const drift = hrDrift(strokes);
    expect(drift).toBeGreaterThan(3);
    expect(drift).toBeLessThan(15);
  });

  it('is negative when HR falls at constant power', () => {
    const strokes = makeStrokes(200, { hr: (i) => 170 - i * 0.1 });
    expect(hrDrift(strokes)).toBeLessThan(-3);
  });

  it('excludes a finishing sprint from the drift calculation', () => {
    const strokes = makeStrokes(200, {
      pace: (i) => (i >= 190 ? 100000 : 120000),
    });
    expect(Math.abs(hrDrift(strokes))).toBeLessThan(0.01);
  });

  it('returns null on short sessions', () => {
    expect(hrDrift(makeStrokes(30))).toBeNull();
  });
});

describe('segmentStrokesByIntervals', () => {
  // 2 × 60s work / 30s rest; strokes every 2 s spanning the full clock.
  const intervals = [
    { interval_index: 0, type: 'work', time_ms: 60000, distance: 250 },
    { interval_index: 1, type: 'rest', time_ms: 30000, distance: 0 },
    { interval_index: 2, type: 'work', time_ms: 60000, distance: 250 },
  ];

  it('segments by time when the stroke clock spans rests', () => {
    const strokes = makeStrokes(75, { dt: 2 }); // last stroke at t=150s = total
    const { workSegments, restDurations } = segmentStrokesByIntervals(strokes, intervals);
    expect(workSegments).toHaveLength(2);
    expect(restDurations).toEqual([30]);
    // rep 1: t in [0, 60) → strokes 1..29 (t=2..58)
    expect(workSegments[0].every(s => s.time_s < 60)).toBe(true);
    // rep 2: t in [90, 150)
    expect(workSegments[1].every(s => s.time_s >= 90 && s.time_s < 150)).toBe(true);
    expect(workSegments[1].length).toBeGreaterThan(20);
  });

  it('falls back to distance when the stroke clock is work-only', () => {
    // 120 s of work strokes only (clock never spans the 150 s total)
    const strokes = makeStrokes(60, { dt: 2, dps: 500 / 60 });
    const { workSegments } = segmentStrokesByIntervals(strokes, intervals);
    expect(workSegments).toHaveLength(2);
    const total = workSegments[0].length + workSegments[1].length;
    expect(total).toBeGreaterThan(50);
  });

  it('uses distance when rest rows are missing, even if the clock spans rests', () => {
    // C2 often reports only work intervals: 2 × 250m work, but the stroke
    // clock runs through the (unlisted) rests to 150 s.
    const workOnly = [
      { interval_index: 0, type: 'work', time_ms: 60000, distance: 250 },
      { interval_index: 1, type: 'work', time_ms: 60000, distance: 250 },
    ];
    // 75 strokes over 150 s covering 500 m total
    const strokes = makeStrokes(75, { dt: 2, dps: 500 / 75 });
    const { workSegments, restDurations } = segmentStrokesByIntervals(strokes, workOnly);
    expect(workSegments).toHaveLength(2);
    expect(restDurations).toEqual([null]);
    expect(workSegments[0].every(s => s.distance_m < 250)).toBe(true);
    expect(workSegments[1].every(s => s.distance_m >= 250)).toBe(true);
  });

  it('handles empty input', () => {
    expect(segmentStrokesByIntervals([], intervals).workSegments).toHaveLength(0);
    expect(segmentStrokesByIntervals(makeStrokes(10), []).workSegments).toHaveLength(0);
  });
});

describe('rateDiscipline', () => {
  it('scores 100 for a perfectly held rate', () => {
    expect(rateDiscipline([makeStrokes(100, { rate: 22 })])).toBe(100);
  });

  it('penalises strokes outside the band', () => {
    // 80 strokes at 22, 20 strokes at 30 → 80% in band around median 22
    const strokes = makeStrokes(100, { rate: (i) => (i < 80 ? 22 : 30) });
    expect(rateDiscipline([strokes])).toBe(80);
  });

  it('respects the tolerance parameter', () => {
    const strokes = makeStrokes(100, { rate: (i) => (i % 2 === 0 ? 20 : 24) });
    // median 22, |20−22| = |24−22| = 2 → within default tolerance
    expect(rateDiscipline([strokes], 2)).toBe(100);
    expect(rateDiscipline([strokes], 1)).toBe(0);
  });

  it('averages per-segment scores', () => {
    const seg1 = makeStrokes(100, { rate: 22 });
    const seg2 = makeStrokes(100, { rate: (i) => (i < 50 ? 28 : 34) });
    // seg1 = 100; seg2 median 31 → nothing within ±2 of 31... both halves 3 away
    expect(rateDiscipline([seg1, seg2], 2)).toBeCloseTo(50);
  });

  it('returns null when no segment has enough strokes', () => {
    expect(rateDiscipline([makeStrokes(5)])).toBeNull();
  });
});

describe('hrRecoveries', () => {
  it('measures the drop across each rest', () => {
    const intervals = [
      { interval_index: 0, type: 'work', time_ms: 60000, distance: 250 },
      { interval_index: 1, type: 'rest', time_ms: 60000, distance: 0 },
      { interval_index: 2, type: 'work', time_ms: 60000, distance: 250 },
    ];
    // Work rep 1 ends at HR 170; after the rest, rep 2 starts at HR 130.
    const strokes = makeStrokes(90, {
      dt: 2,
      hr: (i) => {
        const t = (i + 1) * 2;
        if (t < 60) return 170;
        if (t < 120) return 0; // no strokes recorded HR during rest
        return 130 + (t - 120) * 0.5;
      },
    });
    const recoveries = hrRecoveries(strokes, intervals);
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0].hr_end).toBe(170);
    expect(recoveries[0].hr_next_start).toBeLessThan(140);
    expect(recoveries[0].drop_bpm).toBeGreaterThan(30);
    expect(recoveries[0].rest_s).toBe(60);
  });

  it('skips pairs without enough HR strokes', () => {
    const intervals = [
      { interval_index: 0, type: 'work', time_ms: 60000 },
      { interval_index: 1, type: 'rest', time_ms: 30000 },
      { interval_index: 2, type: 'work', time_ms: 60000 },
    ];
    const strokes = makeStrokes(75, { dt: 2, hr: 0 });
    expect(hrRecoveries(strokes, intervals)).toHaveLength(0);
  });
});

describe('zoneTimes', () => {
  const bounds = [114, 133, 152, 171, 190]; // maxHr 190, 60/70/80/90/100%

  it('credits all time to one zone for constant HR', () => {
    const strokes = makeStrokes(100, { dt: 2, hr: 150 }); // zone 3 (134–152)
    const times = zoneTimes(strokes, bounds);
    expect(times[3]).toBeCloseTo(200);
    expect(times[1] + times[2] + times[4] + times[5]).toBe(0);
  });

  it('clamps gap deltas', () => {
    const strokes = [
      { time_s: 2, heart_rate: 150 },
      { time_s: 200, heart_rate: 150 }, // 198 s gap → clamped to 30
    ];
    const times = zoneTimes(strokes, bounds);
    expect(times[3]).toBeCloseTo(32);
  });

  it('returns null with no HR data', () => {
    expect(zoneTimes(makeStrokes(50, { hr: 0 }), bounds)).toBeNull();
    expect(zoneTimes([], bounds)).toBeNull();
  });
});

describe('bestEfforts', () => {
  it('finds the surge window', () => {
    // 600 strokes @ 2 s = 20 min; strokes 150–209 (t=300–420 s) at 2 s faster pace
    const strokes = makeStrokes(600, {
      dt: 2,
      pace: (i) => (i >= 150 && i < 210 ? 100000 : 120000),
    });
    const [oneMin] = bestEfforts(strokes, [60]);
    expect(oneMin.duration_s).toBe(60);
    expect(oneMin.avg_watts).toBeCloseTo(wattsFromPace(100000), 0);
    expect(oneMin.start_time_s).toBeGreaterThanOrEqual(300);
    expect(oneMin.start_time_s).toBeLessThan(420);
  });

  it('skips durations longer than the session', () => {
    const strokes = makeStrokes(100, { dt: 2 }); // 200 s
    const results = bestEfforts(strokes, [60, 600]);
    expect(results.map(r => r.duration_s)).toEqual([60]);
  });

  it('reports a pace equivalent', () => {
    const strokes = makeStrokes(300, { dt: 2, pace: 120000 });
    const [best] = bestEfforts(strokes, [240]);
    expect(best.avg_pace_ms).toBeCloseTo(120000, -3);
  });

  it('returns empty for no usable strokes', () => {
    expect(bestEfforts([], [60])).toEqual([]);
  });
});
