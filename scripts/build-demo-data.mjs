#!/usr/bin/env node
// Boots the real server against freshly-seeded data and captures its real
// API responses as JSON fixtures for the static demo build. Runs at every
// Cloudflare Pages build so the demo tracks whatever the app currently does.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'client', 'public', 'demo-data');
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

const RANGE_PRESETS = ['30d', '90d', 'season', 'last_season', 'all'];
const TREND_METRICS = [
  'volume', 'pace', 'rate', 'consistency', 'dps',
  'watts_per_beat', 'hr_drift', 'rate_discipline', 'drag', 'effort',
];

function computeDateRange(key) {
  const now = new Date();
  if (key === '30d') {
    return { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: null };
  }
  if (key === '90d') {
    return { from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to: null };
  }
  if (key === 'season') {
    const seasonStart = now.getMonth() >= 4
      ? `${now.getFullYear()}-05-01`
      : `${now.getFullYear() - 1}-05-01`;
    return { from: seasonStart, to: null };
  }
  if (key === 'last_season') {
    const thisSeasonStart = now.getMonth() >= 4
      ? `${now.getFullYear()}-05-01`
      : `${now.getFullYear() - 1}-05-01`;
    const lastSeasonStart = `${parseInt(thisSeasonStart) - 1}-05-01`;
    return { from: lastSeasonStart, to: thisSeasonStart };
  }
  return { from: null, to: null };
}

function rangeParams(key) {
  const { from, to } = computeDateRange(key);
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  return params;
}

function manifestKey(path, params = {}, rangeKey = null) {
  const sortedKeys = Object.keys(params).filter(k => k !== 'from' && k !== 'to').sort();
  const parts = sortedKeys.map(k => `${k}=${params[k]}`);
  if (rangeKey) parts.unshift(`range=${rangeKey}`);
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

const manifest = {};
let fileCounter = 0;

function slugFor(path) {
  return path.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
}

async function fetchJson(path, params = {}) {
  const qs = new URLSearchParams(params);
  const url = qs.toString() ? `${BASE}${path}?${qs}` : `${BASE}${path}`;
  const res = await fetch(url, { headers: { Cookie: cookieHeader } });
  if (!res.ok) {
    throw new Error(`Capture failed: GET ${path} (params=${JSON.stringify(params)}) -> ${res.status}`);
  }
  return res.json();
}

async function capture(path, params = {}, rangeKey = null) {
  const data = await fetchJson(path, params);
  const key = manifestKey(path, params, rangeKey);
  const file = `f${fileCounter++}_${slugFor(path)}.json`;
  writeFileSync(join(outDir, file), JSON.stringify(data));
  manifest[key] = file;
  return data;
}

let cookieHeader = '';

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Server did not become healthy in time');
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const dataDir = mkdtempSync(join(tmpdir(), 'ergdash-demo-'));

  const server = spawn('node', ['server.js'], {
    cwd: join(repoRoot, 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ERGDASH_SEED_DEMO: '1',
      PORT: String(PORT),
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let exited = false;
  server.on('exit', () => { exited = true; });

  const cleanup = () => {
    if (!exited) server.kill();
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    await waitForHealth();

    // Establish a mock-authenticated session; capture its Set-Cookie for
    // all subsequent requests.
    const loginRes = await fetch(`${BASE}/auth/mock-login`, { redirect: 'manual' });
    const setCookie = loginRes.headers.get('set-cookie');
    if (!setCookie) throw new Error('mock-login did not return a session cookie');
    cookieHeader = setCookie.split(';')[0];

    await capture('/auth/status');
    await capture('/api/settings');
    await capture('/api/sync/status');
    await capture('/api/insights/weekly');
    await capture('/api/stats/cumulative');
    await capture('/api/stats/power-curve');
    await capture('/api/stats/pb-history');
    await capture('/api/stats/predictions');
    await capture('/api/goals');
    await capture('/api/plans');
    await capture('/api/plans/adherence', { weeks: 12 });
    await capture('/api/programs/presets');
    await capture('/api/programs');

    const calendarFrom = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    await capture('/api/stats/calendar', { from: calendarFrom });

    for (const rangeKey of RANGE_PRESETS) {
      const params = rangeParams(rangeKey);
      await capture('/api/stats/summary', params, rangeKey);
      await capture('/api/stats/personal-bests', params, rangeKey);
      await capture('/api/stats/fitness', params, rangeKey);
      await capture('/api/stats/zones', { ...params, group: 'week' }, rangeKey);
      await capture('/api/stats/polarization', params, rangeKey);
      await capture('/api/stats/pb-history', params, rangeKey);
      for (const metric of TREND_METRICS) {
        await capture('/api/stats/trends', { ...params, metric, period: 'all' }, rangeKey);
      }
    }

    // Workouts list: fetch both pages the 100-row cap allows, merge.
    const page1 = await fetchJson('/api/workouts', { limit: '100', offset: '0' });
    const page2 = await fetchJson('/api/workouts', { limit: '100', offset: '100' });
    const allWorkouts = [...page1.data, ...(page2.data || [])];
    const workoutsPayload = {
      data: allWorkouts,
      meta: { ...page1.meta, total: allWorkouts.length, limit: allWorkouts.length, offset: 0 },
    };
    writeFileSync(join(outDir, 'workouts.json'), JSON.stringify(workoutsPayload));
    manifest['/api/workouts'] = 'workouts.json';

    // Full detail for every captured workout.
    mkdirSync(join(outDir, 'workout'), { recursive: true });
    for (const w of allWorkouts) {
      const detail = await fetchJson(`/api/workouts/${w.id}`);
      writeFileSync(join(outDir, 'workout', `${w.id}.json`), JSON.stringify(detail));
    }

    // Compare: capture sequential pairs so the shim can assemble any two.
    mkdirSync(join(outDir, 'compare'), { recursive: true });
    const sortedIds = allWorkouts.map(w => w.id).sort((a, b) => a - b);
    for (let i = 0; i < sortedIds.length - 1; i++) {
      const a = sortedIds[i];
      const b = sortedIds[i + 1];
      const result = await fetchJson('/api/stats/compare', { ids: `${a},${b}` });
      const [wa, wb] = result.workouts;
      writeFileSync(join(outDir, 'compare', `${a}.json`), JSON.stringify(wa));
      // Ensure the final id in the sequence is also covered as a "left" side.
      if (i === sortedIds.length - 2) {
        writeFileSync(join(outDir, 'compare', `${b}.json`), JSON.stringify(wb));
      }
    }

    // Decay-curve: FadeFingerprint.jsx queries the most recent workout at
    // each of these fixed distances, independently — not a single "latest".
    for (const distance of [2000, 5000, 10000]) {
      const workout = [...allWorkouts]
        .filter(w => w.distance === distance)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (workout) {
        await capture('/api/stats/decay-curve', { distance, workout_id: workout.id });
      }
    }

    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`Demo data captured: ${Object.keys(manifest).length} fixtures, ${allWorkouts.length} workouts.`);
  } finally {
    cleanup();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
