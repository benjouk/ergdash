import { Router } from 'express';
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
