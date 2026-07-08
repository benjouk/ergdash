import { describe, expect, it } from 'vitest';
import { deriveIntervalTotals, expandRepeatDates, MAX_REPEAT_WEEKS } from '../src/routes/plans.js';

describe('deriveIntervalTotals', () => {
  it('multiplies rep distance into a total target distance', () => {
    const fields = deriveIntervalTotals({ interval_reps: 4, interval_distance: 2000 });
    expect(fields.target_distance).toBe(8000);
  });

  it('multiplies rep duration into a total target duration', () => {
    const fields = deriveIntervalTotals({ interval_reps: 3, interval_duration_ms: 600000 });
    expect(fields.target_duration_ms).toBe(1800000);
  });

  it('never overrides an explicit total', () => {
    const fields = deriveIntervalTotals({
      interval_reps: 4, interval_distance: 2000, target_distance: 9000,
    });
    expect(fields.target_distance).toBe(9000);
  });

  it('excludes rest from derived totals', () => {
    const fields = deriveIntervalTotals({
      interval_reps: 8, interval_distance: 500, interval_rest_ms: 210000,
    });
    expect(fields.target_distance).toBe(4000);
    expect(fields.target_duration_ms).toBeUndefined();
  });

  it('is a no-op without reps', () => {
    const fields = deriveIntervalTotals({ target_distance: 10000 });
    expect(fields).toEqual({ target_distance: 10000 });
  });
});

describe('expandRepeatDates', () => {
  it('returns just the plan date without repeats', () => {
    expect(expandRepeatDates('2026-07-08', 0)).toEqual(['2026-07-08']);
  });

  it('adds one date per extra week', () => {
    expect(expandRepeatDates('2026-07-08', 3)).toEqual([
      '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29',
    ]);
  });

  it('crosses month and year boundaries', () => {
    expect(expandRepeatDates('2026-12-28', 1)).toEqual(['2026-12-28', '2027-01-04']);
  });

  it('caps at a sane maximum', () => {
    expect(expandRepeatDates('2026-07-08', MAX_REPEAT_WEEKS)).toHaveLength(26);
  });
});
