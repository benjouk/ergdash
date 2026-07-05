import { describe, it, expect } from 'vitest';
import { buildWeeklyInsights, buildWorkoutInsight } from '../src/insights.js';

function byId(insights) {
  return Object.fromEntries(insights.map(i => [i.id, i]));
}

describe('buildWeeklyInsights', () => {
  it('flags an idle week when nothing was rowed', () => {
    const out = buildWeeklyInsights({ weeklyMeters: 0, sessionsThisWeek: 0 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'volume', kind: 'watch' });
  });

  it('calls a volume build positive and reports the percentage', () => {
    const out = byId(buildWeeklyInsights({
      weeklyMeters: 44000, prevWeeklyMeters: 40000, sessionsThisWeek: 4,
    }));
    expect(out.volume.kind).toBe('positive');
    expect(out.volume.text).toContain('10%');
    expect(out.volume.text).toContain('44.0 km');
  });

  it('flags a big volume drop as watch', () => {
    const out = byId(buildWeeklyInsights({ weeklyMeters: 20000, prevWeeklyMeters: 40000 }));
    expect(out.volume.kind).toBe('watch');
    expect(out.volume.text).toContain('50%');
  });

  it('treats a small change as neutral', () => {
    const out = byId(buildWeeklyInsights({ weeklyMeters: 41000, prevWeeklyMeters: 40000 }));
    expect(out.volume.kind).toBe('neutral');
  });

  it('reports faster endurance pace as an improvement (lower pace_ms is faster)', () => {
    const out = byId(buildWeeklyInsights({
      weeklyMeters: 40000, prevWeeklyMeters: 40000,
      recentEndurancePaceMs: 118000, priorEndurancePaceMs: 120000,
    }));
    expect(out.pace.kind).toBe('positive');
    expect(out.pace.text).toContain('2.0 s/500m');
  });

  it('flags slower endurance pace', () => {
    const out = byId(buildWeeklyInsights({
      weeklyMeters: 40000, prevWeeklyMeters: 40000,
      recentEndurancePaceMs: 123000, priorEndurancePaceMs: 120000,
    }));
    expect(out.pace.kind).toBe('watch');
  });

  it('reads fresh form as a testing window and tired form as a warning', () => {
    const fresh = byId(buildWeeklyInsights({ weeklyMeters: 40000, prevWeeklyMeters: 40000, form: 6, fitness: 50, fatigue: 44 }));
    expect(fresh.form.kind).toBe('positive');
    const tired = byId(buildWeeklyInsights({ weeklyMeters: 40000, prevWeeklyMeters: 40000, form: -12 }));
    expect(tired.form.kind).toBe('watch');
  });

  it('surfaces a fitness build and a multi-week streak', () => {
    const out = byId(buildWeeklyInsights({
      weeklyMeters: 40000, prevWeeklyMeters: 40000,
      fitnessDelta7d: 2.3, streakWeeks: 5,
    }));
    expect(out.fitness.kind).toBe('positive');
    expect(out.fitness.text).toContain('+2.3');
    expect(out.streak.kind).toBe('positive');
    expect(out.streak.text).toContain('5-week');
  });
});

describe('buildWorkoutInsight', () => {
  it('calls out a faster-than-usual session', () => {
    const out = byId(buildWorkoutInsight(
      { inferred_tag: 'endurance', pace_ms: 116000, heart_rate_avg: 150, metrics: {} },
      { medianPaceMs: 120000, medianHr: 150 },
    ));
    expect(out.pace.kind).toBe('positive');
    expect(out.pace.text).toContain('endurance');
  });

  it('reads lower HR at the same pace as a good aerobic sign', () => {
    const out = byId(buildWorkoutInsight(
      { inferred_tag: 'endurance', pace_ms: 120000, heart_rate_avg: 143, metrics: {} },
      { medianPaceMs: 120000, medianHr: 150 },
    ));
    expect(out.hr.kind).toBe('positive');
    expect(out.hr.text).toContain('lower');
  });

  it('praises low HR drift and warns on high drift', () => {
    const low = byId(buildWorkoutInsight(
      { inferred_tag: 'endurance', pace_ms: 120000, metrics: { hr_drift_pct: 3 } },
      {},
    ));
    expect(low.drift.kind).toBe('positive');
    const high = byId(buildWorkoutInsight(
      { inferred_tag: 'endurance', pace_ms: 120000, metrics: { hr_drift_pct: 14 } },
      {},
    ));
    expect(high.drift.kind).toBe('watch');
  });

  it('returns nothing when there is no baseline or drift to compare', () => {
    expect(buildWorkoutInsight({ inferred_tag: 'endurance', pace_ms: 120000, metrics: {} }, {})).toEqual([]);
  });
});
