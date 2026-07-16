// Demo-mode API shim. Serves build-time-captured fixtures (see
// scripts/build-demo-data.mjs) instead of hitting a real backend, so the
// live demo can run as a static site while staying byte-for-byte in sync
// with whatever the real API currently returns.
import { computeDateRange } from './utils/timeRange.js';
import {
  generateProgramSessions, resolveDurationWeeks, deriveIntervalTotals,
  validateProgramInput, shiftDate, remapDate, RACE_MIN_LEAD_DAYS,
} from './utils/programSchedule.js';

const BASE = import.meta.env.BASE_URL;
const RANGE_KEYS = ['30d', '90d', 'season', 'last_season', 'all'];
const RANGE_SCOPED_ROUTES = new Set([
  '/api/stats/summary',
  '/api/stats/personal-bests',
  '/api/stats/fitness',
  '/api/stats/zones',
  '/api/stats/polarization',
  '/api/stats/pb-history',
  '/api/stats/trends',
]);

// Fixtures are captured per profile under demo-data/p<id>/, so each household
// member in the demo shows their own data. The active profile is the same
// localStorage key the real api.js uses; before one is chosen we default to
// the first captured profile.
const manifestPromises = new Map();
const fixtureCache = new Map();
let authStatusPromise = null;

function loadAuthStatus() {
  if (!authStatusPromise) {
    authStatusPromise = fetch(`${BASE}demo-data/auth-status.json`).then(r => r.json());
  }
  return authStatusPromise;
}

async function activeProfileId() {
  const stored = localStorage.getItem('ergdash_profile');
  if (stored) return stored;
  const status = await loadAuthStatus();
  return String(status.profiles?.[0]?.id ?? '1');
}

async function fixtureUrl(subpath) {
  return `${BASE}demo-data/p${await activeProfileId()}/${subpath}`;
}

async function loadManifest() {
  const id = await activeProfileId();
  if (!manifestPromises.has(id)) {
    manifestPromises.set(id, fetch(`${BASE}demo-data/p${id}/manifest.json`).then(r => r.json()));
  }
  return manifestPromises.get(id);
}

async function loadFixture(file) {
  const id = await activeProfileId();
  const cacheKey = `${id}/${file}`;
  if (fixtureCache.has(cacheKey)) return fixtureCache.get(cacheKey);
  const data = await fetch(`${BASE}demo-data/p${id}/${file}`).then(r => r.json());
  fixtureCache.set(cacheKey, data);
  return data;
}

function rangeKeyFor(from, to) {
  if (!from && !to) return 'all';
  for (const key of RANGE_KEYS) {
    const preset = computeDateRange(key);
    if (preset.from === (from || null) && preset.to === (to || null)) return key;
  }
  return null;
}

function manifestKey(path, params) {
  const { from, to, ...rest } = params;
  const sortedKeys = Object.keys(rest).sort();
  const parts = sortedKeys.map(k => `${k}=${rest[k]}`);
  if (RANGE_SCOPED_ROUTES.has(path)) {
    const rangeKey = rangeKeyFor(from, to) || 'all';
    parts.unshift(`range=${rangeKey}`);
  }
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

async function lookupFixture(path, params) {
  const manifest = await loadManifest();
  const key = manifestKey(path, params);
  if (manifest[key]) return loadFixture(manifest[key]);

  // Fall back to the "all time" range for stats endpoints whose exact
  // date window wasn't captured, so unrecognized combos degrade instead
  // of breaking the view.
  if (RANGE_SCOPED_ROUTES.has(path)) {
    const fallbackKey = manifestKey(path, { ...params, from: undefined, to: undefined });
    if (manifest[fallbackKey]) return loadFixture(manifest[fallbackKey]);
  }

  console.warn(`[demo] no fixture for ${key}`);
  throw new Error('Demo data unavailable for this view');
}

// --- localStorage overlays for visitor-side "writes" ---

function readOverlay(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeOverlay(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private browsing, quota); demo edits just won't persist
  }
}

const SETTINGS_OVERLAY_KEY = 'ergdash-demo-settings';
const WORKOUT_OVERLAY_KEY = 'ergdash-demo-workout-overlay';
const PLAN_OVERLAY_KEY = 'ergdash-demo-plan-overlay';

// Demo-created plan ids start well above anything the seed can produce.
const DEMO_PLAN_ID_FLOOR = 900000;

function getSettingsOverlay() {
  return readOverlay(SETTINGS_OVERLAY_KEY, {});
}

function getWorkoutOverlay(id) {
  const all = readOverlay(WORKOUT_OVERLAY_KEY, {});
  return all[id] || {};
}

function setWorkoutOverlay(id, patch) {
  const all = readOverlay(WORKOUT_OVERLAY_KEY, {});
  all[id] = { ...all[id], ...patch };
  writeOverlay(WORKOUT_OVERLAY_KEY, all);
  return all[id];
}

function applyWorkoutOverlay(workout) {
  const overlay = getWorkoutOverlay(workout.id);
  return Object.keys(overlay).length === 0 ? workout : { ...workout, ...overlay };
}

