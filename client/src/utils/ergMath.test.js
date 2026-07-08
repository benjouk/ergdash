import { describe, expect, it } from 'vitest';
import {
  buildRacePlan, formatDuration, paceToWatts, wattsToPace, RACE_STRATEGIES,
  weightFactor, weightAdjusted, weightAdjustedDistance,
} from './ergMath.js';

describe('formatDuration', () => {
  it('pads whole seconds to two digits without a decimal', () => {
    expect(formatDuration(300, 0)).toBe('5:00');
    expect(formatDuration(2700, 0)).toBe('45:00');
    expect(formatDuration(3600, 0)).toBe('1:00:00');
    expect(formatDuration(3661, 0)).toBe('1:01:01');
  });

  it('keeps fractional digits when requested', () => {
    expect(formatDuration(419.5)).toBe('6:59.5');
    expect(formatDuration(3600)).toBe('1:00:00.0');
  });
});

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

describe('weight adjustment', () => {
  it('is 1 at the 270lb reference weight', () => {
    expect(weightFactor(270 / 2.20462)).toBeCloseTo(1, 6);
  });

  it('matches the Concept2 factor for a 75kg rower', () => {
    // 75kg ≈ 165.3lb → (165.3/270)^0.222 ≈ 0.897
    expect(weightFactor(75)).toBeCloseTo(0.8967, 3);
  });

  it('rejects missing or invalid weights', () => {
    expect(weightFactor(null)).toBeNull();
    expect(weightFactor(0)).toBeNull();
    expect(weightFactor('')).toBeNull();
    expect(weightFactor(-70)).toBeNull();
  });

  it('scales a 2k time down for a lighter rower', () => {
    const adjusted = weightAdjusted(420000, 75);
    expect(adjusted).toBeCloseTo(420000 * weightFactor(75), 6);
    expect(adjusted).toBeLessThan(420000);
  });

  it('returns null when either input is missing', () => {
    expect(weightAdjusted(420000, null)).toBeNull();
    expect(weightAdjusted(null, 75)).toBeNull();
  });

  it('grows fixed-time distance for a lighter rower', () => {
    expect(weightAdjustedDistance(8000, 75)).toBeCloseTo(8000 / weightFactor(75), 6);
    expect(weightAdjustedDistance(8000, 75)).toBeGreaterThan(8000);
  });
});
