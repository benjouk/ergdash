import { describe, expect, it } from 'vitest';
import { execLabel, showsExecution, MIN_SHOW_CONFIDENCE } from './executionLabels.js';

describe('execLabel', () => {
  it('maps execution values to human labels per channel', () => {
    expect(execLabel('intensity', 'very_hard')).toBe('Very hard');
    expect(execLabel('pacing', 'negative_split')).toBe('Negative split');
    expect(execLabel('finish', 'accelerated')).toBe('Accelerated');
    expect(execLabel('rate', 'stable')).toBe('Stable');
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
