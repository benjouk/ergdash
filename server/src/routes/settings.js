import { Router } from 'express';
import { getDb, seedDefaults } from '../db.js';
import { recomputeAllZoneTimes } from '../analytics.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const { key, value } of rows) {
    settings[key] = value;
  }
  res.json(settings);
});

const ENUMS = {
  theme: ['system', 'light', 'dark'],
  units: ['pace', 'watts', 'calhr'],
  time_range: ['30d', '90d', 'season', 'last_season', 'all'],
  week_start: ['monday', 'sunday'],
  date_format: ['day-month', 'month-day'],
};

function parseNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validateJsonArray(value, key, validator) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return { error: `${key} must be valid JSON` };
  }
  if (!Array.isArray(parsed) || !validator(parsed)) {
    return { error: `${key} has an invalid shape` };
  }
  return { value: JSON.stringify(parsed) };
}

function validateSetting(key, value) {
  if (ENUMS[key]) {
    if (!ENUMS[key].includes(String(value))) return { error: `${key} must be one of: ${ENUMS[key].join(', ')}` };
    return { value: String(value) };
  }

  if (key === 'sync_interval') {
    const n = parseNumber(value);
    if (!Number.isInteger(n) || n < 5 || n > 1440) return { error: 'sync_interval must be an integer between 5 and 1440' };
    return { value: String(n) };
  }

  if (key === 'rate_band_tolerance') {
    const n = parseNumber(value);
    if (!Number.isFinite(n) || n < 0 || n > 10) return { error: 'rate_band_tolerance must be a number between 0 and 10' };
    return { value: String(n) };
  }

  if (key === 'max_hr') {
    const n = parseNumber(value);
    if (!Number.isInteger(n) || n < 80 || n > 240) return { error: 'max_hr must be an integer between 80 and 240' };
    return { value: String(n) };
  }

  if (key === 'weight_kg') {
    if (value === '' || value == null) return { value: '' };
    const n = parseNumber(value);
    if (!Number.isFinite(n) || n < 20 || n > 300) return { error: 'weight_kg must be a number between 20 and 300' };
    return { value: String(n) };
  }

  if (key === 'feed_limit') {
    const n = parseNumber(value);
    if (!Number.isInteger(n) || n < 5 || n > 200) return { error: 'feed_limit must be an integer between 5 and 200' };
    return { value: String(n) };
  }

  if (key === 'default_landing') {
    const route = String(value);
    if (!/^\/[a-z0-9/_-]*$/i.test(route) || route.startsWith('//') || route.length > 100) {
      return { error: 'default_landing must be an app-local route' };
    }
    return { value: route };
  }

  if (key === 'pb_last_seen_at') {
    if (value === '' || value == null) return { value: '' };
    if (Number.isNaN(new Date(String(value)).getTime())) return { error: 'pb_last_seen_at must be an ISO date/time' };
    return { value: String(value) };
  }

  if (key === 'hr_zones') {
    return validateJsonArray(value, key, zones => zones.length === 5
      && zones.every(z => Number.isFinite(z) && z > 0 && z <= 100)
      && zones.every((z, i) => i === 0 || z > zones[i - 1]));
  }

  if (key === 'progress_layout') {
    return validateJsonArray(value, key, items => items.length <= 50 && items.every(item => (
      (typeof item === 'string' && /^[a-z0-9_-]+$/i.test(item))
      || (item && typeof item === 'object' && typeof item.id === 'string' && /^[a-z0-9_-]+$/i.test(item.id))
    )));
  }

  return { error: `Unsupported setting: ${key}` };
}

router.patch('/', (req, res) => {
  const db = getDb();
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  );

  const updates = {};
  const errors = [];

  for (const [key, value] of Object.entries(req.body || {})) {
    const result = validateSetting(key, value);
    if (result.error) {
      errors.push(result.error);
    } else {
      updates[key] = result.value;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      upsert.run(key, value);
    }
  })();

  // Zone-model edits invalidate all cached zone times; the dataset is small
  // enough (single user) to recompute synchronously.
  if ('max_hr' in updates || 'hr_zones' in updates) {
    recomputeAllZoneTimes();
  }

  res.json(updates);
});

router.post('/reset', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM settings').run();
  seedDefaults(db);
  res.json({ ok: true });
});

export default router;
