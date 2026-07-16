import { describe, expect, it } from 'vitest';
import { buildPhaseBoundaryDistances, buildStrokeSeries } from './Session.jsx';

describe('buildStrokeSeries', () => {
  it('keeps raw rate values while adding a centred 5-stroke rolling median', () => {
    const strokes = [20, 21, 40, 22, 23].map((strokeRate, index) => ({
      distance_m: index * 10,
      pace_ms: 120000,
      stroke_rate: strokeRate,
      heart_rate: 150 + index,
    }));

    const points = buildStrokeSeries(strokes);

    expect(points.map(point => point.stroke_rate)).toEqual([20, 21, 40, 22, 23]);
    expect(points.map(point => point.stroke_rate_smooth)).toEqual([21, 21.5, 22, 22.5, 23]);
  });

  it('ignores absent rate readings without dropping pace points', () => {
    const points = buildStrokeSeries([
      { distance_m: 0, pace_ms: 120000, stroke_rate: null },
      { distance_m: 10, pace_ms: 120000, stroke_rate: 24 },
      { distance_m: 20, pace_ms: 120000, stroke_rate: 25 },
    ]);

    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ stroke_rate: null, stroke_rate_smooth: 24.5 });
  });
});

describe('buildPhaseBoundaryDistances', () => {
  it('maps fixed-time phase starts to stroke distances when pace varies', () => {
    const phases = [
      { name: 'Opening', start_s: 0, end_s: 25, start_pct: 0, end_pct: 25 },
      { name: 'Settle', start_s: 25, end_s: 50, start_pct: 25, end_pct: 50 },
      { name: 'Middle', start_s: 50, end_s: 75, start_pct: 50, end_pct: 75 },
      { name: 'Finish', start_s: 75, end_s: 100, start_pct: 75, end_pct: 100 },
    ];
    const strokes = [
      { time_s: 0, distance_m: 0 },
      { time_s: 25, distance_m: 100 },
      { time_s: 50, distance_m: 300 },
      { time_s: 75, distance_m: 600 },
      { time_s: 100, distance_m: 1000 },
    ];

    expect(buildPhaseBoundaryDistances(phases, 1000, null, strokes))
      .toEqual([100, 300, 600]);
  });

  it('maps window-relative phase times onto the raw recording', () => {
    const phases = [
      { name: 'Opening', start_s: 0, end_s: 20 },
      { name: 'Settle', start_s: 20, end_s: 40 },
      { name: 'Middle', start_s: 40, end_s: 60 },
    ];
    const strokes = [
      { time_s: 280, distance_m: 900 },
      { time_s: 300, distance_m: 1000 },
      { time_s: 320, distance_m: 1080 },
      { time_s: 340, distance_m: 1200 },
      { time_s: 360, distance_m: 1380 },
    ];

    expect(buildPhaseBoundaryDistances(
      phases,
      380,
      { start_time_s: 300, start_distance_m: 1000 },
      strokes
    )).toEqual([1080, 1200]);
  });
});
