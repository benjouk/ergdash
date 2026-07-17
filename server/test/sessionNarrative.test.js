import { describe, expect, it } from 'vitest';
import { buildSessionNarrative } from '../src/sessionNarrative.js';

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

describe('buildSessionNarrative', () => {
  it('composes a specific continuous summary and observation-based recommendation', () => {
    const result = buildSessionNarrative({
      workout: workout(),
      analysis: continuousAnalysis(),
      baseline: { medianPaceMs: 122000, medianHr: 155 },
    });

    expect(result.headline).toBe('Controlled middle with a strong finish');
    // The narrative no longer carries any declared-intent fields.
    expect(result).not.toHaveProperty('intent');
    expect(result).not.toHaveProperty('intent_source');
    expect(result).not.toHaveProperty('needs_intent');
    // Two sentences: the pacing story, then the single most useful supporting
    // read (notable drift wins over the vs-typical and rate reads here).
    expect(result.summary).toContain('opening was 3.0 s/500m quicker');
    expect(result.summary).toContain('pace held even through the core');
    expect(result.summary).toContain('the finish accelerated');
    expect(result.summary).toContain('declined by 7.8%');
    expect(result.summary).not.toContain('typical endurance session');
    expect(result.summary.split('. ').length).toBeLessThanOrEqual(2);
    // A long piece (10 km) with a 7.8% power-to-HR decline is coached on the
    // drift, not the finishing kick.
    expect(result.recommendation).toContain('better coupled through the back half');
    expect(JSON.stringify(result)).not.toContain('—');
  });

  it('tailors the strong-finish line to the pacing shape on a short piece', () => {
    const uShape = buildSessionNarrative({
      workout: workout({ distance: 2000, time_ms: 470000 }),
      analysis: continuousAnalysis({
        execution: {
          pacing: { value: 'even', shape: { fast_start: true, even_core: true, fast_finish: true } },
          finish: { value: 'accelerated' },
          rate: { value: 'stable', average_spm: 25 },
          intensity: { value: 'moderate' },
          hr_drift: { value: 'low', drift_percent: 1 },
        },
      }),
    });
    expect(uShape.recommendation).toContain('went out quick and still finished strong');

    const built = buildSessionNarrative({
      workout: workout({ distance: 2000, time_ms: 470000 }),
      analysis: continuousAnalysis({
        execution: {
          pacing: { value: 'negative_split', shape: { fast_finish: true } },
          finish: { value: 'accelerated' },
          rate: { value: 'stable', average_spm: 25 },
          intensity: { value: 'moderate' },
          hr_drift: { value: 'low', drift_percent: 1 },
        },
      }),
    });
    expect(built.recommendation).toContain('built through the piece and still lifted the finish');
  });

  it('drops the vs-typical pace line for a hard effort against easy endurance', () => {
    const result = buildSessionNarrative({
      workout: workout({ pace_ms: 104000, heart_rate_avg: 178 }),
      analysis: continuousAnalysis({
        execution: {
          pacing: { value: 'even', shape: { even_core: true } },
          finish: { value: 'even' },
          rate: { value: 'stable', average_spm: 32, variation_spm: 1 },
          intensity: { value: 'maximal', dominant_zone: 5 },
          hr_drift: { value: 'unknown', drift_percent: null },
        },
      }),
      baseline: { medianPaceMs: 120000, medianHr: 150 },
    });

    // 16 s/500m faster than the endurance median is not a comparable session.
    expect(result.summary).not.toContain('faster than your typical');
  });

  it('leads with the fade only when the piece did not finish strong', () => {
    const faded = buildSessionNarrative({
      workout: workout(),
      analysis: continuousAnalysis({
        execution: {
          pacing: { value: 'mild_fade', shape: { fast_start: true, late_fade: true } },
          finish: { value: 'faded' },
          rate: { value: 'stable', average_spm: 24 },
          intensity: { value: 'hard' },
          hr_drift: { value: 'low', drift_percent: 1 },
        },
      }),
    });
    expect(faded.headline).toBe('Faded through the back half');
    expect(faded.recommendation).toContain('holding back a little at the start');

    const recovered = buildSessionNarrative({
      workout: workout(),
      analysis: continuousAnalysis({
        execution: {
          pacing: { value: 'even', shape: { fast_start: true, late_fade: true, fast_finish: true } },
          finish: { value: 'accelerated' },
          rate: { value: 'stable', average_spm: 32 },
          intensity: { value: 'hard' },
          hr_drift: { value: 'low', drift_percent: 1 },
        },
      }),
    });
    // A late dip that ends in a kick is not a fade.
    expect(recovered.headline).not.toBe('Faded through the back half');
    expect(recovered.headline).toBe('Strong finish after a steady middle');
  });

  it('uses the rep analysis for interval sessions', () => {
    const result = buildSessionNarrative({
      workout: workout({
        inferred_tag: 'interval',
        interval_summary: '5×1k / 3:00r',
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
    expect(result.recommendation).toContain('finished on your fastest rep');
  });

  it('does not call the final rep strongest when a middle rep was fastest', () => {
    const result = buildSessionNarrative({
      workout: workout({ inferred_tag: 'interval' }),
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
    expect(result.recommendation).not.toContain('finished on your fastest rep');
    expect(result.headline).not.toContain('strongest');
  });

  it('flags a fast first rep that faded across the set', () => {
    const result = buildSessionNarrative({
      workout: workout({ inferred_tag: 'interval' }),
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
    expect(result.recommendation).toContain('a more even opening rep');
  });

  it('falls back safely when a legacy session has no stored analysis', () => {
    const result = buildSessionNarrative({
      workout: workout({ analysis: null, metrics: {} }),
    });
    expect(result.headline).toBe('10 km session complete');
    expect(result.summary).toContain('10 km');
    expect(result.recommendation).toContain('A controlled row');
  });

  it('carries pace rounding into the next minute', () => {
    const result = buildSessionNarrative({
      workout: workout({ pace_ms: 119999, analysis: null }),
    });

    expect(result.summary).toContain('2:00.0/500m');
    expect(result.summary).not.toContain('1:60.0/500m');
  });
});
