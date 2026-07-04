import crypto from 'crypto';
import { getDb } from './db.js';

const C2_API_BASE = process.env.C2_API_BASE || 'https://log.concept2.com';
const C2_CLIENT_ID = process.env.C2_CLIENT_ID || '';
const C2_CLIENT_SECRET = process.env.C2_CLIENT_SECRET || '';
const C2_REDIRECT_URI = process.env.C2_REDIRECT_URI || 'http://localhost:3100/auth/callback';
const AUTH_COOKIE = 'ergdash_session';
const ENCRYPTED_PREFIX = 'enc:v1:';

function initSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET environment variable is required in production. Generate with: openssl rand -base64 32');
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

function cookieOptions(maxAgeSeconds) {
  return [
    `Path=/`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function getAuthorizationUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('oauth_state', ?, datetime('now'))").run(state);

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

export function storeTokens(tokens) {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );
  db.transaction(() => {
    if (tokens.access_token) {
      upsert.run('access_token', encryptSecret(tokens.access_token));
    }
    if (tokens.refresh_token) {
      upsert.run('refresh_token', encryptSecret(tokens.refresh_token));
    }
    upsert.run('token_expires_at', new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString());
  })();
}

export async function getValidToken() {
  const db = getDb();
  const tokenRow = db.prepare("SELECT value FROM sync_state WHERE key = 'access_token'").get();
  const expiresRow = db.prepare("SELECT value FROM sync_state WHERE key = 'token_expires_at'").get();
  const refreshRow = db.prepare("SELECT value FROM sync_state WHERE key = 'refresh_token'").get();

  if (!tokenRow) return null;

  const accessToken = decryptSecret(tokenRow.value);
  const refreshToken = decryptSecret(refreshRow?.value);
  if (accessToken && !tokenRow.value.startsWith(ENCRYPTED_PREFIX)) {
    upsertSyncState('access_token', encryptSecret(accessToken));
  }
  if (refreshToken && refreshRow && !refreshRow.value.startsWith(ENCRYPTED_PREFIX)) {
    upsertSyncState('refresh_token', encryptSecret(refreshToken));
  }
  const expiresAt = new Date(expiresRow?.value || 0);
  if (expiresAt < new Date(Date.now() + 5 * 60 * 1000) && refreshToken) {
    try {
      const newTokens = await refreshAccessToken(refreshToken);
      storeTokens(newTokens);
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

export function isAuthenticated() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'access_token'").get();
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

export function getUserInfo() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'user_info'").get();
  return row ? JSON.parse(row.value) : null;
}

export function clearAuth() {
  const db = getDb();
  const del = db.prepare("DELETE FROM sync_state WHERE key IN ('access_token', 'refresh_token', 'token_expires_at', 'user_info', 'oauth_state')");
  db.transaction(() => {
    del.run();
    db.prepare('DELETE FROM sessions').run();
  })();
}