export function applyDemoNarrativeContext(workout, plan = workout?.plan ?? null) {
  if (!workout?.narrative) return { ...workout, plan };

  const explicitIntent = ['steady', 'hard_distance', 'test_race', 'recovery', 'technique']
    .includes(workout.intent)
    ? workout.intent
    : null;
  const planIntent = plan?.type === 'steady'
    ? 'steady'
    : (plan?.type === 'test' || plan?.type === 'race' ? 'test_race' : null);
  const intent = explicitIntent || planIntent;
  const intentSource = explicitIntent ? 'workout' : (planIntent ? 'plan' : null);
  const baseNarrative = { ...workout.narrative };
  delete baseNarrative.plan_review;
  const contextChanged = baseNarrative.intent !== intent
    || (baseNarrative.intent_source ?? null) !== intentSource;
  const narrative = {
    ...baseNarrative,
    intent,
    intent_source: intentSource,
    needs_intent: intent == null,
    recommendation: contextChanged
      ? (intent
        ? demoIntentRecommendation(workout, intent)
        : demoUnknownIntentRecommendation(workout))
      : baseNarrative.recommendation,
  };

  return { ...workout, plan, narrative };
}

function demoIntentRecommendation(workout, intent) {
  const analysis = workout.analysis || {};
  const execution = analysis.execution || analysis;
  const pacing = execution.pacing || null;
  const finish = execution.finish || null;
  const shape = pacing?.shape || {};
  const fastStart = Boolean(shape.fast_start ?? pacing?.fast_start ?? false);
  const lateFade = Boolean(shape.late_fade ?? pacing?.late_fade ?? false);
  const fastFinish = Boolean(shape.fast_finish ?? pacing?.fast_finish ?? false);
  const strongFinish = fastFinish || finish?.value === 'accelerated';
  const faded = lateFade || ['mild_fade', 'significant_fade'].includes(pacing?.value);
  const intervals = analysis.intervals ?? execution.intervals ?? null;
  const averageRate = Number(execution.rate?.average_spm) > 0
    ? ` around ${Math.round(Number(execution.rate.average_spm))} spm`
    : '';
  const rateVariable = ['variable', 'stable_avg_variable_stroke'].includes(execution.rate?.value);
  const hasPacingRead = (pacing?.value != null && pacing.value !== 'unknown')
    || (finish?.value != null && finish.value !== 'unknown')
    || fastStart || strongFinish || lateFade;
  const isInterval = analysis.structure?.value === 'interval'
    || workout.inferred_tag === 'interval'
    || intervals != null;

  if (isInterval) {
    const intervalRecommendation = demoIntervalRecommendation(
      intent,
      intervals,
      averageRate,
      rateVariable
    );
    if (intervalRecommendation) return intervalRecommendation;
  }

  if (intent === 'steady') {
    if (fastStart) {
      return `For steady work, make the opening slightly slower and settle into a smooth rhythm${averageRate}.`;
    }
    if (faded) {
      return `For steady work, ease the middle pressure a touch so the pace holds all the way through${averageRate}.`;
    }
    if (rateVariable) {
      return `For steady work, keep the pace controlled and reduce stroke-to-stroke rate variation${averageRate}.`;
    }
    const drift = Number(execution.hr_drift?.drift_percent ?? workout.metrics?.hr_drift_pct);
    if (Number.isFinite(drift) && drift > 10) {
      return 'For steady work, ease the pressure slightly so output and heart rate stay better coupled through the back half.';
    }
    if (!hasPacingRead) {
      return `For steady work, keep the opening controlled and settle into a smooth rhythm${averageRate}.`;
    }
    return `For steady work, repeat this pacing pattern and keep the rate smooth${averageRate}.`;
  }
  if (intent === 'hard_distance') {
    if (fastStart && faded) {
      return 'For the next hard-distance row, hold back slightly in the opening so you can sustain pace through the back half.';
    }
    if (faded) {
      return 'The fade suggests the middle sat above sustainable pace, so settle a touch slower after the opening next time.';
    }
    if (strongFinish) {
      return 'This was controlled for a hard-distance effort, so next time bring the middle pace up slightly while preserving the finish.';
    }
    if (!hasPacingRead) {
      return 'For hard-distance work, establish a sustainable opening pace and build the pressure through the final quarter.';
    }
    return 'Pacing control suited a hard-distance effort, so keep the same opening and begin the final press a little earlier.';
  }
  if (intent === 'test_race') {
    if (fastStart && faded) {
      return 'For the next test or race, open slightly slower and protect the target pace through the final quarter.';
    }
    if (faded) {
      return 'For the next test or race, set a slightly more conservative target pace and protect it through the final quarter.';
    }
    if (strongFinish) {
      return 'You finished with capacity in hand, so next time begin the final drive a little earlier.';
    }
    if (!hasPacingRead) {
      return 'For the next test or race, set a sustainable opening pace and plan where the final drive will begin.';
    }
    return 'For the next test or race, keep this pacing control and commit to the final drive before the closing stretch.';
  }
  if (intent === 'recovery') {
    if (['hard', 'very_hard', 'maximal'].includes(execution.intensity?.value)) {
      return `This registered above a recovery effort, so lower the pressure and keep the rate relaxed${averageRate}.`;
    }
    return `For recovery work, keep the pressure light and the stroke rhythm relaxed${averageRate}.`;
  }
  return `For technique work, keep pace secondary and aim to reduce stroke-to-stroke rate variation${averageRate}.`;
}

