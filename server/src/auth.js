import crypto from 'crypto';
import { getDb, seedDefaultSettings } from './db.js';

const C2_API_BASE = process.env.C2_API_BASE || 'https://log.concept2.com';
const C2_CLIENT_ID = process.env.C2_CLIENT_ID || '';
const C2_CLIENT_SECRET = process.env.C2_CLIENT_SECRET || '';
const C2_REDIRECT_URI = process.env.C2_REDIRECT_URI || 'http://localhost:3100/auth/callback';
const AUTH_COOKIE = 'ergdash_session';
const ENCRYPTED_PREFIX = 'enc:v1:';

const WEAK_SESSION_SECRETS = new Set(['change-me-in-production', 'changeme', 'secret']);

function initSessionSecret() {
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.SESSION_SECRET || '';
    if (!secret || secret.length < 16 || WEAK_SESSION_SECRETS.has(secret)) {
      throw new Error('SESSION_SECRET environment variable must be set to a strong value in production. Generate with: openssl rand -base64 32');
    }
    return secret;
  }
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  const db = getDb();
  let secret = db.prepare("SELECT value FROM sync_state WHERE key = 'generated_session_secret'").get()?.value;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64');
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('generated_session_secret', ?, datetime('now'))").run(secret);
  }
  return secret;
}

let SESSION_SECRET;
export function initAuth() {
  SESSION_SECRET = initSessionSecret();
}

function upsertSyncState(key, value) {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(key, value);
}

function secretKey() {
  return crypto.createHash('sha256').update(SESSION_SECRET).digest();
}

