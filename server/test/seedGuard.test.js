import { describe, expect, it } from 'vitest';
import { generateInterval, shouldAutoSeedDemoData } from '../src/seed.js';

describe('shouldAutoSeedDemoData', () => {
  it('requires an explicit non-production opt-in', () => {
    expect(shouldAutoSeedDemoData({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldAutoSeedDemoData({ NODE_ENV: 'development', ERGDASH_SEED_DEMO: '1' })).toBe(true);
    expect(shouldAutoSeedDemoData({ NODE_ENV: 'production', ERGDASH_SEED_DEMO: '1' })).toBe(false);
  });

  it('labels generated distance interval sessions with an interval workout type', () => {
    const workout = generateInterval(1, new Date('2026-07-01T08:00:00Z'), 1);
    expect(workout.type).toBe('interval');
    expect(workout.workoutType).toBe('FixedDistanceInterval');
    expect(workout.intervals.some(interval => interval.type === 'rest')).toBe(true);
  });
});