function demoIntervalRecommendation(intent, intervals, averageRate, rateVariable) {
  if (!intervals) return null;

  const finiteNumber = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const degradation = finiteNumber(intervals.degradation_percent);
  const spread = finiteNumber(intervals.spread_percent);
  const repCount = finiteNumber(intervals.rep_count);
  const fastestIndex = finiteNumber(intervals.fastest_rep_index);
  const wentOutHard = Boolean(intervals.first_rep_fast);
  const fadedAcross = degradation != null && degradation > 1;
  const built = degradation != null && degradation < -1;
  const evenSet = spread != null && spread <= 2;
  const finishedFastest = repCount > 0 && fastestIndex != null
    && fastestIndex === repCount - 1;
  const fastestCameEarlier = repCount > 0
    && fastestIndex != null
    && fastestIndex >= 0
    && fastestIndex < repCount - 1;

  if (intent === 'steady') {
    if (wentOutHard) {
      return `For steady interval work, open the first rep more conservatively and aim for even pace across the set${averageRate}.`;
    }
    if (fadedAcross) {
      return `For steady interval work, target a rep pace you can repeat to the end of the set${averageRate}.`;
    }
    if (rateVariable) {
      return `For steady interval work, keep rep pace controlled and smooth the stroke-to-stroke rate${averageRate}.`;
    }
    return `For steady interval work, keep the reps even and the rhythm smooth${averageRate}.`;
  }

  if (intent === 'hard_distance') {
    if (wentOutHard) {
      return 'For the next hard interval set, hold back on the first rep and protect pace through the final reps.';
    }
    if (fadedAcross) {
      return 'The set faded rep to rep, so start the next hard set at a pace the final reps can hold.';
    }
    if (finishedFastest) {
      return 'You finished the set strongly, so next time bring the early reps slightly closer to that sustainable pace.';
    }
    if (built) {
      return fastestCameEarlier
        ? 'The final rep was quicker than the first, but the fastest work came earlier; next time aim to carry that pace through the finish.'
        : 'The final rep was quicker than the first; next time aim to make that progression more even across the full set.';
    }
    if (evenSet) {
      return 'Rep pacing was controlled for a hard set, so repeat the even opening and press only in the final reps.';
    }
    return 'For the next hard interval set, use the opening reps to establish a pace you can hold through the finish.';
  }

  if (intent === 'test_race') {
    if (wentOutHard) {
      return 'For the next race-specific set, make the first rep more conservative and protect target pace through the finish.';
    }
    if (fadedAcross) {
      return 'For the next race-specific set, pick a rep target the closing reps can hold and commit to it from the start.';
    }
    if (finishedFastest) {
      return 'You had pace in hand late in the set, so next time bring the early reps slightly closer to race pace.';
    }
    if (built) {
      return fastestCameEarlier
        ? 'The final rep was quicker than the first, but the fastest work came earlier; next time aim to carry race pace through the finish.'
        : 'The final rep was quicker than the first; next time aim to make the race-pace progression more even across the full set.';
    }
    return 'For the next race-specific set, keep the rep pacing controlled and commit to target pace in the closing reps.';
  }

  return null;
}

function demoUnknownIntentRecommendation(workout) {
  const analysis = workout.analysis || {};
  const execution = analysis.execution || analysis;
  const pacing = execution.pacing?.value;
  const intervals = analysis.intervals ?? execution.intervals ?? null;
  const isInterval = analysis.structure?.value === 'interval'
    || workout.inferred_tag === 'interval'
    || intervals != null;
  if (isInterval) {
    return 'If this was steady interval work, prioritise even reps and smooth rate. If it was a hard set, judge whether the first rep left enough pace for the finish.';
  }
  const hasPacingRead = intervals != null
    || (pacing != null && pacing !== 'unknown');
  return hasPacingRead
    ? 'If this was steady work, prioritise a smoother, controlled opening. If it was a hard effort, use the pacing pattern to decide whether to start more conservatively or press earlier.'
    : 'If this was steady work, prioritise a smooth, controlled rhythm. If it was a hard effort, establish a sustainable opening pace and plan where to press.';
}

// --- planned-workout overlay (visitor-side plan edits) ---

function getPlanOverlay() {
  return readOverlay(PLAN_OVERLAY_KEY, { created: [], patched: {}, deleted: [] });
}

// Adherence is re-derived at read time (rather than trusted from the
// fixture) so plans don't read as "planned" forever as the deployed demo
// ages past their dates.
function derivePlanAdherence(plan) {
  if (plan.status === 'completed') return 'completed';
  if (plan.status === 'skipped') return 'skipped';
  return plan.date < new Date().toISOString().slice(0, 10) ? 'missed' : 'planned';
}

