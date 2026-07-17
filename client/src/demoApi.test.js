import { describe, expect, it } from 'vitest';
import { applyDemoNarrativeContext } from './demoApi.js';

const workout = (overrides = {}) => ({
  id: 1,
  distance: 5000,
  time_ms: 1200000,
  pace_ms: 120000,
  stroke_rate: 24,
  metrics: { hr_drift_pct: 7.8 },
  narrative: {
    headline: 'Controlled row',
    summary: 'Held pace.',
    recommendation: 'Captured server recommendation.',
    plan_review: { assessment: 'Legacy plan review.' },
  },
  ...overrides,
});

describe('applyDemoNarrativeContext', () => {
  it('keeps the captured narrative and strips legacy plan-review data', () => {
    const result = applyDemoNarrativeContext(workout(), {
      type: 'steady',
      target_distance: 5000,
      notes: 'Aerobic base row',
    });

    expect(result.narrative.headline).toBe('Controlled row');
    expect(result.narrative.summary).toBe('Held pace.');
    expect(result.narrative.recommendation).toBe('Captured server recommendation.');
    expect(result.narrative.plan_review).toBeUndefined();
    expect(result.plan).toMatchObject({ type: 'steady' });
  });

  it('attaches the plan even when a session has no narrative', () => {
    const { narrative, ...bare } = workout();
    const plan = { type: 'test', target_distance: 5000 };

    const result = applyDemoNarrativeContext(bare, plan);

    expect(result.narrative).toBeUndefined();
    expect(result.plan).toBe(plan);
  });

  it('does not mutate the captured narrative object', () => {
    const session = workout();
    applyDemoNarrativeContext(session, null);

    // The strip happens on a copy; the source fixture stays intact.
    expect(session.narrative.plan_review).toEqual({ assessment: 'Legacy plan review.' });
  });
});
