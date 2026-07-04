// Demo-mode API shim. Serves build-time-captured fixtures (see
// scripts/build-demo-data.mjs) instead of hitting a real backend, so the
// live demo can run as a static site while staying byte-for-byte in sync
// with whatever the real API currently returns.
import { computeDateRange } from './utils/timeRange.js';

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

  if (route === '/api/stats/calendar' && params.from) {
    const fixture = await lookupFixture(route, {});
    const cutoff = params.from;
    return { days: fixture.days.filter(d => d.date >= cutoff) };
  }

  if (route === '/api/stats/pb-history' && params.since) {
    // Demo PB history is a single seeded batch; treat any "since" as
    // already-seen so the banner shows once per fixture then dismisses.
    return { pb_history: [] };
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
    throw new Error('Demo mode — run ErgDash self-hosted to connect your own Concept2 account');
  }

  throw new Error(`Demo mode — unsupported request: ${method} ${path}`);
}