async function loadDemoPlans() {
  const fixture = await lookupFixture('/api/plans', {});
  const overlay = getPlanOverlay();
  const deleted = new Set(overlay.deleted);
  return [...(fixture.plans || []), ...overlay.created]
    .map(p => ({ ...p, ...(overlay.patched[p.id] || {}) }))
    .filter(p => !deleted.has(p.id))
    .map(p => ({ ...p, adherence: derivePlanAdherence(p) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

async function findDemoPlan(id) {
  const plan = (await loadDemoPlans()).find(p => p.id === id);
  if (!plan) throw new Error('Plan not found');
  return plan;
}

async function findPlanForWorkout(plans, workoutId) {
  const plan = plans.find(p => p.completed_workout_id === workoutId);
  if (!plan) return null;
  let programName = null;
  if (plan.program_id) {
    try {
      const programs = await loadDemoPrograms();
      const program = programs.find(p => p.id === plan.program_id);
      if (program) programName = program.name;
    } catch { /* ignore */ }
  }
  return {
    id: plan.id,
    date: plan.date,
    type: plan.type,
    target_distance: plan.target_distance,
    target_duration_ms: plan.target_duration_ms,
    target_pace_ms: plan.target_pace_ms ?? null,
    target_rate: plan.target_rate ?? null,
    notes: plan.notes ?? null,
    match_type: plan.match_type,
    program_id: plan.program_id || null,
    program_week: plan.program_week ?? null,
    program_name: programName,
  };
}

function patchDemoPlan(id, fields) {
  const overlay = getPlanOverlay();
  overlay.patched[id] = { ...overlay.patched[id], ...fields };
  writeOverlay(PLAN_OVERLAY_KEY, overlay);
}

// --- training-program overlay (visitor-side program management) ---
// Programs live in localStorage like plans; their sessions ARE plan rows
// (program_id/week/slot), so a program mutation edits those plan rows through
// the plan overlay plus this program overlay. Mirrors server/src/routes/
// programs.js so the demo behaves like the real backend.

const PROGRAM_OVERLAY_KEY = 'ergdash-demo-program-overlay';
const DEMO_PROGRAM_ID_FLOOR = 90000;
const DAY_MS = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);

function getProgramOverlay() {
  return readOverlay(PROGRAM_OVERLAY_KEY, { patched: {}, deleted: [], started: [] });
}

function patchDemoProgram(id, fields) {
  const overlay = getProgramOverlay();
  overlay.patched[id] = { ...overlay.patched[id], ...fields };
  writeOverlay(PROGRAM_OVERLAY_KEY, overlay);
}

// Recompute per-week and overall progress from the program's plan sessions,
// matching the server's decorateProgram.
function decorateDemoProgram(program, plans) {
  const today = todayStr();
  const rows = plans.filter(p => p.program_id === program.id);
  const totals = { total: 0, completed: 0, skipped: 0, missed: 0, upcoming: 0 };
  const weekMap = new Map();
  for (const row of rows) {
    const adh = derivePlanAdherence(row);
    totals.total += 1;
    if (adh === 'completed') totals.completed += 1;
    else if (adh === 'skipped') totals.skipped += 1;
    else if (adh === 'missed') totals.missed += 1;
    else totals.upcoming += 1;
    const w = row.program_week;
    if (w == null) continue;
    if (!weekMap.has(w)) {
      weekMap.set(w, { week: w, from: row.date, to: row.date, total: 0, completed: 0, skipped: 0, missed: 0 });
    }
    const wk = weekMap.get(w);
    if (row.date < wk.from) wk.from = row.date;
    if (row.date > wk.to) wk.to = row.date;
    wk.total += 1;
    if (adh === 'completed') wk.completed += 1;
    else if (adh === 'skipped') wk.skipped += 1;
    else if (adh === 'missed') wk.missed += 1;
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.week - b.week);
  let currentWeek = 0;
  for (const wk of weeks) if (today >= wk.from) currentWeek = wk.week;
  currentWeek = Math.min(currentWeek, program.duration_weeks - 1);
  return {
    ...program,
    progress: { current_week: currentWeek, total_weeks: program.duration_weeks, sessions: totals, weeks },
  };
}

async function loadDemoPrograms() {
  const fixture = await lookupFixture('/api/programs', {});
  const overlay = getProgramOverlay();
  const deleted = new Set(overlay.deleted);
  const plans = await loadDemoPlans();
  return [...(fixture.programs || []), ...overlay.started]
    .filter(p => !deleted.has(p.id))
    .map(p => ({ ...p, ...(overlay.patched[p.id] || {}) }))
    .map(p => decorateDemoProgram(p, plans));
}

async function findDemoProgram(id) {
  const program = (await loadDemoPrograms()).find(p => p.id === id);
  if (!program) throw new Error('Program not found');
  return program;
}

// Future, still-planned sessions of a program (the only ones any mutation
// moves or removes - completed/past rows are frozen).
async function futureProgramSessions(id, fromDate = todayStr()) {
  const plans = await loadDemoPlans();
  return plans.filter(p => p.program_id === id && p.status === 'planned' && p.date >= fromDate);
}

async function shiftDemoProgram(id, weeks) {
  await findDemoProgram(id);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) throw new Error('weeks must be between 1 and 8');
  for (const p of await futureProgramSessions(id)) patchDemoPlan(p.id, { date: shiftDate(p.date, weeks) });
  return findDemoProgram(id);
}

async function setDemoProgramStatus(id, status) {
  const program = await findDemoProgram(id);
  if (status === 'paused' && program.status === 'active') {
    patchDemoProgram(id, { status: 'paused', paused_at: todayStr() });
  } else if (status === 'active' && program.status === 'paused') {
    const from = program.paused_at || todayStr();
    const elapsedDays = Math.max(0, (Date.parse(todayStr()) - Date.parse(from)) / DAY_MS);
    const weeks = Math.ceil(elapsedDays / 7);
    if (weeks > 0) {
      for (const p of await futureProgramSessions(id, from)) patchDemoPlan(p.id, { date: shiftDate(p.date, weeks) });
    }
    patchDemoProgram(id, { status: 'active', paused_at: null });
  }
  return findDemoProgram(id);
}

async function remapDemoProgram(id, days) {
  const program = await findDemoProgram(id);
  if (!Array.isArray(days) || days.length !== program.training_days.length
      || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) || new Set(days).size !== days.length) {
    throw new Error(`training_days must be ${program.training_days.length} unique weekdays`);
  }
  const sorted = [...days].sort((a, b) => a - b);
  for (const p of await futureProgramSessions(id)) {
    if (p.program_slot != null) patchDemoPlan(p.id, { date: remapDate(p.date, sorted[p.program_slot]) });
  }
  patchDemoProgram(id, { training_days: sorted });
  return findDemoProgram(id);
}

async function deleteDemoProgram(id) {
  await findDemoProgram(id);
  const today = todayStr();
  const plans = await loadDemoPlans();
  const planOverlay = getPlanOverlay();
  for (const p of plans) {
    if (p.program_id !== id) continue;
    if (p.status === 'planned' && p.date >= today) {
      planOverlay.deleted.push(p.id);
    } else {
      // Survivors stay on the calendar, unlinked (like the server's FK SET NULL).
      planOverlay.patched[p.id] = { ...planOverlay.patched[p.id], program_id: null };
    }
  }
  writeOverlay(PLAN_OVERLAY_KEY, planOverlay);
  const progOverlay = getProgramOverlay();
  progOverlay.deleted.push(id);
  writeOverlay(PROGRAM_OVERLAY_KEY, progOverlay);
  return { ok: true };
}

async function startDemoProgram(body) {
  const presets = (await lookupFixture('/api/programs/presets', {})).presets || [];
  const preset = presets.find(p => p.id === body.preset_id);
  if (!preset) throw new Error('Unknown preset_id');
  const errors = validateProgramInput(preset, body);
  if (errors.length) throw new Error(errors[0]);
  // Match the server's minimum race lead time (routes/programs.js).
  if (preset.kind === 'race') {
    const lead = (Date.parse(body.race_date) - Date.parse(todayStr())) / DAY_MS;
    if (lead < RACE_MIN_LEAD_DAYS) throw new Error(`race_date must be at least ${RACE_MIN_LEAD_DAYS / 7} weeks away`);
  }
  const inProgress = (await loadDemoPrograms()).find(p => p.status === 'active' || p.status === 'paused');
  if (inProgress) throw new Error('A program is already in progress. Delete it before starting another.');

  const trainingDays = [...body.training_days].sort((a, b) => a - b);
  const durationWeeks = resolveDurationWeeks(preset, body.duration_weeks);
  const gen = generateProgramSessions(preset, {
    startDate: body.start_date, trainingDays, durationWeeks, raceDate: body.race_date,
  });

  const planOverlay = getPlanOverlay();
  const progOverlay = getProgramOverlay();
  const programId = Math.max(DEMO_PROGRAM_ID_FLOOR - 1, ...progOverlay.started.map(p => p.id)) + 1;
  let nextPlanId = Math.max(DEMO_PLAN_ID_FLOOR - 1, ...planOverlay.created.map(p => p.id)) + 1;

  for (const s of gen.sessions) {
    const f = deriveIntervalTotals({ ...s });
    planOverlay.created.push({
      id: nextPlanId++, date: s.date, type: s.type,
      target_distance: f.target_distance ?? null, target_duration_ms: f.target_duration_ms ?? null,
      target_pace_ms: s.target_pace_ms ?? null, target_rate: s.target_rate ?? null,
      interval_reps: s.interval_reps ?? null, interval_distance: s.interval_distance ?? null,
      interval_duration_ms: s.interval_duration_ms ?? null, interval_rest_ms: s.interval_rest_ms ?? null,
      notes: s.notes ?? null, completed_workout_id: null, match_type: null, status: 'planned', workout: null,
      program_id: programId, program_week: s.program_week, program_slot: s.program_slot,
    });
  }
  progOverlay.started.push({
    id: programId, preset_id: preset.id, name: preset.name,
    start_date: gen.startDate, duration_weeks: gen.durationWeeks,
    training_days: trainingDays, race_date: body.race_date ?? null,
    status: 'active', paused_at: null, created_at: new Date().toISOString(),
  });
  writeOverlay(PLAN_OVERLAY_KEY, planOverlay);
  writeOverlay(PROGRAM_OVERLAY_KEY, progOverlay);
  return findDemoProgram(programId);
}

// --- request handling ---

function parsePath(path) {
  const [route, query = ''] = path.split('?');
  return { route, params: Object.fromEntries(new URLSearchParams(query)) };
}

async function handleGet(route, params) {
  if (route === '/auth/status') {
    const status = await loadAuthStatus();
    // The capture records the real multi-profile array; synthesize a single
    // profile only if an older fixture lacks one.
    const profiles = status.profiles || [{
      id: 1, name: status.user?.first_name || 'Demo Rower', connected: true, user: status.user || null,
    }];
    return { ...status, profiles };
  }

  if (route === '/api/profiles') {
    const status = await loadAuthStatus();
    return status.profiles || [{
      id: 1, name: status.user?.first_name || 'Demo Rower', connected: true, user: status.user || null,
    }];
  }

  if (route === '/api/settings') {
    const fixture = await lookupFixture(route, {});
    return { ...fixture, ...getSettingsOverlay() };
  }

  if (route === '/api/workouts') {
    const all = await loadFixture((await loadManifest())['/api/workouts']);
    const plans = await loadDemoPlans();
    const workouts = await Promise.all(all.data.map(async w => {
      const patched = applyWorkoutOverlay(w);
      return { ...patched, plan: await findPlanForWorkout(plans, patched.id) };
    }));
    return filterWorkouts(workouts, params);
  }

  const candidatesMatch = route.match(/^\/api\/workouts\/(\d+)\/comparison-candidates$/);
  if (candidatesMatch) {
    const scope = params.scope === 'all' ? 'all' : 'recommended';
    const response = await fetch(await fixtureUrl(`comparison-candidates/${candidatesMatch[1]}-${scope}.json`));
    if (!response.ok) throw new Error('Comparison workouts not found');
    const fixture = await response.json();
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const offset = Math.max(0, Number(params.offset) || 0);
    return { data: fixture.data.slice(offset, offset + limit), meta: { total: fixture.data.length, limit, offset } };
  }

  const workoutMatch = route.match(/^\/api\/workouts\/(\d+)$/);
  if (workoutMatch) {
    const id = workoutMatch[1];
    const detail = await fetch(await fixtureUrl(`workout/${id}.json`)).then(r => {
      if (!r.ok) throw new Error('Workout not found');
      return r.json();
    });
    const patched = applyWorkoutOverlay(detail);
    const plans = await loadDemoPlans();
    const plan = await findPlanForWorkout(plans, patched.id);
    return applyDemoNarrativeContext({ ...patched, plan }, plan);
  }

  if (route === '/api/stats/compare') {
    const ids = (params.ids || '').split(',');
    if (ids.length !== 2) throw new Error('Provide exactly 2 workout IDs');
    const [a, b] = await Promise.all(ids.map(async id =>
      fetch(await fixtureUrl(`compare/${id}.json`)).then(r => {
        if (!r.ok) throw new Error('Workout not found');
        return r.json();
      })
    ));
    return { workouts: [a, b], comparison_match: demoComparisonMatch(a, b) };
  }

  // Goals/predictions/adherence are served straight from their fixtures by
  // the default lookup below; plans get overlay merging + range filtering.
  if (route === '/api/plans') {
    let plans = await loadDemoPlans();
    if (params.from) plans = plans.filter(p => p.date >= params.from.slice(0, 10));
    if (params.to) plans = plans.filter(p => p.date < params.to.slice(0, 10));
    return { plans };
  }

  if (route === '/api/programs') {
    return { programs: await loadDemoPrograms() };
  }

  if (route === '/api/stats/calendar' && (params.from || params.to)) {
    const fixture = await lookupFixture(route, {});
    let days = fixture.days;
    if (params.from) days = days.filter(d => d.date >= params.from);
    if (params.to) days = days.filter(d => d.date < params.to);
    return { days };
  }

  if (route === '/api/stats/pb-history' && params.since) {
    // Apply "since" client-side: the PB banner passes pb_last_seen_at (a
    // timestamp after the seeded batch, so it filters to nothing once
    // dismissed) while the PB Progression chart passes the time-range start
    // and needs the events inside that window.
    const fixture = await lookupFixture(route, {});
    const rows = fixture.pb_history || [];
    return { pb_history: rows.filter(r => r.achieved_at > params.since) };
  }

  return lookupFixture(route, params);
}

function filterWorkouts(rows, params) {
  let result = rows;
  if (params.from) result = result.filter(w => w.date >= params.from);
  if (params.to) result = result.filter(w => w.date <= params.to);
  if (params.type) result = result.filter(w => w.type === params.type);
  if (params.tag) {
    const tag = params.tag === 'interval' ? 'interval' : 'endurance';
    result = result.filter(w => w.inferred_tag === tag);
  }
  if (params.min_distance) result = result.filter(w => w.distance >= Number(params.min_distance));
  if (params.max_distance) result = result.filter(w => w.distance <= Number(params.max_distance));
  if (['1', 'true'].includes(String(params.pinned).toLowerCase())) {
    result = result.filter(w => w.pinned);
  }
  if (params.q) {
    const needle = params.q.toLowerCase();
    result = result.filter(w =>
      (w.notes || '').toLowerCase().includes(needle) ||
      (w.comments || '').toLowerCase().includes(needle)
    );
  }

  const sortFns = {
    date_desc: (a, b) => b.date.localeCompare(a.date),
    date_asc: (a, b) => a.date.localeCompare(b.date),
    distance_desc: (a, b) => b.distance - a.distance,
    distance_asc: (a, b) => a.distance - b.distance,
    pace_asc: (a, b) => (a.pace_ms || 0) - (b.pace_ms || 0),
    pace_desc: (a, b) => (b.pace_ms || 0) - (a.pace_ms || 0),
    time_desc: (a, b) => b.time_ms - a.time_ms,
  };
  result = [...result].sort(sortFns[params.sort] || sortFns.date_desc);

  const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
  const offset = Math.max(0, Number(params.offset) || 0);
  const page = result.slice(offset, offset + limit);

  const totals = result.reduce((acc, w) => {
    acc.distance += w.distance;
    acc.time_ms += w.time_ms;
    return acc;
  }, { distance: 0, time_ms: 0 });
  const paced = result.filter(w => w.pace_ms);
  const avgPace = paced.length
    ? Math.round(paced.reduce((s, w) => s + w.pace_ms, 0) / paced.length)
    : null;

  return {
    data: page,
    meta: {
      total: result.length,
      limit,
      offset,
      totals: { distance: totals.distance, time_ms: totals.time_ms, avg_pace_ms: avgPace },
    },
  };
}

async function handlePatch(route, body) {
  const planMatch = route.match(/^\/api\/plans\/(\d+)$/);
  if (planMatch) {
    const id = Number(planMatch[1]);
    const plan = await findDemoPlan(id);
    const fields = { ...body };
    // Mirror the server: reverting a completed plan, or moving it to a
    // date its workout wasn't rowed on, drops the workout link.
    const dateMoved = fields.date && fields.date !== plan.date
      && plan.workout && String(plan.workout.date).slice(0, 10) !== fields.date;
    if ((fields.status && plan.status === 'completed') || dateMoved) {
      fields.completed_workout_id = null;
      fields.match_type = null;
      fields.workout = null;
      if (dateMoved && !fields.status) fields.status = 'planned';
    }
    patchDemoPlan(id, fields);
    return findDemoPlan(id);
  }

  if (route.startsWith('/api/goals')) {
    throw new Error('Demo mode - goals are read-only in the live demo');
  }

  const programMatch = route.match(/^\/api\/programs\/(\d+)$/);
  if (programMatch) {
    const id = Number(programMatch[1]);
    if (body.status !== undefined) return setDemoProgramStatus(id, body.status);
    if (body.training_days !== undefined) return remapDemoProgram(id, body.training_days);
    throw new Error('No supported fields (status or training_days)');
  }

  if (route === '/api/settings') {
    const overlay = getSettingsOverlay();
    const next = { ...overlay };
    for (const [k, v] of Object.entries(body)) next[k] = String(v);
    writeOverlay(SETTINGS_OVERLAY_KEY, next);
    return next;
  }

  const workoutMatch = route.match(/^\/api\/workouts\/(\d+)$/);
  if (workoutMatch) {
    const id = workoutMatch[1];
    const patch = {};
    if ('pinned' in body) patch.pinned = !!body.pinned;
    if ('notes' in body) patch.notes = body.notes;
    if ('intent' in body) {
      const intents = ['steady', 'hard_distance', 'test_race', 'recovery', 'technique'];
      if (body.intent != null && !intents.includes(body.intent)) throw new Error('Invalid workout intent');
      patch.intent = body.intent;
    }
    const merged = setWorkoutOverlay(id, patch);
    const detail = await fetch(await fixtureUrl(`workout/${id}.json`)).then(r => r.json());
    const patched = applyWorkoutOverlay({ ...detail, ...merged });
    const plan = await findPlanForWorkout(await loadDemoPlans(), patched.id);
    return applyDemoNarrativeContext({ ...patched, plan }, plan);
  }

  throw new Error('Demo mode - this action is not available in the live demo');
}

export async function demoRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const { route, params } = parsePath(path);

  if (method === 'GET') {
    return handleGet(route, params);
  }

  if (method === 'PATCH') {
    const body = options.body ? JSON.parse(options.body) : {};
    return handlePatch(route, body);
  }

  if (method === 'POST') {
    if (route === '/api/settings/reset') {
      writeOverlay(SETTINGS_OVERLAY_KEY, {});
      return { ok: true };
    }
    if (route === '/auth/logout') {
      return { ok: true };
    }
    if (/^\/api\/workouts\/\d+\/enrich$/.test(route)) {
      return { ok: true };
    }
    if (route === '/api/plans') {
      const body = options.body ? JSON.parse(options.body) : {};
      return createDemoPlan(body);
    }
    const matchRoute = route.match(/^\/api\/plans\/(\d+)\/match$/);
    if (matchRoute) {
      const body = options.body ? JSON.parse(options.body) : {};
      return matchDemoPlan(Number(matchRoute[1]), Number(body.workout_id));
    }
    if (route === '/api/programs') {
      return startDemoProgram(options.body ? JSON.parse(options.body) : {});
    }
    const shiftRoute = route.match(/^\/api\/programs\/(\d+)\/shift$/);
    if (shiftRoute) {
      const body = options.body ? JSON.parse(options.body) : {};
      return shiftDemoProgram(Number(shiftRoute[1]), Number(body.weeks));
    }
    if (route.startsWith('/api/goals')) {
      throw new Error('Demo mode - goals are read-only in the live demo');
    }
    throw new Error('Demo mode - run ErgDash self-hosted to connect your own Concept2 account');
  }

  if (method === 'DELETE') {
    const matchRoute = route.match(/^\/api\/plans\/(\d+)\/match$/);
    if (matchRoute) {
      const id = Number(matchRoute[1]);
      await findDemoPlan(id);
      patchDemoPlan(id, {
        completed_workout_id: null, match_type: null, workout: null, status: 'planned',
      });
      return findDemoPlan(id);
    }
    const planRoute = route.match(/^\/api\/plans\/(\d+)$/);
    if (planRoute) {
      const id = Number(planRoute[1]);
      await findDemoPlan(id);
      const overlay = getPlanOverlay();
      overlay.deleted.push(id);
      writeOverlay(PLAN_OVERLAY_KEY, overlay);
      return { ok: true };
    }
    const programRoute = route.match(/^\/api\/programs\/(\d+)$/);
    if (programRoute) {
      return deleteDemoProgram(Number(programRoute[1]));
    }
    if (route.startsWith('/api/goals')) {
      throw new Error('Demo mode - goals are read-only in the live demo');
    }
  }

  throw new Error(`Demo mode - unsupported request: ${method} ${path}`);
}

