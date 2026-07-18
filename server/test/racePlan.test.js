import { describe, it, expect } from 'vitest';
import {
  buildRacePlan, racePlanPhases, racePlanMilestones, raceTrajectory, planProfile,
  projectPerformance,
} from '../src/racePlan.js';

const GOAL = { id: 7, distance: 2000, target_time_ms: 383800, race_date: '2026-08-29' };
const NOW = new Date('2026-07-18T12:00:00Z'); // 42 days before race

function result(date, timeMs) {
  return { date, time_ms: timeMs, pace_ms: Math.round(timeMs / 4) };
}

describe('racePlanPhases', () => {
  it('lays out base, sharpen, and taper backwards from race day', () => {
    const { phases, current_phase } = racePlanPhases('2026-08-29', '2026-07-18');
    expect(phases.map(p => p.key)).toEqual(['base', 'sharpen', 'taper']);

    const sharpen = phases.find(p => p.key === 'sharpen');
    expect(sharpen.from).toBe('2026-08-01'); // race - 28
    expect(sharpen.to).toBe('2026-08-21'); // race - 8

    const taper = phases.find(p => p.key === 'taper');
    expect(taper.from).toBe('2026-08-22'); // race - 7
    expect(taper.to).toBe('2026-08-28'); // race - 1

    expect(current_phase).toBe('base');
  });

  it('anchors the timeline at today when the race is further than the base horizon', () => {
    const { phases, timeline_start } = racePlanPhases('2026-08-29', '2026-04-01');
    expect(timeline_start).toBe('2026-04-01');
    expect(phases.find(p => p.key === 'base').from).toBe('2026-04-01');
  });

  it('keeps the full horizon when today is inside the plan window', () => {
    const { timeline_start } = racePlanPhases('2026-08-29', '2026-08-01');
    const expected = new Date(Date.parse('2026-08-29T00:00:00Z') - planProfile(2000).horizon * 86400000)
      .toISOString().slice(0, 10);
    expect(timeline_start).toBe(expected);
  });

  it('reports the taper as current inside the final week', () => {
    const { current_phase } = racePlanPhases('2026-08-29', '2026-08-25');
    expect(current_phase).toBe('taper');
  });

  it('reports race once race day arrives', () => {
    const { current_phase } = racePlanPhases('2026-08-29', '2026-08-29');
    expect(current_phase).toBe('race');
  });
});

describe('racePlanMilestones', () => {
  it('places the standard countdown milestones', () => {
    const milestones = racePlanMilestones('2026-08-29', '2026-07-18');
    const byKey = Object.fromEntries(milestones.map(m => [m.key, m]));

    expect(byKey.last_test.date).toBe('2026-08-17');
    expect(byKey.taper_start.date).toBe(`2026-08-${29 - planProfile(2000).taper}`);
    expect(byKey.rehearsal.date).toBe('2026-08-26');
    expect(byKey.rest.date).toBe('2026-08-28');
    expect(byKey.race.date).toBe('2026-08-29');
    expect(milestones.every(m => !m.passed)).toBe(true);
  });

  it('flags milestones already behind today', () => {
    const milestones = racePlanMilestones('2026-08-29', '2026-08-27');
    const byKey = Object.fromEntries(milestones.map(m => [m.key, m]));
    expect(byKey.last_test.passed).toBe(true);
    expect(byKey.taper_start.passed).toBe(true);
    expect(byKey.rest.passed).toBe(false);
    expect(byKey.race.passed).toBe(false);
  });
});

