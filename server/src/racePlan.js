// Race-backward planning: given a performance goal with a race date, lay out
// training phases and milestones counting back from race day, and project the
// current result trend forward to a race-day time so "predicted vs goal"
// becomes a verdict instead of a fact. Pure maths, mirroring goalProgress.js:
// all date arithmetic is UTC and dates are ISO YYYY-MM-DD strings.

const DAY_MS = 86400000;

// Phase boundaries in days before race day. The taper is deliberately short
// for erg racing (a week of reduced volume is plenty for a 6-8 minute event)
// and the sharpen block covers the last month of race-pace work.
export const TAPER_DAYS = 7;
export const SHARPEN_DAYS = 28;
export const BASE_HORIZON_DAYS = 84;

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

export function racePlanPhases(raceDate, today) {
  const raceMs = dayMs(raceDate);
  const todayMs = dayMs(today);
  const timelineStartMs = Math.min(todayMs, raceMs - BASE_HORIZON_DAYS * DAY_MS);

  const defs = [
    {
      key: 'base',
      label: 'Base',
      from: timelineStartMs,
      to: raceMs - (SHARPEN_DAYS + 1) * DAY_MS,
      description: 'Aerobic volume: long steady rows and threshold work. Build the engine.',
    },
    {
      key: 'sharpen',
      label: 'Sharpen',
      from: raceMs - SHARPEN_DAYS * DAY_MS,
      to: raceMs - (TAPER_DAYS + 1) * DAY_MS,
      description: 'Race-pace intervals and a final all-out test. Convert fitness to speed.',
    },
    {
      key: 'taper',
      label: 'Taper',
      from: raceMs - TAPER_DAYS * DAY_MS,
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

export function racePlanMilestones(raceDate, today) {
  const raceMs = dayMs(raceDate);
  const todayIso = isoDay(dayMs(today));

  const defs = [
    {
      key: 'last_test',
      offset: 12,
      label: 'Last all-out test',
      description: 'Full-distance time trial while there is still time to adjust pacing and the goal.',
    },
    {
      key: 'taper_start',
      offset: TAPER_DAYS,
      label: 'Taper begins',
      description: 'Cut volume, keep intensity. No more fitness can be built from here - only freshness.',
    },
    {
      key: 'rehearsal',
      offset: 3,
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

// results: [{ date, time_ms, pace_ms }] at the goal distance, any order.
// pb: fastest { time_ms } ever at the distance (not restricted to the window).
export function raceTrajectory({ goal, results, pb, today }) {
  const splits = goal.distance / 500;
  const todayMs = dayMs(isoDay(dayMs(today)));
  const raceMs = dayMs(goal.race_date);
  const daysToRace = Math.round((raceMs - todayMs) / DAY_MS);
  const achieved = pb != null && pb.time_ms <= goal.target_time_ms;

  const windowStart = todayMs - TRAJECTORY_WINDOW_DAYS * DAY_MS;
  const recent = (results || [])
    .filter(r => r.pace_ms > 0 && dayMs(String(r.date).slice(0, 10)) >= windowStart)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const efforts = selectEfforts(recent, windowStart);

  const base = {
    verdict: achieved ? 'achieved' : 'insufficient_data',
    projected_time_ms: null,
    projected_delta_ms: null,
    required_per_week_ms: requiredPerWeek(goal, pb, daysToRace),
    sample_size: efforts.length,
    confidence: null,
  };

  if (efforts.length < MIN_TRAJECTORY_RESULTS || daysToRace < 0) return base;

  const firstMs = dayMs(String(efforts[0].date).slice(0, 10));
  const points = efforts.map((r, i) => ({
    x: (dayMs(String(r.date).slice(0, 10)) - firstMs) / DAY_MS,
    y: r.pace_ms,
    weight: 1 + i / efforts.length,
  }));

  const regression = paceRegression(points);
  const raceX = (raceMs - firstMs) / DAY_MS;
  const bestRecentPace = Math.min(...efforts.map(r => r.pace_ms));
  const worstRecentPace = Math.max(...efforts.map(r => r.pace_ms));

  let projectedPace = regression.intercept + regression.slope * raceX;
  projectedPace = Math.max(projectedPace, bestRecentPace * MAX_PROJECTED_GAIN);
  projectedPace = Math.min(projectedPace, worstRecentPace);

  const projectedTime = Math.round(projectedPace * splits);
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
    confidence: regression.confidence,
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
  const { phases, current_phase, timeline_start } = racePlanPhases(goal.race_date, today);

  return {
    goal_id: goal.id ?? null,
    distance: goal.distance,
    target_time_ms: goal.target_time_ms,
    race_date: goal.race_date,
    days_to_race: daysToRace,
    timeline_start,
    phases,
    current_phase,
    milestones: racePlanMilestones(goal.race_date, today),
    trajectory: raceTrajectory({ goal, results, pb, today }),
  };
}
