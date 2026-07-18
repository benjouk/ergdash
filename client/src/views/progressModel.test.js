import { describe, expect, it } from 'vitest';
import {
  buildTechniqueSummaries,
  normalizeProgressView,
  rollingMetric,
  selectPrimaryTarget,
} from './progressModel.js';

describe('normalizeProgressView', () => {
  it('accepts known views and falls back to Overview', () => {
    expect(normalizeProgressView('technique')).toBe('technique');
    expect(normalizeProgressView('anything')).toBe('overview');
    expect(normalizeProgressView(null)).toBe('overview');
  });
});

describe('selectPrimaryTarget', () => {
  it('prefers the nearest upcoming active performance target', () => {
    const goals = [
      { id: 1, kind: 'performance', active: true, progress: { days_to_race: 40 } },
      { id: 2, kind: 'performance', active: true, progress: { days_to_race: 12 } },
      { id: 3, kind: 'volume', active: true },
      { id: 4, kind: 'performance', active: false, progress: { days_to_race: 2 } },
    ];
    expect(selectPrimaryTarget(goals).id).toBe(2);
  });

  it('returns an undated target when no upcoming race exists', () => {
    const goals = [
      { id: 1, kind: 'performance', active: true, race_date: '2025-01-01', progress: { days_to_race: -20 } },
      { id: 2, kind: 'performance', active: true, race_date: null, progress: {} },
    ];
    expect(selectPrimaryTarget(goals).id).toBe(2);
    expect(selectPrimaryTarget([])).toBeNull();
  });
});

describe('technique summaries', () => {
  it('reports availability, rolling values, and deltas without inventing sparse trends', () => {
    expect(rollingMetric([{ score: 1 }, { score: 2 }], 'score')).toEqual({
      available: false, value: null, delta: null, count: 2,
    });

    const summaries = buildTechniqueSummaries({
      efficiency: [1.3, 1.4, 1.5],
      hr_drift: [{ hr_drift_pct: 8 }, { hr_drift_pct: 6 }, { hr_drift_pct: 4 }],
      dps: [{ dps: 9 }, { dps: 9.5 }, { dps: 10 }],
      discipline: [{ rate_discipline: 88 }, { rate_discipline: 90 }, { rate_discipline: 92 }],
      consistency: [{ consistency: 80 }, { consistency: 84 }, { consistency: 86 }],
      drag: [{ drag_factor: 120 }, { drag_factor: 122 }],
    });

    expect(summaries.efficiency.available).toBe(true);
    expect(summaries.efficiency.value).toBeCloseTo(1.4);
    expect(summaries.efficiency.count).toBe(3);
    expect(summaries.hr_drift).toMatchObject({ available: true, value: 4, delta: -4 });
    expect(summaries.stroke_quality).toMatchObject({ available: true, value: 90, secondaryValue: 83.33333333333333 });
    expect(summaries.drag).toMatchObject({ available: true, value: 122, count: 2 });
  });
});
