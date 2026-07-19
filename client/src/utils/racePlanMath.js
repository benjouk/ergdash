// Client-side port of the race-backward planning used by the demo shim
// (demoApi.js) so the deployed VITE_DEMO build can build race plans and
// performance projections for visitor-created goals without a backend. This
// MIRRORS server/src/racePlan.js verbatim and must be kept in sync with it.
// The real app never imports this - it hits the server.
//
// Race-backward planning: given a performance goal with a race date, lay out
// training phases and milestones counting back from race day, and project the
// current result trend forward to a race-day time so "predicted vs goal"
// becomes a verdict instead of a fact. Pure maths, mirroring goalProgress.js:
// all date arithmetic is UTC and dates are ISO YYYY-MM-DD strings.

const DAY_MS = 86400000;

// Countdown timing depends on the race format: a 500m sprint needs almost no
// taper and can test late, while a marathon needs a two-week taper and its
// last long test three weeks out (a full-distance time trial that close would
// cost more than it tells). Days are all relative to race day.
//   taper       days of reduced volume before the race
//   sharpen     days of race-pace focus before the race
//   horizon     how far back the plan timeline reaches
//   test        when the last hard test falls, and whether it is a full
//               time trial or a long row with race-pace blocks
//   rehearsal   short goal-pace touches in race week
const PLAN_PROFILES = [
  {
    key: 'sprint',
    maxDistance: 1000,
    taper: 5,
    sharpen: 21,
    horizon: 70,
    test: 8,
    rehearsal: 2,
    testLabel: 'Last all-out test',
    testDescription: 'Full-distance time trial while there is still time to adjust pacing and the goal.',
  },
  {
    key: 'middle',
    maxDistance: 6000,
    taper: 7,
    sharpen: 28,
    horizon: 84,
    test: 12,
    rehearsal: 3,
    testLabel: 'Last all-out test',
    testDescription: 'Full-distance time trial while there is still time to adjust pacing and the goal.',
  },
  {
    key: 'long',
    maxDistance: 10000,
    taper: 7,
    sharpen: 28,
    horizon: 84,
    test: 14,
    rehearsal: 3,
    testLabel: 'Last all-out test',
    testDescription: 'Full-distance time trial while there is still time to adjust pacing and the goal.',
  },
  {
    key: 'ultra',
    maxDistance: Infinity,
    taper: 14,
    sharpen: 35,
    horizon: 112,
    test: 21,
    rehearsal: 4,
    testLabel: 'Last long test',
    testDescription: 'Longest row of the build with extended blocks at race pace - not a full-distance time trial.',
  },
];

export function planProfile(distance) {
  return PLAN_PROFILES.find(p => (distance || 2000) <= p.maxDistance);
}

// Results inside this window feed the race-day trajectory projection.
const TRAJECTORY_WINDOW_DAYS = 120;
const MIN_TRAJECTORY_RESULTS = 3;

// Only near-maximal efforts count as trend points: paces within this factor of
// the best pace in the window. Everyday steady rows at the goal distance would
// otherwise drag the projection far below what the athlete tests at.
const EFFORT_PACE_FACTOR = 1.06;

// One trend point per bucket (the best result), so a week with one hard test
// and three easy rows contributes the test.
const EFFORT_BUCKET_DAYS = 14;

