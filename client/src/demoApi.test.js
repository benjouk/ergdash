import { describe, expect, it } from 'vitest';
import { applyDemoNarrativeContext } from './demoApi.js';

const workout = (overrides = {}) => ({
  id: 1,
  intent: null,
  distance: 5000,
  time_ms: 1200000,
  pace_ms: 120000,
  stroke_rate: 24,
  metrics: { hr_drift_pct: 7.8 },
  analysis: {
    execution: {
      pacing: { value: 'even', shape: { late_fade: false } },
      rate: { value: 'stable', average_spm: 24 },
      intensity: { dominant_zone: 3 },
      hr_drift: { drift_percent: 7.8 },
    },
  },
  narrative: {
    headline: 'Controlled row',
    summary: 'Held pace.',
    recommendation: 'Stale recommendation.',
    intent: 'steady',
    intent_source: 'workout',
    needs_intent: false,
    plan_review: { assessment: 'Stale plan review.' },
  },
  ...overrides,
});

describe('applyDemoNarrativeContext', () => {
  it('preserves the captured recommendation when intent and plan context are untouched', () => {
    const capturedPlanReview = {
      planned: {
        target_pace_ms: null,
        target_rate: null,
        target_distance: 5000,
        target_duration_ms: null,
        notes: 'Captured purpose',
      },
      actual: { pace_ms: null },
      assessment: 'Captured assessment for a missing actual pace.',
    };
    const session = workout({
      intent: 'hard_distance',
      narrative: {
        headline: 'Finished strongly',
        summary: 'The final rep was fastest.',
        recommendation: 'Captured server recommendation with strong-finish context.',
        intent: 'hard_distance',
        intent_source: 'workout',
        needs_intent: false,
        plan_review: capturedPlanReview,
      },
    });

    const result = applyDemoNarrativeContext(session, {
      type: 'other',
      target_pace_ms: null,
      target_rate: null,
      target_distance: 5000,
      target_duration_ms: null,
      notes: 'Captured purpose',
    });
    expect(result.narrative.recommendation).toBe('Captured server recommendation with strong-finish context.');
    expect(result.narrative.plan_review).toBe(capturedPlanReview);
    expect(result.narrative.plan_review.assessment).toBe('Captured assessment for a missing actual pace.');
  });

  it('restores the unknown-intent prompt after intent is cleared', () => {
    const result = applyDemoNarrativeContext(workout(), null);

    expect(result.narrative).toMatchObject({
      intent: null,
      intent_source: null,
      needs_intent: true,
    });
    expect(result.narrative.recommendation).toContain('If this was steady work');
    expect(result.narrative.plan_review).toBeUndefined();
  });

  it('rebuilds plan intent and review from the current plan overlay', () => {
    const plan = {
      type: 'steady',
      target_distance: 6000,
      target_duration_ms: null,
      target_pace_ms: 122000,
      target_rate: 23,
      notes: 'Aerobic base row',
    };
    const result = applyDemoNarrativeContext(workout(), plan);

    expect(result.narrative).toMatchObject({
      intent: 'steady',
      intent_source: 'plan',
      needs_intent: false,
      plan_review: {
        planned: {
          target_distance: 6000,
          target_pace_ms: 122000,
          target_rate: 23,
          notes: 'Aerobic base row',
        },
        actual: {
          pace_ms: 120000,
          avg_rate: 24,
          dominant_zone: 3,
          hr_drift_pct: 7.8,
        },
      },
    });
    expect(result.narrative.plan_review.assessment).toContain('faster than prescribed');
  });

  it('lets an explicit workout intent override the plan-derived intent', () => {
    const result = applyDemoNarrativeContext(
      workout({ intent: 'test_race' }),
      { type: 'steady', target_distance: 5000 }
    );

    expect(result.narrative).toMatchObject({
      intent: 'test_race',
      intent_source: 'workout',
      needs_intent: false,
    });
    expect(result.narrative.recommendation).toContain('test or race');
  });

  it('uses rep degradation when tailoring an interval recommendation', () => {
    const session = workout({
      intent: 'test_race',
      analysis: {
        structure: { value: 'interval' },
        execution: { pacing: null, rate: { average_spm: 30 } },
        intervals: { first_rep_fast: true, degradation_percent: 2.4 },
      },
    });

    const result = applyDemoNarrativeContext(session, null);
    expect(result.narrative.recommendation).toContain('open slightly slower');
  });

  it('uses data-neutral guidance when an intent changes without pacing analysis', () => {
    const session = workout({
      intent: 'hard_distance',
      analysis: null,
    });

    const result = applyDemoNarrativeContext(session, null);
    expect(result.narrative.recommendation).toContain('establish a sustainable opening pace');
    expect(result.narrative.recommendation).not.toContain('Pacing control suited');
  });
});
