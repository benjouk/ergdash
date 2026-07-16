import { describe, expect, it } from 'vitest';
import {
  WORKOUT_INTENTS,
  buildSessionNarrative,
  isWorkoutIntent,
  resolveWorkoutIntent,
} from '../src/sessionNarrative.js';

function continuousAnalysis(overrides = {}) {
  return {
    structure: { value: 'continuous' },
    execution: {
      pacing: {
        value: 'even',
        shape: {
          fast_start: true,
          even_core: true,
          late_fade: false,
          fast_finish: true,
        },
      },
      finish: { value: 'accelerated' },
      rate: {
        value: 'stable_avg_variable_stroke',
        average_spm: 23.5,
        variation_spm: 2.2,
      },
      intensity: { value: 'moderate', dominant_zone: 3 },
      hr_drift: { value: 'moderate', drift_percent: 7.8 },
      ...overrides.execution,
    },
    phases: [
      { name: 'start', avg_pace_ms: 117000 },
      { name: 'middle', avg_pace_ms: 120000 },
      { name: 'late', avg_pace_ms: 120200 },
    ],
    intervals: null,
    ...overrides,
  };
}

function workout(overrides = {}) {
  return {
    distance: 10000,
    time_ms: 2400000,
    pace_ms: 120000,
    stroke_rate: 24,
    heart_rate_avg: 150,
    inferred_tag: 'endurance',
    metrics: { hr_drift_pct: 7.8 },
    ...overrides,
  };
}

describe('workout intent resolution', () => {
  it('accepts only the five API intent values', () => {
    expect(WORKOUT_INTENTS).toEqual([
      'steady', 'hard_distance', 'test_race', 'recovery', 'technique',
    ]);
    for (const intent of WORKOUT_INTENTS) expect(isWorkoutIntent(intent)).toBe(true);
    expect(isWorkoutIntent('tempo')).toBe(false);
    expect(isWorkoutIntent(null)).toBe(false);
  });

  it('prefers explicit intent, then maps only unambiguous plan types', () => {
    expect(resolveWorkoutIntent({ intent: 'technique' }, { type: 'race' })).toEqual({
      intent: 'technique', intent_source: 'workout',
    });
    expect(resolveWorkoutIntent({}, { type: 'steady' })).toEqual({
      intent: 'steady', intent_source: 'plan',
    });
    expect(resolveWorkoutIntent({}, { type: 'test' })).toEqual({
      intent: 'test_race', intent_source: 'plan',
    });
    expect(resolveWorkoutIntent({}, { type: 'race' })).toEqual({
      intent: 'test_race', intent_source: 'plan',
    });
    expect(resolveWorkoutIntent({}, { type: 'intervals' })).toEqual({
      intent: null, intent_source: null,
    });
  });
});

