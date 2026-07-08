import { describe, expect, it } from 'vitest';
import {
  deriveIntervalTotals, expandRepeatDates, mergeIntervalPatch, MAX_REPEAT_WEEKS,
} from '../src/routes/plans.js';

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

describe('mergeIntervalPatch', () => {
  const intervalPlan = {
    interval_reps: 4, interval_distance: 2000, interval_duration_ms: null,
    interval_rest_ms: 300000, target_distance: 8000, target_duration_ms: null,
  };

  it('is a no-op for patches that leave intervals alone', () => {
    const fields = { target_pace_ms: 105000 };
    expect(mergeIntervalPatch(intervalPlan, fields)).toEqual([]);
    expect(fields).toEqual({ target_pace_ms: 105000 });
  });

  it('recomputes totals when only reps change', () => {
    const fields = { interval_reps: 5 };
    expect(mergeIntervalPatch(intervalPlan, fields)).toEqual([]);
    expect(fields.target_distance).toBe(10000);
    expect(fields.target_duration_ms).toBeNull();
  });

  it('recomputes totals when rep distance changes', () => {
    const fields = { interval_distance: 1000 };
    expect(mergeIntervalPatch(intervalPlan, fields)).toEqual([]);
    expect(fields.target_distance).toBe(4000);
  });

  it('swaps the derived total when work moves from distance to duration', () => {
    const fields = { interval_distance: null, interval_duration_ms: 600000 };
    expect(mergeIntervalPatch(intervalPlan, fields)).toEqual([]);
    expect(fields.target_distance).toBeNull();
    expect(fields.target_duration_ms).toBe(2400000);
  });

  it('never overrides totals the patch sets explicitly', () => {
    const fields = { interval_reps: 5, target_distance: 12000 };
    expect(mergeIntervalPatch(intervalPlan, fields)).toEqual([]);
    expect(fields.target_distance).toBe(12000);
    expect(fields.target_duration_ms).toBeUndefined();
  });

  it('rejects a merged shape with reps but no work', () => {
    const errors = mergeIntervalPatch(intervalPlan, { interval_distance: null });
    expect(errors).toEqual(['interval_reps requires interval_distance or interval_duration_ms']);
  });

  it('rejects clearing reps while work fields remain', () => {
    const errors = mergeIntervalPatch(intervalPlan, { interval_reps: null });
    expect(errors).toEqual(['interval fields require interval_reps']);
  });

  it('allows clearing the whole interval structure at once', () => {
    const fields = {
      interval_reps: null, interval_distance: null,
      interval_duration_ms: null, interval_rest_ms: null,
    };
    expect(mergeIntervalPatch(intervalPlan, fields)).toEqual([]);
    // Totals are left alone — the plan keeps its target as a steady session.
    expect(fields.target_distance).toBeUndefined();
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