function encryptSecret(value) {
  if (!value) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

function decryptSecret(value) {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  const payload = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64url');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function signToken(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('base64url');
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function useSecureCookies() {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return C2_REDIRECT_URI.startsWith('https://');
}

function cookieOptions(maxAgeSeconds) {
  const parts = [
    `Path=/`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (useSecureCookies()) parts.push('Secure');
  return parts.join('; ');
}

const OAUTH_STATE_TTL_MINUTES = 10;

export function pruneExpiredOauthStates() {
  getDb().prepare(
    `DELETE FROM sync_state WHERE key LIKE 'oauth_state:%' AND updated_at < datetime('now', '-${OAUTH_STATE_TTL_MINUTES} minutes')`
  ).run();
}

// intent: { profileId } to reconnect an existing profile, { newName } to
// create one from the connecting account. Stored per-state so concurrent
// connect flows don't clobber each other.
export function getAuthorizationUrl(intent = {}) {
  const state = crypto.randomBytes(16).toString('hex');
  pruneExpiredOauthStates();
  upsertSyncState(`oauth_state:${state}`, JSON.stringify(intent));

  const params = new URLSearchParams({
    client_id: C2_CLIENT_ID,
    redirect_uri: C2_REDIRECT_URI,
    response_type: 'code',
    scope: 'user:read,results:read',
    state,
  });
  return `${C2_API_BASE}/oauth/authorize?${params}`;
}

export async function exchangeCodeForTokens(code) {
  const resp = await fetch(`${C2_API_BASE}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: C2_CLIENT_ID,
      client_secret: C2_CLIENT_SECRET,
      redirect_uri: C2_REDIRECT_URI,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

export async function refreshAccessToken(refreshToken) {
  const resp = await fetch(`${C2_API_BASE}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: C2_CLIENT_ID,
      client_secret: C2_CLIENT_SECRET,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${resp.status}`);
  }
  return resp.json();
}

export function consumeOauthState(state) {
  if (!state || !/^[0-9a-f]{32}$/.test(state)) return null;
  const db = getDb();
  pruneExpiredOauthStates();
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(`oauth_state:${state}`);
  if (!row) return null;
  db.prepare('DELETE FROM sync_state WHERE key = ?').run(`oauth_state:${state}`);
  try {
    return JSON.parse(row.value) || {};
  } catch {
    return {};
  }
}

export function storeTokens(profileId, tokens) {
  const db = getDb();
  db.transaction(() => {
    if (tokens.access_token) {
      db.prepare('UPDATE profiles SET access_token = ? WHERE id = ?')
        .run(encryptSecret(tokens.access_token), profileId);
    }
    if (tokens.refresh_token) {
      db.prepare('UPDATE profiles SET refresh_token = ? WHERE id = ?')
        .run(encryptSecret(tokens.refresh_token), profileId);
    }
    db.prepare('UPDATE profiles SET token_expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(), profileId);
  })();
}

export async function getValidToken(profileId) {
  const db = getDb();
  const profile = db.prepare(
    'SELECT access_token, refresh_token, token_expires_at FROM profiles WHERE id = ?'
  ).get(profileId);

  if (!profile?.access_token) return null;

  const accessToken = decryptSecret(profile.access_token);
  const refreshToken = decryptSecret(profile.refresh_token);
  const expiresAt = new Date(profile.token_expires_at || 0);
  if (expiresAt < new Date(Date.now() + 5 * 60 * 1000) && refreshToken) {
    try {
      const newTokens = await refreshAccessToken(refreshToken);
      storeTokens(profileId, newTokens);
      return newTokens.access_token;
    } catch {
      return accessToken;
    }
  }

  return accessToken;
}

export async function fetchC2Api(path, accessToken) {
  const resp = await fetch(`${C2_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 401) {
    throw new Error('TOKEN_EXPIRED');
  }
  if (!resp.ok) {
    throw new Error(`C2 API error: ${resp.status} on ${path}`);
  }
  return resp.json();
}

export function hasConnectedProfile() {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM profiles WHERE access_token IS NOT NULL LIMIT 1').get();
  return !!row;
}

export function isProfileConnected(profileId) {
  const row = getDb()
    .prepare('SELECT 1 FROM profiles WHERE id = ? AND access_token IS NOT NULL')
    .get(profileId);
  return !!row;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createAuthSession(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const signed = `${token}.${signToken(token)}`;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  db.prepare(
    "INSERT INTO sessions (token_hash, expires_at) VALUES (?, datetime('now', ?))"
  ).run(hashToken(token), `+${SESSION_TTL_SECONDS} seconds`);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(signed)}; ${cookieOptions(SESSION_TTL_SECONDS)}`);
}

function sessionTokenFromRequest(req) {
  const cookie = readCookie(req, AUTH_COOKIE);
  if (!cookie) return null;

  const [token, signature] = cookie.split('.');
  if (!token || !signature || !timingSafeEqual(signature, signToken(token))) {
    return null;
  }
  return token;
}

export function hasValidSession(req) {
  const token = sessionTokenFromRequest(req);
  if (!token) return false;

  const db = getDb();
  const row = db.prepare(
    "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at >= datetime('now')"
  ).get(hashToken(token));
  return !!row;
}

export function clearAuthSession(req, res) {
  const token = sessionTokenFromRequest(req);
  if (token) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; ${cookieOptions(0)}`);
}

export function getUserInfo(profileId) {
  const db = getDb();
  const row = db.prepare('SELECT user_info FROM profiles WHERE id = ?').get(profileId);
  return row?.user_info ? JSON.parse(row.user_info) : null;
}

// Disconnects a profile from Concept2. Data and the browser session are kept.
export function clearAuth(profileId) {
  getDb().prepare(
    'UPDATE profiles SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL, user_info = NULL WHERE id = ?'
  ).run(profileId);
}

export function listProfiles() {
  const db = getDb();
  return db.prepare(
    'SELECT id, name, c2_user_id, user_info, access_token IS NOT NULL AS connected FROM profiles ORDER BY id'
  ).all().map((row) => ({
    id: row.id,
    name: row.name,
    connected: !!row.connected,
    user: row.user_info ? JSON.parse(row.user_info) : null,
  }));
}

export function getProfile(profileId) {
  return getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) || null;
}

export function getProfileByC2UserId(c2UserId) {
  if (c2UserId == null) return null;
  return getDb().prepare('SELECT * FROM profiles WHERE c2_user_id = ?').get(c2UserId) || null;
}

export function createProfile(name) {
  const db = getDb();
  const { lastInsertRowid } = db.prepare('INSERT INTO profiles (name) VALUES (?)')
    .run(String(name || 'Athlete').slice(0, 60));
  seedDefaultSettings(db, lastInsertRowid);
  return getProfile(lastInsertRowid);
}

export function renameProfile(profileId, name) {
  const trimmed = String(name || '').trim().slice(0, 60);
  if (!trimmed) return getProfile(profileId);
  getDb().prepare('UPDATE profiles SET name = ? WHERE id = ?').run(trimmed, profileId);
  return getProfile(profileId);
}

export function setProfileIdentity(profileId, userInfo) {
  getDb().prepare('UPDATE profiles SET c2_user_id = ?, user_info = ? WHERE id = ?')
    .run(userInfo?.id ?? null, userInfo ? JSON.stringify(userInfo) : null, profileId);
}

// Maps a freshly-authorized Concept2 account to exactly one profile. Returns
// { profile } on success or { error } when a reconnect names the wrong account.
export function resolveConnectingProfile(userInfo, intent = {}) {
  const c2Id = userInfo?.id ?? null;
  const owner = getProfileByC2UserId(c2Id); // profile already holding this logbook, if any

  if (intent.profileId) {
    const target = getProfile(intent.profileId);
    if (!target) return { error: 'profile_not_found' };
    // An explicit reconnect must re-authorize the SAME logbook: refuse if the
    // account belongs to a different profile (would hijack/merge) or differs
    // from the one this profile is already bound to (would mix two people's
    // data under one profile).
    if (owner && owner.id !== target.id) return { error: 'logbook_in_use' };
    if (target.c2_user_id != null && target.c2_user_id !== c2Id) return { error: 'wrong_account' };
    return { profile: target };
  }

  // Add-profile / legacy: reuse the logbook's existing profile to avoid a
  // duplicate, else create one named from the account.
  return { profile: owner || createProfile(intent.newName || userInfo?.first_name || userInfo?.username) };
}

// No FK CASCADE on the app-enforced profile_id columns, so cascade here.
export function deleteProfile(profileId) {
  const db = getDb();
  db.transaction(() => {
    const workoutIds = db.prepare('SELECT id FROM workouts WHERE profile_id = ?').all(profileId).map(r => r.id);
    const delChild = (table) => {
      const stmt = db.prepare(`DELETE FROM ${table} WHERE workout_id = ?`);
      for (const id of workoutIds) stmt.run(id);
    };
    db.prepare('UPDATE planned_workouts SET completed_workout_id = NULL WHERE profile_id = ?').run(profileId);
    for (const table of ['strokes', 'intervals', 'computed_metrics', 'hr_zone_time', 'best_efforts', 'interval_recoveries']) {
      delChild(table);
    }
    db.prepare('DELETE FROM pb_history WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM workouts WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM planned_workouts WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM programs WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM goals WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM fitness_log WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM predictions WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM settings WHERE profile_id = ?').run(profileId);
    db.prepare("DELETE FROM sync_state WHERE key LIKE ?").run(`profile:${profileId}:%`);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
  })();
}
