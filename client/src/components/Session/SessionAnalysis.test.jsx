import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SessionAnalysis, { compactReadLabel, firstSentence } from './SessionAnalysis.jsx';

const cardStyles = {
  card: 'card',
  cardHeader: 'cardHeader',
  cardTitle: 'cardTitle',
};

describe('firstSentence', () => {
  it('keeps decimal readings intact while removing later sentences', () => {
    expect(firstSentence('Rate averaged 23.3 spm. Pace rose later.'))
      .toBe('Rate averaged 23.3 spm.');
  });

  it('keeps a summary without terminal punctuation', () => {
    expect(firstSentence('A single concise observation')).toBe('A single concise observation');
  });
});

describe('SessionAnalysis compact view', () => {
  it('renders only the four-line coaching summary and ignores plan-review detail', () => {
    const markup = renderToStaticMarkup(
      <SessionAnalysis
        cardStyles={cardStyles}
        narrative={{
          headline: 'Controlled opening',
          summary: 'The opening held steady. Rate rose in the final phase.',
          recommendation: 'Repeat the same start and finish a little earlier.',
          intent: 'steady',
          plan_review: {
            planned: { target_distance: 8000, target_rate: 20, notes: 'Steady aerobic distance.' },
            actual: { pace_ms: 104500, avg_rate: 23.3, dominant_zone: 'z2' },
            assessment: 'Distance was 6 km shorter than prescribed.',
          },
        }}
        analysis={{
          data_quality: {
            reconciled: false,
            issues: [{ field: 'distance', message: 'Distance does not reconcile.' }],
          },
          execution: {
            intensity: { value: 'hard', estimated: true, confidence: 0.9, basis: 'Mostly upper zones.' },
            pacing: { value: 'variable', confidence: 0.9, basis: 'Pace varied.' },
            rate: { value: 'variable', confidence: 0.9, basis: 'Rate varied.' },
          },
        }}
      />,
    );

    expect(markup).toContain('Controlled opening');
    expect(markup).toContain('aria-label="Purpose: Steady"');
    expect(markup).toContain('The opening held steady.');
    expect(markup).not.toContain('Rate rose in the final phase.');
    expect(markup).toContain('Next time:');
    expect(markup).toContain('Likely hard · Variable pacing · Variable rate');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('Distance was 6 km shorter than prescribed.');
    expect(markup).not.toContain('Steady aerobic distance.');
    expect(markup).not.toContain('Data quality');
  });
});

describe('compactReadLabel', () => {
  it('produces short, self-describing labels for the muted read line', () => {
    expect(compactReadLabel('intensity', { value: 'hard', estimated: true })).toBe('Likely hard');
    expect(compactReadLabel('pacing', { value: 'variable', shape: { late_fade: true } }))
      .toBe('Variable pacing');
    expect(compactReadLabel('rate', { value: 'stable_avg_variable_stroke' })).toBe('Variable rate');
    expect(compactReadLabel('hr_drift', { value: 'low', drift_percent: 2.1 })).toBe('Low HR drift');
  });
});
