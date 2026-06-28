import crypto from 'crypto';
import { getDb } from './db.js';

const C2_API_BASE = process.env.C2_API_BASE || 'https://log.concept2.com';
const C2_CLIENT_ID = process.env.C2_CLIENT_ID || '';
const C2_CLIENT_SECRET = process.env.C2_CLIENT_SECRET || '';
const C2_REDIRECT_URI = process.env.C2_REDIRECT_URI || 'http://localhost:3100/auth/callback';

export function getAuthorizationUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('oauth_state', ?, datetime('now'))").run(state);

  const params = new URLSearchParams({
    client_id: C2_CLIENT_ID,
    redirect_uri: C2_REDIRECT_URI,
    response_type: 'code',
    scope: 'user:read results:read',
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
    upsert.run('access_token', tokens.access_token);
    upsert.run('refresh_token', tokens.refresh_token);
    upsert.run('token_expires_at', new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString());
  })();
}

export async function getValidToken() {
  const db = getDb();
  const tokenRow = db.prepare("SELECT value FROM sync_state WHERE key = 'access_token'").get();
  const expiresRow = db.prepare("SELECT value FROM sync_state WHERE key = 'token_expires_at'").get();
  const refreshRow = db.prepare("SELECT value FROM sync_state WHERE key = 'refresh_token'").get();

  if (!tokenRow) return null;

  const expiresAt = new Date(expiresRow?.value || 0);
  if (expiresAt < new Date(Date.now() + 5 * 60 * 1000) && refreshRow) {
    try {
      const newTokens = await refreshAccessToken(refreshRow.value);
      storeTokens(newTokens);
      return newTokens.access_token;
    } catch {
      return tokenRow.value;
    }
  }

  return tokenRow.value;
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

export function getUserInfo() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'user_info'").get();
  return row ? JSON.parse(row.value) : null;
}

export function clearAuth() {
  const db = getDb();
  const del = db.prepare("DELETE FROM sync_state WHERE key IN ('access_token', 'refresh_token', 'token_expires_at', 'user_info', 'oauth_state')");
  del.run();
}
