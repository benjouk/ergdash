import { describe, expect, it } from 'vitest';
import { buildRacePlan, paceToWatts, wattsToPace, RACE_STRATEGIES } from './ergMath.js';

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
    expect(plan.strategy).toBe('even');
    expect(plan.splits).toHaveLength(4);
    expect(plan.splits.reduce((sum, split) => sum + split.splitTimeSeconds, 0)).toBeCloseTo(480, 6);
    expect(plan.splits[plan.splits.length - 1].cumulativeTimeSeconds).toBe(480);
  });

  it('conserves total time for every strategy', () => {
    for (const strategy of RACE_STRATEGIES) {
      const plan = buildRacePlan(2000, 480, 500, strategy);
      const total = plan.splits.reduce((sum, split) => sum + split.splitTimeSeconds, 0);
      expect(total).toBeCloseTo(480, 6);
      expect(plan.splits[plan.splits.length - 1].cumulativeTimeSeconds).toBe(480);
    }
  });

  it('makes a negative split start slow and finish fast', () => {
    const { splits } = buildRacePlan(2000, 480, 500, 'negative');
    expect(splits[0].paceSeconds).toBeGreaterThan(splits[splits.length - 1].paceSeconds);
  });

  it('makes an aggressive split start fast and fade', () => {
    const { splits } = buildRacePlan(2000, 480, 500, 'aggressive');
    expect(splits[0].paceSeconds).toBeLessThan(splits[splits.length - 1].paceSeconds);
  });

  it('keeps every split identical for an even strategy', () => {
    const { splits } = buildRacePlan(2000, 480, 500, 'even');
    for (const split of splits) {
      expect(split.paceSeconds).toBeCloseTo(120, 6);
    }
  });
});