describe('buildSessionNarrative', () => {
  it('composes a specific continuous summary and intent-aware recommendation', () => {
    const result = buildSessionNarrative({
      workout: workout({ intent: 'steady' }),
      analysis: continuousAnalysis(),
      baseline: { medianPaceMs: 122000, medianHr: 155 },
    });

    expect(result).toMatchObject({
      headline: 'Controlled middle with a strong finish',
      intent: 'steady',
      intent_source: 'workout',
      needs_intent: false,
    });
    // Two sentences: the pacing story, then the single most useful supporting
    // read (notable drift wins over the vs-typical and rate reads here).
    expect(result.summary).toContain('opening was 3.0 s/500m quicker');
    expect(result.summary).toContain('pace held even through the core');
    expect(result.summary).toContain('the finish accelerated');
    expect(result.summary).toContain('declined by 7.8%');
    expect(result.summary).not.toContain('typical endurance session');
    expect(result.summary.split('. ').length).toBeLessThanOrEqual(2);
    expect(result.recommendation).toContain('For steady work');
    expect(result.recommendation).toContain('opening slightly slower');
    expect(JSON.stringify(result)).not.toContain('—');
  });

  it('does not apply an incompatible plan rate to an explicit workout intent', () => {
    const result = buildSessionNarrative({
      workout: workout({ intent: 'recovery' }),
      analysis: continuousAnalysis({
        execution: {
          rate: { value: 'stable', average_spm: 18, variation_spm: 0.8 },
          intensity: { value: 'easy', dominant_zone: 1 },
        },
      }),
      plan: { type: 'race', target_rate: 36 },
    });

    expect(result.recommendation).toBe(
      'For recovery work, keep the pressure light and the stroke rhythm relaxed around 18 spm.',
    );
    expect(result.recommendation).not.toContain('36 spm');
  });

  it('keeps a plan rate when intent is plan-derived or explicitly compatible', () => {
    const explicitResult = buildSessionNarrative({
      workout: workout({ intent: 'steady' }),
      analysis: continuousAnalysis({
        execution: {
          rate: { value: 'stable', average_spm: 18, variation_spm: 0.8 },
        },
      }),
      plan: { type: 'steady', target_rate: 22 },
    });
    const planDerivedResult = buildSessionNarrative({
      workout: workout(),
      analysis: continuousAnalysis({
        execution: {
          rate: { value: 'stable', average_spm: 18, variation_spm: 0.8 },
        },
      }),
      plan: { type: 'steady', target_rate: 22 },
    });

    expect(explicitResult.recommendation).toContain('around 22 spm');
    expect(planDerivedResult.recommendation).toContain('around 22 spm');
  });

  it('returns both recommendation branches and requests intent when purpose is unknown', () => {
    const result = buildSessionNarrative({
      workout: workout(),
      analysis: continuousAnalysis(),
    });

    expect(result.intent).toBeNull();
    expect(result.intent_source).toBeNull();
    expect(result.needs_intent).toBe(true);
    expect(result.recommendation).toContain('If this was steady work');
    expect(result.recommendation).toContain('If it was a hard effort');
  });

  it('uses the rep analysis for interval sessions', () => {
    const result = buildSessionNarrative({
      workout: workout({
        inferred_tag: 'interval',
        interval_summary: '5×1k / 3:00r',
        intent: 'hard_distance',
      }),
      analysis: {
        structure: { value: 'interval' },
        execution: {
          pacing: null,
          finish: null,
          rate: { value: 'stable', average_spm: 29.2, variation_spm: 1.1 },
          hr_drift: { value: 'unknown', drift_percent: null },
        },
        phases: [],
        intervals: {
          rep_count: 5,
          fastest_rep_index: 4,
          fastest_pace_ms: 105000,
          final_rep_pace_ms: 105000,
          spread_percent: 1.6,
          degradation_percent: -1.2,
          first_rep_fast: false,
        },
      },
    });

    expect(result.headline).toBe('Finished the set with your fastest rep');
    expect(result.summary).toContain('Across 5 work reps');
    expect(result.summary).toContain('rep 5 fastest at 1:45.0/500m');
    expect(result.summary).not.toContain('opening');
  });

  it('does not call the final rep strongest when a middle rep was fastest', () => {
    const result = buildSessionNarrative({
      workout: workout({ inferred_tag: 'interval', intent: 'hard_distance' }),
      analysis: {
        structure: { value: 'interval' },
        execution: { rate: { value: 'stable', average_spm: 30 } },
        phases: [],
        intervals: {
          // Rep paces: 2:00, 1:40, 1:58. The final rep improved on the first,
          // but rep two was still the strongest work in the set.
          rep_count: 3,
          fastest_rep_index: 1,
          fastest_pace_ms: 100000,
          final_rep_pace_ms: 118000,
          spread_percent: 20,
          degradation_percent: -1.7,
          first_rep_fast: false,
        },
      },
    });

    expect(result.headline).toBe('Final rep was quicker than the first');
    expect(result.summary).toContain('rep 2 fastest at 1:40.0/500m');
    expect(result.recommendation).toContain('fastest work came earlier');
    expect(result.recommendation).not.toContain('finished the set strongly');
    expect(result.headline).not.toContain('strongest');
  });

  it('does not praise pacing control when an interval set faded after a fast first rep', () => {
    const result = buildSessionNarrative({
      workout: workout({ inferred_tag: 'interval', intent: 'hard_distance' }),
      analysis: {
        structure: { value: 'interval' },
        execution: { rate: { value: 'stable', average_spm: 28 } },
        phases: [],
        intervals: {
          rep_count: 5,
          spread_percent: 7,
          degradation_percent: 8,
          first_rep_fast: true,
        },
      },
    });

    expect(result.headline).toBe('Fast start, then a fade across the set');
    expect(result.recommendation).toContain('hold back on the first rep');
    expect(result.recommendation).not.toContain('Pacing control suited');
  });

  it('falls back safely when a legacy session has no stored analysis', () => {
    const result = buildSessionNarrative({
      workout: workout({ analysis: null, intent: 'hard_distance' }),
    });
    expect(result.headline).toBe('10 km session complete');
    expect(result.summary).toContain('10 km');
    expect(result.needs_intent).toBe(false);
    expect(result.recommendation).toContain('establish a sustainable opening pace');
    expect(result.recommendation).not.toContain('Pacing control suited');
  });

  it('carries pace rounding into the next minute', () => {
    const result = buildSessionNarrative({
      workout: workout({ pace_ms: 119999, analysis: null, intent: 'hard_distance' }),
    });

    expect(result.summary).toContain('2:00.0/500m');
    expect(result.summary).not.toContain('1:60.0/500m');
  });
});
