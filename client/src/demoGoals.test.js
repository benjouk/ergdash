import { beforeEach, describe, expect, it } from 'vitest';
import { demoRequest } from './demoApi.js';

const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysFromNow = (n) => iso(Date.now() + n * DAY_MS);
// Workout dates use the DB's 'YYYY-MM-DD HH:MM:SS' shape.
const workoutDate = (daysAgo) => `${iso(Date.now() - daysAgo * DAY_MS)} 07:00:00`;

// Three continuous 2k efforts inside the 120-day trajectory window, in
// distinct 14-day buckets and within 6% of the best pace, so the projection
// engine has enough trend points to produce a prediction.
const twoK = (id, daysAgo, timeMs) => ({
  id,
  date: workoutDate(daysAgo),
  type: 'rower',
  distance: 2000,
  time_ms: timeMs,
  pace_ms: timeMs / 4,
  inferred_tag: 'endurance',
  intent: null,
});

const fixtures = {
  '/demo-data/auth-status.json': {
    authenticated: true,
    profiles: [{ id: 1, name: 'Demo Rower', connected: true }],
  },
  '/demo-data/p1/manifest.json': {
    '/api/goals': 'goals.json',
    '/api/workouts': 'workouts.json',
    '/api/settings': 'settings.json',
  },
  '/demo-data/p1/settings.json': { week_start: 'monday' },
  '/demo-data/p1/goals.json': {
    goals: [{
      id: 1, profile_id: 1, kind: 'volume', period: 'weekly', target_meters: 60000,
      distance: null, target_time_ms: null, race_date: null, label: null,
      active: 1, achieved_at: null, progress: {},
    }],
  },
  '/demo-data/p1/workouts.json': {
    data: [twoK(101, 60, 460000), twoK(102, 30, 455000), twoK(103, 10, 450000)],
    meta: {},
  },
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async (url) => {
  const data = fixtures[url];
  if (!data) throw new Error(`No fixture stub for ${url}`);
  return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
};

const listGoals = () => demoRequest('/api/goals').then(d => d.goals);
const createGoal = (body) => demoRequest('/api/goals', { method: 'POST', body: JSON.stringify(body) });

describe('demo goal overlay', () => {
  beforeEach(() => store.clear());

  it('creates a performance target and decorates it from the workouts fixture', async () => {
    const goal = await createGoal({
      kind: 'performance', distance: 2000, target_time_ms: 445000,
      race_date: daysFromNow(30), label: 'Test 2k',
    });

    expect(goal.id).toBeGreaterThanOrEqual(900000);
    expect(goal.active).toBe(1);
    expect(goal.progress.pb).toMatchObject({ workout_id: 103, time_ms: 450000 });
    expect(goal.progress.target_pace_ms).toBe(111250);
    expect(goal.progress.days_to_race).toBe(30);
    expect(goal.progress.achieved).toBe(false);
    expect(goal.progress.prediction).toMatchObject({ distance: 2000, projected_to: daysFromNow(30) });
    expect(goal.progress.prediction.predicted_time).toBeGreaterThan(0);

    const goals = await listGoals();
    expect(goals.map(g => g.id)).toContain(goal.id);
    // The fixture volume goal is re-decorated at read time, not served stale.
    const volume = goals.find(g => g.id === 1);
    expect(volume.progress.window).toBeDefined();
    expect(volume.progress.target_meters).toBe(60000);
  });

  it('builds a race plan for a visitor-created race-dated goal', async () => {
    const goal = await createGoal({
      kind: 'performance', distance: 2000, target_time_ms: 445000, race_date: daysFromNow(30),
    });

    const plan = await demoRequest(`/api/goals/${goal.id}/race-plan`);
    expect(plan.goal_id).toBe(goal.id);
    expect(plan.days_to_race).toBe(30);
    expect(plan.phases.length).toBeGreaterThan(0);
    expect(plan.milestones).toHaveLength(5);
    expect(plan.trajectory.verdict).toBeDefined();
  });

  it('patches goals, including captured fixture goals', async () => {
    const goal = await createGoal({
      kind: 'performance', distance: 2000, target_time_ms: 445000, race_date: daysFromNow(30),
    });

    const moved = await demoRequest(`/api/goals/${goal.id}`, {
      method: 'PATCH', body: JSON.stringify({ race_date: daysFromNow(60) }),
    });
    expect(moved.progress.days_to_race).toBe(60);

    const volume = await demoRequest('/api/goals/1', {
      method: 'PATCH', body: JSON.stringify({ target_meters: 80000 }),
    });
    expect(volume.progress.target_meters).toBe(80000);
  });

  it('deletes created and fixture goals', async () => {
    const goal = await createGoal({ kind: 'performance', distance: 2000, target_time_ms: 445000 });

    await demoRequest(`/api/goals/${goal.id}`, { method: 'DELETE' });
    await demoRequest('/api/goals/1', { method: 'DELETE' });

    expect(await listGoals()).toHaveLength(0);
  });

  it('rejects invalid bodies and duplicate active volume goals', async () => {
    await expect(createGoal({ kind: 'performance', distance: 2000, target_time_ms: 0 }))
      .rejects.toThrow('target_time_ms must be a positive integer');
    await expect(createGoal({ kind: 'volume', period: 'weekly', target_meters: 50000 }))
      .rejects.toThrow('An active weekly volume goal already exists');
    await expect(demoRequest('/api/goals/999', { method: 'PATCH', body: JSON.stringify({ active: false }) }))
      .rejects.toThrow('Goal not found');
  });
});
