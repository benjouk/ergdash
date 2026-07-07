import { describe, it, expect } from 'vitest';
import { periodWindow, volumeProgress, performanceGap, GOAL_PERIODS } from '../src/goalProgress.js';

describe('periodWindow', () => {
  // Wednesday 2026-07-08, 12:00 UTC
  const now = new Date('2026-07-08T12:00:00Z');

  it('computes a monday-start week', () => {
    const w = periodWindow('weekly', now, 'monday');
    expect(w.from).toBe('2026-07-06');
    expect(w.to).toBe('2026-07-13');
  });

  it('computes a sunday-start week', () => {
    const w = periodWindow('weekly', now, 'sunday');
    expect(w.from).toBe('2026-07-05');
    expect(w.to).toBe('2026-07-12');
  });

  it('starts a new week exactly on the boundary day', () => {
    const monday = new Date('2026-07-06T00:00:00Z');
    const w = periodWindow('weekly', monday, 'monday');
    expect(w.from).toBe('2026-07-06');
    expect(w.elapsedFraction).toBe(0);
  });

  it('computes calendar months, including year end', () => {
    expect(periodWindow('monthly', now)).toMatchObject({ from: '2026-07-01', to: '2026-08-01' });
    const dec = periodWindow('monthly', new Date('2026-12-15T00:00:00Z'));
    expect(dec).toMatchObject({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('anchors the season to May 1', () => {
    expect(periodWindow('season', now)).toMatchObject({ from: '2026-05-01', to: '2027-05-01' });
    const early = periodWindow('season', new Date('2026-03-10T00:00:00Z'));
    expect(early).toMatchObject({ from: '2025-05-01', to: '2026-05-01' });
    const boundary = periodWindow('season', new Date('2026-05-01T00:00:00Z'));
    expect(boundary).toMatchObject({ from: '2026-05-01', to: '2027-05-01' });
  });

  it('computes calendar years', () => {
    expect(periodWindow('year', now)).toMatchObject({ from: '2026-01-01', to: '2027-01-01' });
  });

  it('clamps elapsedFraction to [0, 1]', () => {
    for (const period of GOAL_PERIODS) {
      const { elapsedFraction } = periodWindow(period, now);
      expect(elapsedFraction).toBeGreaterThanOrEqual(0);
      expect(elapsedFraction).toBeLessThanOrEqual(1);
    }
    const midWeek = periodWindow('weekly', now, 'monday');
    expect(midWeek.elapsedFraction).toBeCloseTo(2.5 / 7, 5);
  });

  it('rejects unknown periods', () => {
    expect(() => periodWindow('fortnightly', now)).toThrow(/Unknown goal period/);
  });
});

describe('volumeProgress', () => {
  it('reports progress against the target', () => {
    const p = volumeProgress(60000, 45000, 0.5);
    expect(p.percent).toBe(75);
    expect(p.remaining_meters).toBe(15000);
    expect(p.expected_by_now).toBe(30000);
    expect(p.on_pace).toBe(true);
  });

  it('flags behind-pace progress', () => {
    const p = volumeProgress(60000, 20000, 0.5);
    expect(p.on_pace).toBe(false);
  });

  it('never reports negative remaining meters', () => {
    const p = volumeProgress(60000, 72000, 0.9);
    expect(p.remaining_meters).toBe(0);
    expect(p.percent).toBeCloseTo(120, 5);
  });

  it('handles a zero/invalid target without dividing by zero', () => {
    const p = volumeProgress(0, 1000, 0.5);
    expect(p.percent).toBe(0);
    expect(p.target_meters).toBe(0);
  });
});

describe('performanceGap', () => {
  const now = new Date('2026-07-08T12:00:00Z');
  const goal = { distance: 2000, target_time_ms: 440000, race_date: '2026-08-01' }; // 7:20 2k

  it('computes deltas against PB and prediction', () => {
    const gap = performanceGap(goal, { time_ms: 452000 }, { predicted_time: 446000 }, now);
    expect(gap.pb_delta_ms).toBe(12000);          // 12s to shave
    expect(gap.pb_pace_delta_ms).toBe(3000);      // 3s per 500m
    expect(gap.prediction_delta_ms).toBe(6000);
    expect(gap.prediction_pace_delta_ms).toBe(1500);
    expect(gap.target_pace_ms).toBe(110000);      // 1:50/500m
    expect(gap.achieved).toBe(false);
  });

  it('counts days to the race date', () => {
    const gap = performanceGap(goal, null, null, now);
    expect(gap.days_to_race).toBe(24);
    expect(gap.pb_delta_ms).toBeNull();
    expect(gap.prediction_delta_ms).toBeNull();
  });

  it('reports a race happening today as 0 days out', () => {
    const gap = performanceGap({ ...goal, race_date: '2026-07-08' }, null, null, now);
    expect(gap.days_to_race).toBe(0);
  });

  it('marks the goal achieved when the PB meets the target', () => {
    const gap = performanceGap(goal, { time_ms: 439000 }, null, now);
    expect(gap.achieved).toBe(true);
    expect(gap.pb_delta_ms).toBe(-1000);
  });

  it('omits the countdown when there is no race date', () => {
    const gap = performanceGap({ distance: 5000, target_time_ms: 1200000 }, null, null, now);
    expect(gap.days_to_race).toBeNull();
  });
});