async function createDemoPlan(body) {
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw new Error('date must be an ISO 8601 date (YYYY-MM-DD)');
  }
  if (body.target_distance == null && body.target_duration_ms == null) {
    throw new Error('Provide target_distance or target_duration_ms');
  }

  const overlay = getPlanOverlay();
  const repeatWeeks = Number.isInteger(body.repeat_weeks) ? Math.min(25, Math.max(0, body.repeat_weeks)) : 0;
  const plans = [];
  for (let week = 0; week <= repeatWeeks; week++) {
    const maxId = Math.max(DEMO_PLAN_ID_FLOOR - 1, ...overlay.created.map(p => p.id));
    const plan = {
      id: maxId + 1,
      date: new Date(Date.parse(body.date) + week * 7 * 86400000).toISOString().slice(0, 10),
      type: body.type || 'steady',
      target_distance: body.target_distance ?? null,
      target_duration_ms: body.target_duration_ms ?? null,
      target_pace_ms: body.target_pace_ms ?? null,
      target_rate: body.target_rate ?? null,
      interval_reps: body.interval_reps ?? null,
      interval_distance: body.interval_distance ?? null,
      interval_duration_ms: body.interval_duration_ms ?? null,
      interval_rest_ms: body.interval_rest_ms ?? null,
      notes: body.notes ?? null,
      completed_workout_id: null,
      match_type: null,
      status: 'planned',
      workout: null,
    };
    overlay.created.push(plan);
    plans.push(plan);
  }
  writeOverlay(PLAN_OVERLAY_KEY, overlay);
  return { ...plans[0], adherence: derivePlanAdherence(plans[0]), created_count: plans.length };
}

