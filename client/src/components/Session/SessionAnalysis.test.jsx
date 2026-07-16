import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SessionAnalysis, { firstSentence } from './SessionAnalysis.jsx';

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
  it('renders a concise coaching summary with collapsible plan detail and four reads', () => {
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
            intensity: { value: 'hard', confidence: 0.9, basis: 'Mostly upper zones.' },
            pacing: { value: 'even', confidence: 0.9, basis: 'The core pace was even.' },
            rate: { value: 'stable', confidence: 0.9, basis: 'Rate stayed stable.' },
            hr_drift: { value: 'low', confidence: 0.9, basis: 'Drift stayed low.' },
          },
        }}
      />,
    );

    expect(markup).toContain('Controlled opening');
    expect(markup).toContain('aria-label="Purpose: Steady"');
    expect(markup).toContain('The opening held steady.');
    expect(markup).not.toContain('Rate rose in the final phase.');
    expect(markup).toContain('<details');
    expect(markup).toContain('<summary');
    expect(markup).toContain('Distance was 6 km shorter than prescribed.');
    expect(markup).toContain('Steady aerobic distance.');
    expect(markup).toContain('Data quality');
    expect(markup).toContain('Observed effort');
    expect(markup).toContain('Pacing');
    expect(markup).toContain('Rate');
    expect(markup).toContain('HR drift');
  });
});
