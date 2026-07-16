import { describe, expect, it } from 'vitest';
import { buildStrokeSeries } from './Session.jsx';

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
