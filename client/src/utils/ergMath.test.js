import { describe, expect, it } from 'vitest';
import { buildRacePlan, paceToWatts, wattsToPace } from './ergMath.js';

describe('erg math', () => {
  it('converts 2:00 pace to watts using the Concept2 formula', () => {
    expect(paceToWatts(120)).toBeCloseTo(2.80 / Math.pow(120 / 500, 3), 6);
    expect(paceToWatts(120)).toBeCloseTo(202.546, 3);
  });

  it('round-trips pace to watts and back', () => {
    const pace = 126.4;
    const watts = paceToWatts(pace);

    expect(wattsToPace(watts)).toBeCloseTo(pace, 6);
  });

  it('builds race planner splits that sum to the target time', () => {
    const plan = buildRacePlan(2000, 480);

    expect(plan.splitSeconds).toBe(120);
    expect(plan.splits).toHaveLength(4);
    expect(plan.splits.reduce((sum, split) => sum + split.splitTimeSeconds, 0)).toBeCloseTo(480, 6);
    expect(plan.splits[plan.splits.length - 1].cumulativeTimeSeconds).toBe(480);
  });
});
