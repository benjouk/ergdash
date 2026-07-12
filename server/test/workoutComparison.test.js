import { describe, expect, it } from 'vitest';
import { classifyComparison, rankComparisonCandidates } from '../src/workoutComparison.js';

const workout = (overrides = {}) => ({
  id: 1, type: 'rower', inferred_tag: 'endurance', workout_type: 'FixedDistanceSplits',
  distance: 5000, time_ms: 1200000, date: '2026-06-10T08:00:00', ...overrides,
});

describe('workout comparison matching', () => {
  it('matches fixed-distance sessions and rejects a different erg type', () => {
    expect(classifyComparison(workout(), workout({ id: 2, distance: 5030 }))).toMatchObject({ level: 'exact', axis: 'distance' });
    expect(classifyComparison(workout(), workout({ id: 2, type: 'skierg' }))).toMatchObject({ level: 'other' });
  });

  it('matches fixed-time sessions by duration', () => {
    const current = workout({ workout_type: 'FixedTimeSplits', time_ms: 1800000 });
    expect(classifyComparison(current, workout({ id: 2, workout_type: 'FixedTimeSplits', time_ms: 1804000 }))).toMatchObject({ level: 'exact', axis: 'time' });
    expect(classifyComparison(current, workout({ id: 3, workout_type: 'FixedTimeSplits', time_ms: 1870000 }))).toMatchObject({ level: 'close' });
  });

  it('matches an endurance JustRow to a fixed-distance piece, but not an equal-distance interval set', () => {
    const justRow = workout({
      id: 105118097,
      workout_type: 'JustRow',
      distance: 5002,
      time_ms: 1371300,
    });
    const fixedDistance = workout({
      id: 86877101,
      workout_type: 'FixedDistanceSplits',
      distance: 5000,
      time_ms: 1490700,
    });

    expect(classifyComparison(justRow, fixedDistance)).toMatchObject({
      level: 'exact', reason: 'Same distance', axis: 'distance',
    });
    expect(classifyComparison(fixedDistance, justRow)).toMatchObject({
      level: 'exact', reason: 'Same distance', axis: 'distance',
    });

    const fiveByOneK = workout({
      id: 3,
      inferred_tag: 'interval',
      workout_type: 'FixedDistanceInterval',
      distance: 5000,
    });
    expect(classifyComparison(justRow, fiveByOneK)).toMatchObject({ level: 'other' });
  });

  it('requires interval work and rest structures to align', () => {
    const current = workout({ inferred_tag: 'interval', workout_type: 'FixedDistanceInterval' });
    const work = [{ type: 'work', distance: 500 }, { type: 'rest', time_ms: 90000 }, { type: 'work', distance: 500 }];
    expect(classifyComparison(current, workout({ id: 2, inferred_tag: 'interval', workout_type: 'FixedDistanceInterval' }), work, work)).toMatchObject({ level: 'exact' });
    expect(classifyComparison(current, workout({ id: 3, inferred_tag: 'interval', workout_type: 'FixedDistanceInterval' }), work, [])).toMatchObject({ level: 'other' });
  });

  it('prefers earlier exact matches, then later exact and close matches', () => {
    const current = workout();
    const candidates = [
      { ...workout({ id: 2, date: '2026-06-11' }), comparison_match: { level: 'exact' } },
      { ...workout({ id: 3, date: '2026-06-09' }), comparison_match: { level: 'exact' } },
      { ...workout({ id: 4, date: '2026-06-08' }), comparison_match: { level: 'close' } },
    ];
    expect(rankComparisonCandidates(current, candidates).map(item => item.id)).toEqual([3, 2, 4]);
  });
});
