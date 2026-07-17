import express, { Router } from 'express';
import {
  getAuthorizationUrl,
  consumeOauthState,
  exchangeCodeForTokens,
  storeTokens,
  hasConnectedProfile,
  createAuthSession,
  hasValidSession,
  clearAuthSession,
  clearAuth,
  fetchC2Api,
  listProfiles,
  getProfile,
  createProfile,
  setProfileIdentity,
  resolveConnectingProfile,
} from '../auth.js';
import { getDb } from '../db.js';
import { isValidBackup, restoreProfileData } from '../backup.js';
import { runFullSync, startSyncSchedule } from '../sync.js';

const router = Router();

// A fresh instance can be bootstrapped without a session. Once initialized,
// an unauthenticated OAuth flow is login-only: the returned Concept2 identity
// must already belong to a profile. Adding a profile or explicitly targeting
// a reconnect is privileged and requires the existing ErgDash session.
router.get('/login', (req, res) => {
  const requested = req.query.profile;
  const authenticated = hasValidSession(req);
  const initialized = listProfiles().length > 0;
  let intent = {};

  if (!authenticated && initialized) {
    intent = { loginOnly: true };
  } else if (requested && requested !== 'new') {
    const id = Number(requested);
    if (!Number.isInteger(id) || !getProfile(id)) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    intent = { profileId: id, requireSession: true };
  } else {
    const newName = req.query.name ? String(req.query.name).slice(0, 60) : undefined;
    intent = initialized
      ? { newName, requireSession: true }
      : { newName, bootstrap: true };
  }
  res.redirect(getAuthorizationUrl(intent));
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    const intent = consumeOauthState(state);
    if (!intent) {
      return res.status(400).json({ error: 'Invalid or expired state parameter' });
    }
    if (intent.requireSession && !hasValidSession(req)) {
      return res.redirect('/?error=session_required');
    }

    const tokens = await exchangeCodeForTokens(code);
    const userResp = await fetchC2Api('/api/users/me', tokens.access_token);
    const userInfo = userResp.data || userResp;

    const result = resolveConnectingProfile(userInfo, intent);
    if (result.error) {
      return res.redirect(`/?error=${encodeURIComponent(result.error)}`);
    }
    const profile = result.profile;

    setProfileIdentity(profile.id, userInfo);
    storeTokens(profile.id, tokens);
    if (!hasValidSession(req)) {
      createAuthSession(res);
    }

    runFullSync(profile.id).catch(err => console.error('Initial sync failed:', err));
    startSyncSchedule();

    res.redirect(`/?connected=${profile.id}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/status', (req, res) => {
  const authenticated = hasValidSession(req);
  res.json({
    authenticated,
    connected: hasConnectedProfile(),
    profiles: authenticated ? listProfiles() : [],
  });
});

// Ends the browser session only; Concept2 connections are per-profile and
// managed via /api/profiles/:id/disconnect.
router.post('/logout', (req, res) => {
  if (process.env.NODE_ENV === 'production' && !hasValidSession(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  clearAuthSession(req, res);
  res.json({ ok: true });
});

// First-run restore: rebuild a profile from an ErgDash data backup on a fresh
// install, WITHOUT connecting Concept2. This is the disaster-recovery entry
// point - the normal restore lives behind requireAuth + resolveProfile, which
// a brand-new install (no session, no profile) can't satisfy, and completing
// OAuth is impossible if Concept2 itself is down. Allowed only while no profile
// exists yet; once initialized it 403s and users restore from Settings. The
// raw octet-stream body (like /api/admin/restore-data) bypasses the small
// global JSON parser. A session is established on success so the browser lands
// straight in the dashboard.
router.post('/restore-bootstrap', express.raw({ type: 'application/octet-stream', limit: '250mb' }), (req, res, next) => {
  if (listProfiles().length > 0) {
    return res.status(403).json({ error: 'ErgDash is already set up. Restore from Settings instead.' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'No backup file uploaded' });
  }

  let backup;
  try {
    backup = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'File is not valid JSON' });
  }
  if (!isValidBackup(backup)) {
    return res.status(400).json({ error: 'File is not an ErgDash data backup' });
  }

  const meta = backup.profile || {};
  // user_info is stored (and exported) as a JSON string; parse before
  // re-applying so identity round-trips instead of being double-encoded.
  let info = meta.user_info;
  if (typeof info === 'string') {
    try { info = JSON.parse(info); } catch { info = null; }
  }

  try {
    const db = getDb();
    // Profile creation + restore must be atomic: if the restore throws (a
    // malformed row, a too-new format), the new profile must NOT survive - an
    // orphaned profile would make listProfiles() non-empty and 403 every future
    // bootstrap, bricking the recovery path. better-sqlite3 nests this
    // transaction as a savepoint around restoreProfileData's own transaction,
    // so any failure rolls the whole thing back to a truly fresh install.
    const result = db.transaction(() => {
      const profile = createProfile(meta.name || 'Restored profile');
      if (info && typeof info === 'object') setProfileIdentity(profile.id, info);
      const restored = restoreProfileData(db, profile.id, backup);
      return { profileId: profile.id, restored };
    })();
    createAuthSession(res);
    res.json({ ok: true, profile_id: result.profileId, restored: result.restored });
  } catch (err) {
    next(err);
  }
});

if (process.env.NODE_ENV !== 'production') {
  // Dev "skip auth": establishes a session and marks every existing profile
  // connected with a mock identity. Profiles come from the seed (the demo
  // seeds two) - mock-login must NOT invent its own, or throwaway profiles
  // leak into the captured demo fixtures. Only when the DB has no profiles at
  // all does it create one (?profiles=2 for local multi-profile testing).
  router.get('/mock-login', (req, res) => {
    let profiles = listProfiles();
    if (profiles.length === 0) {
      const count = req.query.profiles === '2' ? 2 : 1;
      const names = ['Dev Rower', 'Second Rower'];
      for (let i = 0; i < count; i++) createProfile(names[i]);
      profiles = listProfiles();
    }
    profiles.forEach((profile) => {
      const [first, ...rest] = String(profile.name).split(' ');
      setProfileIdentity(profile.id, {
        id: 900000 + profile.id,
        username: first.toLowerCase(),
        first_name: first,
        last_name: rest.join(' '),
      });
      storeTokens(profile.id, {
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expires_in: 3600,
      });
    });
    createAuthSession(res);
    res.redirect('/');
  });
}

export default router;
