import { describe, it, expect } from 'vitest';
import { scorePlanMatch, pickBestMatch, workoutDay } from '../src/planMatching.js';

function plan(overrides = {}) {
  return {
    id: 1,
    date: '2026-07-07',
    type: 'steady',
    target_distance: 10000,
    target_duration_ms: null,
    status: 'planned',
    completed_workout_id: null,
    ...overrides,
  };
}

function workout(overrides = {}) {
  return {
    id: 100,
    date: '2026-07-07T06:30:00Z',
    distance: 10000,
    time_ms: 2400000,
    inferred_tag: 'endurance',
    ...overrides,
  };
}

describe('workoutDay', () => {
  it('truncates ISO datetimes to the calendar day', () => {
    expect(workoutDay(workout())).toBe('2026-07-07');
  });
});

describe('scorePlanMatch', () => {
  it('matches an exact distance', () => {
    expect(scorePlanMatch(plan(), workout())).toBeGreaterThan(1);
  });

  it('accepts distances within 20% tolerance', () => {
    expect(scorePlanMatch(plan(), workout({ distance: 8000 }))).not.toBeNull();
    expect(scorePlanMatch(plan(), workout({ distance: 12000 }))).not.toBeNull();
  });

  it('rejects distances outside the tolerance', () => {
    expect(scorePlanMatch(plan(), workout({ distance: 5000 }))).toBeNull();
    expect(scorePlanMatch(plan(), workout({ distance: 21097 }))).toBeNull();
  });

  it('matches duration-only plans against time_ms', () => {
    const p = plan({ target_distance: null, target_duration_ms: 3600000 });
    expect(scorePlanMatch(p, workout({ time_ms: 3500000 }))).not.toBeNull();
    expect(scorePlanMatch(p, workout({ time_ms: 1800000 }))).toBeNull();
  });

  it('falls back to a floor score for the only plan of the day', () => {
    const p = plan({ target_distance: 5000 });
    const w = workout({ distance: 12000 });
    expect(scorePlanMatch(p, w)).toBeNull();
    const floor = scorePlanMatch(p, w, { onlyPlanOfDay: true });
    expect(floor).not.toBeNull();
    expect(floor).toBeLessThan(0.5);
  });

  it('gives a bonus when plan type and inferred tag agree', () => {
    const steadyScore = scorePlanMatch(plan(), workout());
    const mismatched = scorePlanMatch(plan({ type: 'intervals' }), workout());
    expect(steadyScore).toBeGreaterThan(mismatched);

    const intervalPlan = plan({ type: 'intervals', target_distance: 4000 });
    const intervalWorkout = workout({ distance: 4000, inferred_tag: 'interval' });
    const agree = scorePlanMatch(intervalPlan, intervalWorkout);
    const disagree = scorePlanMatch(plan({ target_distance: 4000 }), intervalWorkout);
    expect(agree).toBeGreaterThan(disagree);
  });
});

describe('pickBestMatch', () => {
  it('requires the same calendar day', () => {
    const plans = [plan({ date: '2026-07-06' }), plan({ id: 2, date: '2026-07-08' })];
    expect(pickBestMatch(plans, workout())).toBeNull();
  });

  it('picks the closest of several same-day candidates', () => {
    const plans = [
      plan({ id: 1, target_distance: 9000 }),
      plan({ id: 2, target_distance: 10000 }),
      plan({ id: 3, target_distance: 11500 }),
    ];
    expect(pickBestMatch(plans, workout()).id).toBe(2);
  });

  it('never matches completed, skipped, or already-linked plans', () => {
    const plans = [
      plan({ id: 1, status: 'completed', completed_workout_id: 99 }),
      plan({ id: 2, status: 'skipped' }),
      plan({ id: 3, completed_workout_id: 98 }),
    ];
    expect(pickBestMatch(plans, workout())).toBeNull();
  });

  it('uses the floor rule only when a single plan is eligible', () => {
    const lonely = [plan({ target_distance: 5000 })];
    expect(pickBestMatch(lonely, workout({ distance: 12000 }))).not.toBeNull();

    const crowded = [
      plan({ id: 1, target_distance: 5000 }),
      plan({ id: 2, target_distance: 4000 }),
    ];
    expect(pickBestMatch(crowded, workout({ distance: 12000 }))).toBeNull();
  });
});
