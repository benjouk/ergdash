// Demo-mode API shim. Serves build-time-captured fixtures (see
// scripts/build-demo-data.mjs) instead of hitting a real backend, so the
// live demo can run as a static site while staying byte-for-byte in sync
// with whatever the real API currently returns.
import { computeDateRange } from './utils/timeRange.js';
import {
  generateProgramSessions, resolveDurationWeeks, deriveIntervalTotals,
  validateProgramInput, shiftDate, remapDate,
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

let manifestPromise = null;
const fixtureCache = new Map();

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}demo-data/manifest.json`).then(r => r.json());
  }
  return manifestPromise;
}

async function loadFixture(file) {
  if (fixtureCache.has(file)) return fixtureCache.get(file);
  const data = await fetch(`${BASE}demo-data/${file}`).then(r => r.json());
  fixtureCache.set(file, data);
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
  return Object.keys(overlay).length ? { ...workout, ...overlay } : workout;
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
// moves or removes — completed/past rows are frozen).
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
    const fixture = await lookupFixture(route, {});
    return fixture;
  }

  if (route === '/api/settings') {
    const fixture = await lookupFixture(route, {});
    return { ...fixture, ...getSettingsOverlay() };
  }

  if (route === '/api/workouts') {
    const all = await loadFixture((await loadManifest())['/api/workouts']);
    return filterWorkouts(all.data.map(applyWorkoutOverlay), params);
  }

  const workoutMatch = route.match(/^\/api\/workouts\/(\d+)$/);
  if (workoutMatch) {
    const id = workoutMatch[1];
    const detail = await fetch(`${BASE}demo-data/workout/${id}.json`).then(r => {
      if (!r.ok) throw new Error('Workout not found');
      return r.json();
    });
    return applyWorkoutOverlay(detail);
  }

  if (route === '/api/stats/compare') {
    const ids = (params.ids || '').split(',');
    if (ids.length !== 2) throw new Error('Provide exactly 2 workout IDs');
    const [a, b] = await Promise.all(ids.map(id =>
      fetch(`${BASE}demo-data/compare/${id}.json`).then(r => {
        if (!r.ok) throw new Error('Workout not found');
        return r.json();
      })
    ));
    return { workouts: [a, b] };
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
    throw new Error('Demo mode — goals are read-only in the live demo');
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
    const merged = setWorkoutOverlay(id, patch);
    const detail = await fetch(`${BASE}demo-data/workout/${id}.json`).then(r => r.json());
    return applyWorkoutOverlay({ ...detail, ...merged });
  }

  throw new Error('Demo mode — this action is not available in the live demo');
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
      throw new Error('Demo mode — goals are read-only in the live demo');
    }
    throw new Error('Demo mode — run ErgDash self-hosted to connect your own Concept2 account');
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
      throw new Error('Demo mode — goals are read-only in the live demo');
    }
  }

  throw new Error(`Demo mode — unsupported request: ${method} ${path}`);
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