async function matchDemoPlan(planId, workoutId) {
  const plan = await findDemoPlan(planId);
  const all = await loadFixture((await loadManifest())['/api/workouts']);
  const workout = (all.data || []).find(w => w.id === workoutId);
  if (!workout) throw new Error('Workout not found');
  if (String(workout.date).slice(0, 10) !== plan.date) {
    throw new Error(`Workout is not on the plan date (${plan.date})`);
  }
  patchDemoPlan(planId, {
    completed_workout_id: workout.id,
    match_type: 'manual',
    status: 'completed',
    workout: {
      id: workout.id,
      date: workout.date,
      distance: workout.distance,
      time_ms: workout.time_ms,
      pace_ms: workout.pace_ms,
    },
  });
  return findDemoPlan(planId);
}

function demoComparisonMatch(a, b) {
  const sameTag = a.inferred_tag === b.inferred_tag;
  const sameIntervals = a.inferred_tag === 'interval' && b.inferred_tag === 'interval'
    && (a.intervals || []).filter(interval => interval.type !== 'rest').length === (b.intervals || []).filter(interval => interval.type !== 'rest').length;
  const distanceDifference = Math.abs((a.distance || 0) - (b.distance || 0)) / Math.max(1, a.distance || 0, b.distance || 0);
  if (sameTag && (sameIntervals || distanceDifference <= 0.01)) {
    return { level: 'exact', reason: sameIntervals ? 'Same interval structure' : 'Same distance', axis: 'distance' };
  }
  if (sameTag && distanceDifference <= 0.05) return { level: 'close', reason: 'Similar distance', axis: 'percent' };
  return { level: 'other', reason: sameTag ? 'Different workout format' : 'Different workout category', axis: 'percent' };
}
