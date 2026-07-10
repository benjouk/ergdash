import { describe, it, expect } from 'vitest';
import {
  planSummary, formFromPlan, formToPayload, EMPTY_FORM,
  dominantAdherence, weekTotals,
} from './planFormat.js';

// Simple metric formatter stand-in (matches useUnits().formatDistance shape).
const fmtDist = (m) => (m % 1000 === 0 ? `${m / 1000}km` : `${m}m`);

describe('planSummary', () => {
  it('summarises a distance-rep interval plan', () => {
    const plan = { interval_reps: 4, interval_distance: 2000, interval_rest_ms: 300000 };
    expect(planSummary(plan, fmtDist)).toBe('4×2km / 5:00r');
  });

  it('summarises a time-rep interval plan without rest', () => {
    const plan = { interval_reps: 4, interval_duration_ms: 600000, interval_rest_ms: null };
    expect(planSummary(plan, fmtDist)).toBe('4×10:00');
  });

  it('falls back to distance, then duration, then type', () => {
    expect(planSummary({ target_distance: 10000 }, fmtDist)).toBe('10km');
    expect(planSummary({ target_duration_ms: 1800000 }, fmtDist)).toBe('30:00');
    expect(planSummary({ type: 'other' }, fmtDist)).toBe('other');
  });
});

describe('dominantAdherence', () => {
  it('passes a single plan through', () => {
    expect(dominantAdherence([{ adherence: 'completed' }])).toBe('completed');
    expect(dominantAdherence([{ adherence: 'skipped' }])).toBe('skipped');
  });

  it('lets missed outrank completed', () => {
    expect(dominantAdherence([
      { adherence: 'completed' }, { adherence: 'missed' },
    ])).toBe('missed');
  });

  it('lets planned outrank skipped and completed', () => {
    expect(dominantAdherence([
      { adherence: 'skipped' }, { adherence: 'planned' }, { adherence: 'completed' },
    ])).toBe('planned');
  });

  it('returns null for an empty day', () => {
    expect(dominantAdherence([])).toBeNull();
  });
});

describe('weekTotals', () => {
  it('sums sessions and meters across a mixed week', () => {
    const days = ['2026-07-06', '2026-07-07', '2026-07-08'];
    const plansByDay = new Map([
      ['2026-07-06', [
        { adherence: 'completed', target_distance: 8000 },
        { adherence: 'skipped', target_distance: 2000 },
      ]],
      ['2026-07-08', [{ adherence: 'planned', target_distance: 10000 }]],
    ]);
    const metersByDay = { map: new Map([['2026-07-06', { meters: 8200 }]]) };
    expect(weekTotals(days, plansByDay, metersByDay)).toEqual({
      plannedMeters: 20000, rowedMeters: 8200, sessionsTotal: 3, sessionsDone: 1,
    });
  });

  it('handles a week of rest days', () => {
    const days = ['2026-07-06', '2026-07-07'];
    expect(weekTotals(days, new Map(), { map: new Map() })).toEqual({
      plannedMeters: 0, rowedMeters: 0, sessionsTotal: 0, sessionsDone: 0,
    });
  });
});

describe('formToPayload', () => {
  it('builds a steady payload and clears interval fields', () => {
    const { payload, error } = formToPayload({ ...EMPTY_FORM, type: 'steady', distance: '10000' });
    expect(error).toBeNull();
    expect(payload.target_distance).toBe(10000);
    expect(payload.interval_reps).toBeNull();
    // Steady payloads must not carry a leftover total the server would keep.
    expect(payload.target_duration_ms).toBeNull();
  });

  it('parses a duration target', () => {
    const { payload } = formToPayload({ ...EMPTY_FORM, type: 'steady', duration: '30:00' });
    expect(payload.target_duration_ms).toBe(1800000);
  });

  it('omits interval totals so the server derives them', () => {
    const { payload, error } = formToPayload({
      ...EMPTY_FORM, type: 'intervals', reps: '4', repDistance: '2000', rest: '5:00',
    });
    expect(error).toBeNull();
    expect(payload.interval_reps).toBe(4);
    expect(payload.interval_distance).toBe(2000);
    expect(payload.interval_rest_ms).toBe(300000);
    // Critical: totals are absent (not null) so PATCH recomputes them.
    expect('target_distance' in payload).toBe(false);
    expect('target_duration_ms' in payload).toBe(false);
  });

  it('rejects intervals without work', () => {
    const { error } = formToPayload({ ...EMPTY_FORM, type: 'intervals', reps: '4' });
    expect(error).toMatch(/rep distance or rep time/);
  });

  it('rejects a steady session with no target', () => {
    const { error } = formToPayload({ ...EMPTY_FORM, type: 'steady' });
    expect(error).toMatch(/target distance or duration/);
  });

  it('parses pace and rate', () => {
    const { payload } = formToPayload({
      ...EMPTY_FORM, type: 'steady', distance: '5000', pace: '2:02', rate: '22',
    });
    expect(payload.target_pace_ms).toBe(122000);
    expect(payload.target_rate).toBe(22);
  });
});

describe('formFromPlan round-trips', () => {
  it('rebuilds an interval form that re-serialises to the same spec', () => {
    const plan = {
      type: 'intervals', interval_reps: 5, interval_distance: 1500,
      interval_duration_ms: null, interval_rest_ms: 300000,
      target_distance: 7500, target_duration_ms: null,
      target_pace_ms: null, target_rate: 24, notes: 'endurance',
    };
    const { payload } = formToPayload(formFromPlan(plan));
    expect(payload.interval_reps).toBe(5);
    expect(payload.interval_distance).toBe(1500);
    expect(payload.interval_rest_ms).toBe(300000);
    expect(payload.target_rate).toBe(24);
    expect(payload.notes).toBe('endurance');
  });

  it('rebuilds a steady form', () => {
    const plan = {
      type: 'steady', target_distance: 10000, target_duration_ms: null,
      interval_reps: null, target_pace_ms: null, target_rate: null, notes: null,
    };
    const { payload } = formToPayload(formFromPlan(plan));
    expect(payload.target_distance).toBe(10000);
    expect(payload.notes).toBeNull();
  });
});