// A regression can extrapolate absurd improvement over a long runway; cap the
// projection at 3% faster than the best pace actually rowed in the window.
const MAX_PROJECTED_GAIN = 0.97;

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs(isoDate) {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

export function racePlanPhases(raceDate, today, distance = 2000) {
  const profile = planProfile(distance);
  const raceMs = dayMs(raceDate);
  const todayMs = dayMs(today);
  const timelineStartMs = Math.min(todayMs, raceMs - profile.horizon * DAY_MS);

  const defs = [
    {
      key: 'base',
      label: 'Base',
      from: timelineStartMs,
      to: raceMs - (profile.sharpen + 1) * DAY_MS,
      description: 'Aerobic volume: long steady rows and threshold work. Build the engine.',
    },
    {
      key: 'sharpen',
      label: 'Sharpen',
      from: raceMs - profile.sharpen * DAY_MS,
      to: raceMs - (profile.taper + 1) * DAY_MS,
      description: 'Race-pace work and the final hard test. Convert fitness to speed.',
    },
    {
      key: 'taper',
      label: 'Taper',
      from: raceMs - profile.taper * DAY_MS,
      to: raceMs - DAY_MS,
      description: 'Volume drops 40-50%; short race-pace touches keep the edge. Arrive fresh.',
    },
  ];

  const phases = defs
    .filter(p => p.to >= p.from && p.to >= timelineStartMs)
    .map(p => ({
      key: p.key,
      label: p.label,
      from: isoDay(Math.max(p.from, timelineStartMs)),
      to: isoDay(p.to),
      description: p.description,
    }));

  let currentPhase = null;
  for (const p of phases) {
    const t = isoDay(todayMs);
    if (t >= p.from && t <= p.to) currentPhase = p.key;
  }
  if (currentPhase == null && todayMs >= raceMs) currentPhase = 'race';

  return { phases, current_phase: currentPhase, timeline_start: isoDay(timelineStartMs) };
}

export function racePlanMilestones(raceDate, today, distance = 2000) {
  const profile = planProfile(distance);
  const raceMs = dayMs(raceDate);
  const todayIso = isoDay(dayMs(today));

  const defs = [
    {
      key: 'last_test',
      offset: profile.test,
      label: profile.testLabel,
      description: profile.testDescription,
    },
    {
      key: 'taper_start',
      offset: profile.taper,
      label: 'Taper begins',
      description: 'Cut volume, keep intensity. No more fitness can be built from here - only freshness.',
    },
    {
      key: 'rehearsal',
      offset: profile.rehearsal,
      label: 'Race-pace rehearsal',
      description: 'Short bursts at goal pace to groove the rhythm and settle the start sequence.',
    },
    {
      key: 'rest',
      offset: 1,
      label: 'Rest',
      description: 'Full rest or a very light paddle.',
    },
    {
      key: 'race',
      offset: 0,
      label: 'Race day',
      description: 'Trust the plan: even splits through the middle, empty the tank in the final quarter.',
    },
  ];

  return defs.map(m => {
    const date = isoDay(raceMs - m.offset * DAY_MS);
    return { key: m.key, date, label: m.label, description: m.description, passed: date < todayIso };
  });
}

// Weighted linear regression of pace over time; recent results count more.
// Same shape as the analytics predictor but local so this module stays pure.
function paceRegression(points) {
  const weightSum = points.reduce((s, p) => s + p.weight, 0);
  const meanX = points.reduce((s, p) => s + p.x * p.weight, 0) / weightSum;
  const meanY = points.reduce((s, p) => s + p.y * p.weight, 0) / weightSum;

  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += p.weight * (p.x - meanX) * (p.y - meanY);
    denominator += p.weight * Math.pow(p.x - meanX, 2);
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  let residual = 0;
  let total = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.x;
    residual += p.weight * Math.pow(p.y - predicted, 2);
    total += p.weight * Math.pow(p.y - meanY, 2);
  }
  const fit = total === 0 ? 1 : Math.max(0, 1 - residual / total);
  const density = Math.min(1, points.length / 8);
  return { slope, intercept, confidence: Math.round(fit * density * 100) / 100 };
}

// The single projection engine for performance goals: near-maximal efforts at
// the distance, weighted regression of pace over time, evaluated at toDate.
// Both the race-plan trajectory and the Targets card prediction go through
// here, so the dashboard can never show two different numbers for one goal.
// results: [{ date, time_ms, pace_ms }] at the goal distance, any order.
export function projectPerformance({ distance, results, toDate, today }) {
  const todayMs = dayMs(isoDay(dayMs(today)));
  const windowStart = todayMs - TRAJECTORY_WINDOW_DAYS * DAY_MS;
  const recent = (results || [])
    .filter(r => r.pace_ms > 0 && dayMs(String(r.date).slice(0, 10)) >= windowStart)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const efforts = selectEfforts(recent, windowStart);
  if (efforts.length < MIN_TRAJECTORY_RESULTS) {
    return { projected_time_ms: null, confidence: null, sample_size: efforts.length };
  }

  const firstMs = dayMs(String(efforts[0].date).slice(0, 10));
  const points = efforts.map((r, i) => ({
    x: (dayMs(String(r.date).slice(0, 10)) - firstMs) / DAY_MS,
    y: r.pace_ms,
    weight: 1 + i / efforts.length,
  }));

  const regression = paceRegression(points);
  const targetX = (dayMs(toDate) - firstMs) / DAY_MS;
  const bestRecentPace = Math.min(...efforts.map(r => r.pace_ms));
  const worstRecentPace = Math.max(...efforts.map(r => r.pace_ms));

  let projectedPace = regression.intercept + regression.slope * targetX;
  projectedPace = Math.max(projectedPace, bestRecentPace * MAX_PROJECTED_GAIN);
  projectedPace = Math.min(projectedPace, worstRecentPace);

  return {
    projected_time_ms: Math.round(projectedPace * (distance / 500)),
    confidence: regression.confidence,
    sample_size: efforts.length,
  };
}

