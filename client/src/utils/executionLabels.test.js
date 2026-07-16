import { describe, expect, it } from 'vitest';
import { execLabel, showsExecution, MIN_SHOW_CONFIDENCE } from './executionLabels.js';

describe('execLabel', () => {
  it('maps execution values to human labels per channel', () => {
    expect(execLabel('intensity', 'very_hard')).toBe('Very hard');
    expect(execLabel('pacing', 'negative_split')).toBe('Negative split');
    expect(execLabel('finish', 'accelerated')).toBe('Accelerated');
    expect(execLabel('rate', 'stable')).toBe('Stable');
    expect(execLabel('rate', 'stable_avg_variable_stroke')).toBe('Stable average, variable stroke-to-stroke');
  });

  it('qualifies effort when the HR zone model was estimated', () => {
    expect(execLabel('intensity', { value: 'moderate', estimated: true })).toBe('Likely moderate');
    expect(execLabel('intensity', { value: 'moderate', estimated: false })).toBe('Moderate');
  });

  it('combines pacing value with the canonical shape flags', () => {
    expect(execLabel('pacing', {
      value: 'even',
      shape: { fast_start: true, even_core: true, late_fade: false, fast_finish: true },
    })).toBe('Even core · fast start and finish');
    expect(execLabel('pacing', {
      value: 'mild_fade',
      shape: { fast_start: false, even_core: false, late_fade: true, fast_finish: false },
    })).toBe('Mild fade · late fade');
  });

  it('includes the measured power-to-HR drift', () => {
    expect(execLabel('hr_drift', { value: 'moderate', drift_percent: 7.8 })).toBe('Moderate · +7.8%');
    expect(execLabel('hr_drift', { value: 'low', drift_percent: -1.2 })).toBe('Low · -1.2%');
    expect(execLabel('hr_drift', { value: 'low', drift_percent: null })).toBe('Low');
  });

  it('returns null for unknown value or channel', () => {
    expect(execLabel('pacing', 'nonsense')).toBeNull();
    expect(execLabel('mystery', 'stable')).toBeNull();
  });
});

describe('showsExecution', () => {
  it('shows a confident, known value', () => {
    expect(showsExecution({ value: 'hard', confidence: 0.7 })).toBe(true);
  });

  it('hides unknown values regardless of confidence', () => {
    expect(showsExecution({ value: 'unknown', confidence: 1 })).toBe(false);
  });

  it('hides values below the confidence floor', () => {
    expect(showsExecution({ value: 'hard', confidence: MIN_SHOW_CONFIDENCE - 0.01 })).toBe(false);
  });

  it('hides null / empty metrics', () => {
    expect(showsExecution(null)).toBe(false);
    expect(showsExecution({})).toBe(false);
  });
});
