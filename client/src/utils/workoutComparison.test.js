import { describe, expect, it } from 'vitest';
import { buildComparisonSplits, buildComparisonSummary, buildMetricSeries } from './workoutComparison.js';

const workout = (overrides = {}) => ({
  distance: 2000, time_ms: 480000, pace_ms: 120000, heart_rate_avg: 160,
  strokes: Array.from({ length: 20 }, (_, index) => ({
    distance_m: index * 100, time_s: index * 24, pace_ms: 120000, stroke_rate: 28, heart_rate: 160,
  })), intervals: [], ...overrides,
});

describe('workout comparison analysis', () => {
  it('normalizes unlike sessions onto percentage completed', () => {
    const result = buildMetricSeries(workout(), workout({ distance: 5000 }), 'pace', 'percent');
    expect(result.axis).toBe('percent');
    expect(result.data).toHaveLength(50);
  });

  it('aligns work intervals while ignoring rests', () => {
    const intervals = [
      { type: 'work', pace_ms: 110000 }, { type: 'rest', pace_ms: 300000 }, { type: 'work', pace_ms: 112000 },
    ];
    const rows = buildComparisonSplits(workout({ intervals }), workout({ intervals }), { axis: 'distance' });
    expect(rows.map(row => row.label)).toEqual(['Rep 1', 'Rep 2']);
  });

  it('only calls lower HR efficient when pace also improves', () => {
    const summary = buildComparisonSummary(
      workout({ pace_ms: 118000, heart_rate_avg: 155 }), workout(), { level: 'exact', axis: 'distance' }, [],
    );
    expect(summary.effort).toContain('improved efficiency');
    const slower = buildComparisonSummary(workout({ pace_ms: 122000, heart_rate_avg: 150 }), workout(), { level: 'exact', axis: 'distance' }, []);
    expect(slower.effort).not.toContain('improved efficiency');
  });
});