describe('raceTrajectory', () => {
  it('projects an improving trend to a race-day time', () => {
    // 2k dropping ~1s/week over nine weeks: 7:00 down to 6:52.
    const results = [];
    for (let week = 0; week < 9; week++) {
      const date = new Date(Date.parse('2026-05-16T00:00:00Z') + week * 7 * 86400000)
        .toISOString().slice(0, 10);
      results.push(result(date, 420000 - week * 1000));
    }

    const t = raceTrajectory({ goal: GOAL, results, pb: { time_ms: 412000 }, today: '2026-07-18' });
    expect(t.projected_time_ms).toBeLessThan(412000);
    // Nine weekly efforts reduce to the best per fortnight bucket.
    expect(t.sample_size).toBe(5);
    expect(['close', 'at_risk', 'on_track']).toContain(t.verdict);
    expect(t.required_per_week_ms).toBe(Math.round((412000 - 383800) / 6));
  });

  it('caps the projection at 3% beyond the best recent pace', () => {
    // Steep trend: ~7s improvement per fortnight extrapolated over 6 weeks.
    const results = [
      result('2026-06-20', 420000),
      result('2026-07-04', 410000),
      result('2026-07-15', 400000),
    ];
    const t = raceTrajectory({ goal: GOAL, results, pb: { time_ms: 400000 }, today: '2026-07-18' });
    expect(t.projected_time_ms).toBeGreaterThanOrEqual(Math.round(400000 * 0.97));
  });

  it('drops easy rows at the goal distance from the trend', () => {
    const results = [
      result('2026-06-20', 412000), // hard test
      result('2026-06-24', 460000), // steady row, >6% off best pace
      result('2026-07-04', 410000),
      result('2026-07-08', 455000), // steady row
      result('2026-07-15', 408000),
    ];
    const t = raceTrajectory({ goal: GOAL, results, pb: { time_ms: 408000 }, today: '2026-07-18' });
    expect(t.sample_size).toBe(3);
    // The projection follows the tests, not the easy rows.
    expect(t.projected_time_ms).toBeLessThanOrEqual(412000);
  });

  it('marks the goal achieved when the PB already beats it', () => {
    const t = raceTrajectory({ goal: GOAL, results: [], pb: { time_ms: 380000 }, today: '2026-07-18' });
    expect(t.verdict).toBe('achieved');
    expect(t.required_per_week_ms).toBeNull();
  });

  it('reports insufficient data below the sample threshold', () => {
    const t = raceTrajectory({
      goal: GOAL,
      results: [result('2026-07-01', 420000), result('2026-07-10', 419000)],
      pb: { time_ms: 419000 },
      today: '2026-07-18',
    });
    expect(t.verdict).toBe('insufficient_data');
    expect(t.projected_time_ms).toBeNull();
    expect(t.required_per_week_ms).toBeGreaterThan(0);
  });

  it('ignores results older than the trajectory window', () => {
    const results = [
      result('2025-01-01', 400000),
      result('2025-02-01', 401000),
      result('2026-07-01', 430000),
    ];
    const t = raceTrajectory({ goal: GOAL, results, pb: { time_ms: 400000 }, today: '2026-07-18' });
    expect(t.sample_size).toBe(1);
    expect(t.verdict).toBe('insufficient_data');
  });

  it('flags a flat trend well outside the goal as at risk', () => {
    const results = [
      result('2026-06-20', 420000),
      result('2026-07-01', 421000),
      result('2026-07-10', 419500),
      result('2026-07-15', 420500),
    ];
    const t = raceTrajectory({ goal: GOAL, results, pb: { time_ms: 419500 }, today: '2026-07-18' });
    expect(t.verdict).toBe('at_risk');
    expect(t.projected_delta_ms).toBeGreaterThan(GOAL.target_time_ms * 0.01);
  });
});

