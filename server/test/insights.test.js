import { describe, it, expect } from 'vitest';
import { buildWeeklyInsights, buildWeeklyOverview, buildWorkoutInsight } from '../src/insights.js';

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

describe('buildWeeklyOverview', () => {
  it('prioritises inactivity and fatigue before positive load signals', () => {
    expect(buildWeeklyOverview({ weeklyMeters: 0, sessionsThisWeek: 0 }).status.key).toBe('idle');

    const fatigued = buildWeeklyOverview({
      weeklyMeters: 50000,
      prevWeeklyMeters: 30000,
      sessionsThisWeek: 5,
      form: -12,
      fitnessDelta7d: 2,
    });
    expect(fatigued.status.key).toBe('fatigued');
  });

  it('classifies building, easing, and steady weeks deterministically', () => {
    expect(buildWeeklyOverview({
      weeklyMeters: 44000, prevWeeklyMeters: 40000, sessionsThisWeek: 4,
    }).status.key).toBe('building');
    expect(buildWeeklyOverview({
      weeklyMeters: 20000, prevWeeklyMeters: 40000, sessionsThisWeek: 2,
    }).status.key).toBe('easing');
    expect(buildWeeklyOverview({
      weeklyMeters: 41000, prevWeeklyMeters: 40000, sessionsThisWeek: 4,
    }).status.key).toBe('steady');
  });

  it('returns raw signals and preserves missing comparisons as null', () => {
    const overview = buildWeeklyOverview({
      weeklyMeters: 44000,
      prevWeeklyMeters: 40000,
      sessionsThisWeek: 4,
      fitness: 34.4,
      fitnessDelta7d: 1.6,
      form: 6,
      recentEndurancePaceMs: 116000,
      priorEndurancePaceMs: 118500,
    });

    expect(overview.signals.volume).toMatchObject({
      value_meters: 44000, delta_pct: 0.1, sessions: 4, window_days: 7,
    });
    expect(overview.signals.fitness).toEqual({ value: 34.4, delta_7d: 1.6 });
    expect(overview.signals.form).toEqual({ value: 6, readiness: 'fresh' });
    expect(overview.signals.pace).toEqual({ value_ms: 116000, delta_ms: -2500, window_days: 30 });

    const missing = buildWeeklyOverview({ weeklyMeters: 10000, sessionsThisWeek: 1 });
    expect(missing.signals.volume.delta_pct).toBeNull();
    expect(missing.signals.fitness.value).toBeNull();
    expect(missing.signals.pace.delta_ms).toBeNull();
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

describe('buildWorkoutInsight — interval sets', () => {
  const workout = { inferred_tag: 'interval', pace_ms: 109000, metrics: {} };
  const rep = (paceMs, strokeRate = 30) => ({ type: 'work', pace_ms: paceMs, stroke_rate: strokeRate });

  it('calls a tight set even and names the fastest rep', () => {
    const out = byId(buildWorkoutInsight(workout, {}, {
      intervals: [rep(110000), rep(109200), rep(108800), rep(109500)],
    }));
    expect(out.reps.kind).toBe('positive');
    expect(out.reps.text).toContain('even set');
    expect(out.reps.text).toContain('rep 3 fastest at 1:48.8');
  });

  it('praises a fastest final rep', () => {
    const out = byId(buildWorkoutInsight(workout, {}, {
      intervals: [rep(112000), rep(111000), rep(110000), rep(108000)],
    }));
    expect(out.reps.kind).toBe('positive');
    expect(out.reps.text).toContain('Finished strongest');
    expect(out.reps.text).toContain('rep 4');
  });

  it('flags a wide pace spread as drift', () => {
    const out = byId(buildWorkoutInsight(workout, {}, {
      intervals: [rep(107000), rep(110000), rep(112500), rep(111000)],
    }));
    expect(out.reps.kind).toBe('watch');
    expect(out.reps.text).toContain('5.5 s/500m');
  });

  it('flags a stroke-rate spike against the set average', () => {
    const out = byId(buildWorkoutInsight(workout, {}, {
      intervals: [rep(110000, 28.5), rep(109000, 28.3), rep(111000, 33.7), rep(110500, 28.4)],
    }));
    expect(out.rate_spike.kind).toBe('watch');
    expect(out.rate_spike.text).toContain('33.7 spm on rep 3');
  });

  it('reads HR recoveries between reps', () => {
    const good = byId(buildWorkoutInsight(workout, {}, {
      intervals: [rep(110000), rep(109000)],
      recoveries: [{ drop_bpm: 14 }, { drop_bpm: 12 }],
    }));
    expect(good.recovery.kind).toBe('positive');

    const poor = byId(buildWorkoutInsight(workout, {}, {
      intervals: [rep(110000), rep(109000)],
      recoveries: [{ drop_bpm: 2 }, { drop_bpm: 1 }],
    }));
    expect(poor.recovery.kind).toBe('watch');
  });

  it('ignores rest rows and skips sets with fewer than two work reps', () => {
    const out = buildWorkoutInsight(workout, {}, {
      intervals: [rep(110000), { type: 'rest', pace_ms: 0 }],
    });
    expect(out).toEqual([]);
  });
});
