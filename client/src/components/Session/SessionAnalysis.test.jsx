import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SessionAnalysis, { compactReadLabel, dataQualityNotice } from './SessionAnalysis.jsx';

const cardStyles = {
  card: 'card',
  cardHeader: 'cardHeader',
  cardTitle: 'cardTitle',
};

describe('SessionAnalysis compact view', () => {
  it('renders the full coaching summary and ignores plan-review detail', () => {
    const markup = renderToStaticMarkup(
      <SessionAnalysis
        cardStyles={cardStyles}
        narrative={{
          headline: 'Controlled opening',
          summary: 'The opening held steady. Rate rose in the final phase.',
          recommendation: 'Repeat the same start and finish a little earlier.',
          plan_review: {
            planned: { target_distance: 8000, target_rate: 20, notes: 'Steady aerobic distance.' },
            actual: { pace_ms: 104500, avg_rate: 23.3, dominant_zone: 'z2' },
            assessment: 'Distance was 6 km shorter than prescribed.',
          },
        }}
        analysis={{
          data_quality: { reconciled: true, issues: [] },
          execution: {
            intensity: { value: 'hard', estimated: true, confidence: 0.9, basis: 'Mostly upper zones.' },
            pacing: { value: 'variable', confidence: 0.9, basis: 'Pace varied.' },
            rate: { value: 'variable', confidence: 0.9, basis: 'Rate varied.' },
          },
        }}
      />,
    );

    expect(markup).toContain('Controlled opening');
    // The declared-purpose surface is gone.
    expect(markup).not.toContain('Purpose:');
    // The server owns summary length now; the client renders it verbatim.
    expect(markup).toContain('The opening held steady. Rate rose in the final phase.');
    expect(markup).toContain('Next time:');
    // Reads render as labelled pills, not a single ·-joined line.
    expect(markup).toContain('Effort');
    expect(markup).toContain('likely hard');
    expect(markup).toContain('Pacing');
    expect(markup.indexOf('likely hard')).toBeLessThan(markup.indexOf('Next time:'));
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('Distance was 6 km shorter than prescribed.');
    expect(markup).not.toContain('Steady aerobic distance.');
    expect(markup).not.toContain('Data quality');
  });

  it('shows a single caution line when the summary does not reconcile', () => {
    const markup = renderToStaticMarkup(
      <SessionAnalysis
        cardStyles={cardStyles}
        narrative={{ headline: 'Session complete', summary: 'A row.' }}
        analysis={{
          data_quality: {
            reconciled: false,
            issues: [{ field: 'time_ms', message: 'Durations differ.' }],
          },
          execution: {},
        }}
      />,
    );

    expect(markup).toContain('do not fully reconcile');
    // The per-field detail stays out of the card.
    expect(markup).not.toContain('Durations differ.');
  });

  it('describes the analysis window instead of a caution when the piece was located', () => {
    const markup = renderToStaticMarkup(
      <SessionAnalysis
        cardStyles={cardStyles}
        narrative={{ headline: 'Even from start to finish', summary: 'A row.' }}
        analysis={{
          data_quality: { reconciled: false, issues: [{ field: 'time_ms', message: 'Durations differ.' }] },
          analysis_window: {
            start_distance_m: 1000,
            end_distance_m: 3000,
            stream_distance_m: 4000,
          },
          execution: {},
        }}
      />,
    );

    expect(markup).toContain('reads the 2,000m stretch');
    expect(markup).not.toContain('do not fully reconcile');
  });

  it('adds a caution when the located scored piece itself does not reconcile', () => {
    const markup = renderToStaticMarkup(
      <SessionAnalysis
        cardStyles={cardStyles}
        narrative={{ headline: 'Even from start to finish', summary: 'A row.' }}
        analysis={{
          data_quality: {
            reconciled: false,
            issues: [{ field: 'time_ms', message: 'The full recording is longer.' }],
            scored_piece: {
              reconciled: false,
              issues: [{ field: 'heart_rate_avg', message: 'Piece HR differs.' }],
            },
          },
          analysis_window: {
            start_distance_m: 1000,
            end_distance_m: 3000,
            stream_distance_m: 4000,
          },
          execution: {},
        }}
      />,
    );

    expect(markup).toContain('reads the 2,000m stretch');
    expect(markup).toContain('scored-piece summary and stroke data do not fully reconcile');
    expect(markup).not.toContain('Piece HR differs.');
  });
});

describe('dataQualityNotice', () => {
  it('is quiet for reconciled sessions', () => {
    expect(dataQualityNotice({ data_quality: { reconciled: true, issues: [] } })).toBeNull();
    expect(dataQualityNotice(null)).toBeNull();
  });
});

describe('compactReadLabel', () => {
  it('produces short, self-describing labels for the muted read line', () => {
    expect(compactReadLabel('intensity', { value: 'hard', estimated: true })).toBe('Effort: likely hard');
    expect(compactReadLabel('pacing', { value: 'variable', shape: { late_fade: true } }))
      .toBe('Pacing: variable · late fade');
    expect(compactReadLabel('pacing', { value: 'even', shape: { late_fade: true } }))
      .toBe('Pacing: even overall · late fade');
    expect(compactReadLabel('rate', { value: 'stable_avg_variable_stroke' }))
      .toBe('Rate: variable stroke-to-stroke');
    expect(compactReadLabel('hr_drift', { value: 'low', drift_percent: 2.1 }))
      .toBe('HR drift: low (+2.1%)');
    expect(compactReadLabel('hr_drift', { value: 'moderate' })).toBe('HR drift: moderate');
  });

  it('does not call a U-shaped piece "even" when both ends were quick', () => {
    // "Even overall · fast start and finish" is self-contradictory; the shape
    // carries the label instead.
    expect(compactReadLabel('pacing', { value: 'even', shape: { fast_start: true, fast_finish: true } }))
      .toBe('Pacing: fast start and finish');
    expect(compactReadLabel('pacing', { value: 'even', shape: { fast_start: true, fast_finish: true, late_fade: true } }))
      .toBe('Pacing: fast start and finish · late fade');
  });
});
