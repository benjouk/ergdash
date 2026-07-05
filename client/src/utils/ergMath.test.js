import { describe, expect, it } from 'vitest';
import {
  buildRacePlan,
  paceToWatts,
  wattsToPace,
  parsePaceInput,
  parseTimeInput,
  RACE_STRATEGIES,
} from './ergMath.js';

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

describe('parsePaceInput', () => {
  it('parses an explicit M:SS.t pace', () => {
    expect(parsePaceInput('2:00.0')).toBe(120);
    expect(parsePaceInput('1:58.5')).toBeCloseTo(118.5, 6);
  });

  it('parses colon-free packed digits as M:SS (no keypad colon needed)', () => {
    expect(parsePaceInput('200')).toBe(120);
    expect(parsePaceInput('158')).toBe(118);
    expect(parsePaceInput('45')).toBe(45);
    expect(parsePaceInput('5')).toBe(5);
  });

  it('reads a trailing decimal as tenths of a second', () => {
    expect(parsePaceInput('158.5')).toBeCloseTo(118.5, 6);
    expect(parsePaceInput('200.3')).toBeCloseTo(120.3, 6);
  });

  it('rejects invalid or empty pace entries', () => {
    expect(parsePaceInput('')).toBe(null);
    expect(parsePaceInput('175')).toBe(null); // 75 seconds is out of range
    expect(parsePaceInput('2:75')).toBe(null);
  });
});

describe('parseTimeInput', () => {
  it('parses colon forms', () => {
    expect(parseTimeInput('8:00.0')).toBe(480);
    expect(parseTimeInput('1:30:00')).toBe(5400);
  });

  it('parses colon-free packed digits with hours support', () => {
    expect(parseTimeInput('800')).toBe(480);
    expect(parseTimeInput('130')).toBe(90);
    expect(parseTimeInput('10000')).toBe(3600);
    expect(parseTimeInput('4000')).toBe(2400);
  });

  it('rejects out-of-range packed entries', () => {
    expect(parseTimeInput('880')).toBe(null); // 80 seconds
    expect(parseTimeInput('')).toBe(null);
  });
});
