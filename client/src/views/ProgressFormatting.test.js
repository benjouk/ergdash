import { describe, expect, it } from 'vitest';
import { formatSignal } from './ProgressOverview.jsx';
import { formatTechniqueValue } from './ProgressTechnique.jsx';

const formatPace = value => `${(value / 1000).toFixed(1)}s`;

describe('Progress signal formatting', () => {
  it('uses honest unavailable copy instead of inventing comparisons', () => {
    expect(formatSignal('fitness', { value: 34.4, delta_7d: null }, formatPace)).toEqual({
      value: '34.4', delta: 'No 7-day comparison', tone: 'neutral',
    });
    expect(formatSignal('pace', null, formatPace)).toEqual({
      value: '—', delta: 'Unavailable', tone: 'neutral',
    });
  });

  it('describes lower steady pace as faster and positive', () => {
    expect(formatSignal('pace', {
      value_ms: 116000, delta_ms: -2500,
    }, formatPace)).toEqual({
      value: '116.0s', delta: '2.5s faster', tone: 'positive',
    });
  });
});

describe('Technique scorecard formatting', () => {
  it('formats available and unavailable readings clearly', () => {
    expect(formatTechniqueValue('efficiency', { available: true, value: 1.534 })).toBe('1.53 w/beat');
    expect(formatTechniqueValue('stroke_quality', {
      available: true, value: 96.2, secondaryValue: 91.4,
    })).toBe('96 / 91');
    expect(formatTechniqueValue('dps', { available: false })).toBe('Need more data');
  });
});