describe('projectPerformance', () => {
  const results = [
    result('2026-06-20', 414000),
    result('2026-07-04', 411000),
    result('2026-07-15', 408000),
  ];

  it('matches the race trajectory when projected to the same race date', () => {
    const t = raceTrajectory({ goal: GOAL, results, pb: { time_ms: 408000 }, today: '2026-07-18' });
    const p = projectPerformance({
      distance: GOAL.distance, results, toDate: GOAL.race_date, today: '2026-07-18',
    });
    expect(p.projected_time_ms).toBe(t.projected_time_ms);
    expect(p.confidence).toBe(t.confidence);
    expect(p.sample_size).toBe(t.sample_size);
  });

  it('projects to today for a goal without a race date', () => {
    const p = projectPerformance({
      distance: GOAL.distance, results, toDate: '2026-07-18', today: '2026-07-18',
    });
    const raceDay = projectPerformance({
      distance: GOAL.distance, results, toDate: GOAL.race_date, today: '2026-07-18',
    });
    // An improving trend projects further improvement by race day.
    expect(p.projected_time_ms).toBeGreaterThanOrEqual(raceDay.projected_time_ms);
    expect(p.projected_time_ms).toBeLessThanOrEqual(414000);
  });

  it('returns nulls below the sample threshold', () => {
    const p = projectPerformance({
      distance: GOAL.distance, results: results.slice(0, 2), toDate: '2026-07-18', today: '2026-07-18',
    });
    expect(p.projected_time_ms).toBeNull();
    expect(p.sample_size).toBe(2);
  });
});

describe('planProfile', () => {
  it('classifies race formats by distance', () => {
    expect(planProfile(500).key).toBe('sprint');
    expect(planProfile(1000).key).toBe('sprint');
    expect(planProfile(2000).key).toBe('middle');
    expect(planProfile(6000).key).toBe('middle');
    expect(planProfile(10000).key).toBe('long');
    expect(planProfile(21097).key).toBe('ultra');
    expect(planProfile(42195).key).toBe('ultra');
  });

  it('gives sprints a short taper and a late test', () => {
    const milestones = racePlanMilestones('2026-08-29', '2026-07-18', 1000);
    const byKey = Object.fromEntries(milestones.map(m => [m.key, m]));
    expect(byKey.last_test.date).toBe('2026-08-21'); // race - 8
    expect(byKey.taper_start.date).toBe('2026-08-24'); // race - 5

    const { phases } = racePlanPhases('2026-08-29', '2026-07-18', 1000);
    expect(phases.find(p => p.key === 'taper').from).toBe('2026-08-24');
  });

  it('gives a marathon a two-week taper and a long test three weeks out', () => {
    const milestones = racePlanMilestones('2026-08-29', '2026-05-01', 42195);
    const byKey = Object.fromEntries(milestones.map(m => [m.key, m]));
    expect(byKey.last_test.date).toBe('2026-08-08'); // race - 21
    expect(byKey.last_test.label).toBe('Last long test');
    expect(byKey.last_test.description).toMatch(/not a full-distance time trial/i);
    expect(byKey.taper_start.date).toBe('2026-08-15'); // race - 14

    const { phases, timeline_start } = racePlanPhases('2026-08-29', '2026-06-01', 42195);
    expect(phases.find(p => p.key === 'taper').from).toBe('2026-08-15');
    // Longer horizon: 112 days back from race day (2026-05-09, before today).
    expect(timeline_start).toBe('2026-05-09');
  });
});

describe('buildRacePlan', () => {
  it('assembles the full plan', () => {
    const plan = buildRacePlan({
      goal: GOAL,
      results: [result('2026-06-25', 412000), result('2026-07-05', 410000), result('2026-07-15', 408000)],
      pb: { time_ms: 408000 },
      now: NOW,
    });

    expect(plan.days_to_race).toBe(42);
    expect(plan.goal_id).toBe(7);
    expect(plan.current_phase).toBe('base');
    expect(plan.phases).toHaveLength(3);
    expect(plan.milestones).toHaveLength(5);
    expect(plan.trajectory.projected_time_ms).not.toBeNull();
    expect(plan.plan_profile).toBe('middle');
  });

  it('returns null without a race date', () => {
    expect(buildRacePlan({ goal: { ...GOAL, race_date: null }, results: [], pb: null, now: NOW })).toBeNull();
    expect(buildRacePlan({ goal: { ...GOAL, race_date: 'nonsense' }, results: [], pb: null, now: NOW })).toBeNull();
  });

  it('still builds after the race has passed', () => {
    const plan = buildRacePlan({ goal: GOAL, results: [], pb: null, now: new Date('2026-09-05T00:00:00Z') });
    expect(plan.days_to_race).toBeLessThan(0);
    expect(plan.current_phase).toBe('race');
  });
});