// pb: fastest { time_ms } ever at the distance (not restricted to the window).
export function raceTrajectory({ goal, results, pb, today }) {
  const todayMs = dayMs(isoDay(dayMs(today)));
  const raceMs = dayMs(goal.race_date);
  const daysToRace = Math.round((raceMs - todayMs) / DAY_MS);
  const achieved = pb != null && pb.time_ms <= goal.target_time_ms;

  const projection = projectPerformance({
    distance: goal.distance,
    results,
    toDate: goal.race_date,
    today,
  });

  const base = {
    verdict: achieved ? 'achieved' : 'insufficient_data',
    projected_time_ms: null,
    projected_delta_ms: null,
    required_per_week_ms: requiredPerWeek(goal, pb, daysToRace),
    sample_size: projection.sample_size,
    confidence: null,
  };

  if (projection.projected_time_ms == null || daysToRace < 0) return base;

  const projectedTime = projection.projected_time_ms;
  const delta = projectedTime - goal.target_time_ms;

  let verdict;
  if (achieved) verdict = 'achieved';
  else if (delta <= 0) verdict = 'on_track';
  else if (delta <= goal.target_time_ms * 0.01) verdict = 'close';
  else verdict = 'at_risk';

  return {
    ...base,
    verdict,
    projected_time_ms: projectedTime,
    projected_delta_ms: delta,
    confidence: projection.confidence,
  };
}

// Trend points: near-maximal efforts only (within EFFORT_PACE_FACTOR of the
// window's best pace), reduced to the best result per EFFORT_BUCKET_DAYS so a
// hard test outweighs the easy rows around it.
function selectEfforts(recent, windowStartMs) {
  if (recent.length === 0) return [];
  const bestPace = Math.min(...recent.map(r => r.pace_ms));
  const cutoff = bestPace * EFFORT_PACE_FACTOR;

  const buckets = new Map();
  for (const r of recent) {
    if (r.pace_ms > cutoff) continue;
    const bucket = Math.floor((dayMs(String(r.date).slice(0, 10)) - windowStartMs) / (EFFORT_BUCKET_DAYS * DAY_MS));
    const current = buckets.get(bucket);
    if (!current || r.pace_ms < current.pace_ms) buckets.set(bucket, r);
  }
  return [...buckets.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Seconds-per-week the PB still has to fall by to hit the goal in time.
function requiredPerWeek(goal, pb, daysToRace) {
  if (pb == null || daysToRace == null || daysToRace <= 0) return null;
  const gap = pb.time_ms - goal.target_time_ms;
  if (gap <= 0) return null;
  return Math.round(gap / (daysToRace / 7));
}

export function buildRacePlan({ goal, results, pb, now = new Date() }) {
  if (!goal?.race_date || Number.isNaN(dayMs(goal.race_date))) return null;

  const today = isoDay(now.getTime());
  const daysToRace = Math.round((dayMs(goal.race_date) - dayMs(today)) / DAY_MS);
  const { phases, current_phase, timeline_start } = racePlanPhases(goal.race_date, today, goal.distance);

  return {
    goal_id: goal.id ?? null,
    distance: goal.distance,
    plan_profile: planProfile(goal.distance).key,
    target_time_ms: goal.target_time_ms,
    race_date: goal.race_date,
    days_to_race: daysToRace,
    timeline_start,
    phases,
    current_phase,
    milestones: racePlanMilestones(goal.race_date, today, goal.distance),
    trajectory: raceTrajectory({ goal, results, pb, today }),
  };
}
