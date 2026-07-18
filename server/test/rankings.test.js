import { describe, it, expect } from 'vitest';
import {
  percentileForPace, weightClass, ageBand, ageFromBirthYear,
  eventKeyForDistance, eventKeyForDuration, athleteFromSettings,
} from '../src/rankings.js';

// pace_ms for a 2k time in seconds
const pace2k = (timeS) => (timeS / 4) * 1000;

describe('weightClass', () => {
  it('applies the Concept2 lightweight cutoffs', () => {
    expect(weightClass('M', 75)).toBe('lwt');
    expect(weightClass('M', 75.5)).toBe('hwt');
    expect(weightClass('F', 61.5)).toBe('lwt');
    expect(weightClass('F', 62)).toBe('hwt');
  });

  it('defaults to heavyweight when weight is unknown', () => {
    expect(weightClass('M', null)).toBe('hwt');
    expect(weightClass('F', 0)).toBe('hwt');
  });
});

describe('ageBand', () => {
  it('buckets by ranking decade', () => {
    expect(ageBand(24)).toBe('19-29');
    expect(ageBand(39)).toBe('30-39');
    expect(ageBand(40)).toBe('40-49');
    expect(ageBand(71)).toBe('70+');
    expect(ageBand(null)).toBeNull();
  });
});

describe('ageFromBirthYear', () => {
  it('derives an approximate age', () => {
    const now = new Date('2026-07-18T00:00:00Z');
    expect(ageFromBirthYear(1989, now)).toBe(37);
    expect(ageFromBirthYear('1989', now)).toBe(37);
    expect(ageFromBirthYear(null, now)).toBeNull();
    expect(ageFromBirthYear(1850, now)).toBeNull();
  });
});

describe('event keys', () => {
  it('maps ranked events and rejects others', () => {
    expect(eventKeyForDistance(2000)).toBe('d2000');
    expect(eventKeyForDistance(21097)).toBe('d21097');
    expect(eventKeyForDistance(1234)).toBeNull();
    expect(eventKeyForDuration(1800)).toBe('t1800');
    expect(eventKeyForDuration(1234)).toBeNull();
  });
});

describe('percentileForPace', () => {
  const base = { event: 'd2000', sex: 'M', age: 35, weightKg: 90 };

  it('rates a fast 2k high and a slow 2k low', () => {
    const fast = percentileForPace({ ...base, paceMs: pace2k(6 * 60 + 30) });
    const mid = percentileForPace({ ...base, paceMs: pace2k(7 * 60 + 15) });
    const slow = percentileForPace({ ...base, paceMs: pace2k(9 * 60 + 30) });

    expect(fast.percentile).toBeGreaterThanOrEqual(90);
    expect(mid.percentile).toBeGreaterThanOrEqual(45);
    expect(mid.percentile).toBeLessThanOrEqual(55);
    expect(slow.percentile).toBeLessThan(5);
  });

  it('is monotonic: a faster pace never ranks lower', () => {
    let prev = null;
    for (let t = 360; t <= 640; t += 5) {
      const { percentile } = percentileForPace({ ...base, paceMs: pace2k(t) });
      if (prev != null) expect(percentile).toBeLessThanOrEqual(prev);
      expect(percentile).toBeGreaterThanOrEqual(1);
      expect(percentile).toBeLessThanOrEqual(99);
      prev = percentile;
    }
  });

  it('adjusts for sex, age, and weight class', () => {
    const paceMs = pace2k(7 * 60 + 40);
    const openM = percentileForPace({ event: 'd2000', sex: 'M', age: 30, weightKg: 90, paceMs });
    const openF = percentileForPace({ event: 'd2000', sex: 'F', age: 30, weightKg: 75, paceMs });
    const veteranM = percentileForPace({ event: 'd2000', sex: 'M', age: 62, weightKg: 90, paceMs });
    const lightM = percentileForPace({ event: 'd2000', sex: 'M', age: 30, weightKg: 72, paceMs });

    expect(openF.percentile).toBeGreaterThan(openM.percentile);
    expect(veteranM.percentile).toBeGreaterThan(openM.percentile);
    expect(lightM.percentile).toBeGreaterThan(openM.percentile);
    expect(lightM.weight_class).toBe('lwt');
    expect(veteranM.age_band).toBe('60-69');
  });

  it('expects slower paces for longer events at the same percentile', () => {
    const paceMs = pace2k(7 * 60 + 15); // ~p50 for a 2k
    const on2k = percentileForPace({ ...base, paceMs });
    const on10k = percentileForPace({ ...base, event: 'd10000', paceMs });
    expect(on10k.percentile).toBeGreaterThan(on2k.percentile);
  });

  it('flags every result as approximate', () => {
    expect(percentileForPace({ ...base, paceMs: pace2k(420) }).approximate).toBe(true);
  });

  it('returns null for unranked events, unknown sex, or bad pace', () => {
    expect(percentileForPace({ ...base, event: 'd1234', paceMs: 100000 })).toBeNull();
    expect(percentileForPace({ event: 'd2000', sex: null, paceMs: 100000 })).toBeNull();
    expect(percentileForPace({ ...base, paceMs: 0 })).toBeNull();
  });

  it('works without age or weight (open heavyweight bucket)', () => {
    const r = percentileForPace({ event: 'd2000', sex: 'M', paceMs: pace2k(435) });
    expect(r.age_band).toBeNull();
    expect(r.weight_class).toBe('hwt');
    expect(r.percentile).toBeGreaterThanOrEqual(45);
    expect(r.percentile).toBeLessThanOrEqual(55);
  });
});

describe('athleteFromSettings', () => {
  it('requires sex and passes through age and weight', () => {
    expect(athleteFromSettings({})).toBeNull();
    expect(athleteFromSettings({ sex: 'X' })).toBeNull();

    const now = new Date('2026-07-18T00:00:00Z');
    const a = athleteFromSettings({ sex: 'M', birth_year: '1989', weight_kg: '92' }, now);
    expect(a).toEqual({ sex: 'M', age: 37, weightKg: 92 });

    const minimal = athleteFromSettings({ sex: 'F' }, now);
    expect(minimal).toEqual({ sex: 'F', age: null, weightKg: null });
  });
});
