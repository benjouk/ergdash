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
  getProfileByC2UserId,
  createProfile,
  setProfileIdentity,
} from '../auth.js';
import { runFullSync, startSyncSchedule } from '../sync.js';

const router = Router();

// ?profile=new (optionally &name=Alice) connects a new household member;
// ?profile=<id> reconnects an existing profile. Legacy /auth/login with no
// params behaves like profile=new (the callback dedupes by Concept2 user id).
router.get('/login', (req, res) => {
  const requested = req.query.profile;
  let intent = {};
  if (requested && requested !== 'new') {
    const id = Number(requested);
    if (!Number.isInteger(id) || !getProfile(id)) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    intent = { profileId: id };
  } else if (req.query.name) {
    intent = { newName: String(req.query.name).slice(0, 60) };
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

    const tokens = await exchangeCodeForTokens(code);
    const userResp = await fetchC2Api('/api/users/me', tokens.access_token);
    const userInfo = userResp.data || userResp;

    // A logbook account maps to exactly one profile: reuse a profile that
    // already holds this Concept2 user id, else honor the reconnect intent,
    // else create a new profile named after the account.
    let profile = getProfileByC2UserId(userInfo?.id);
    if (!profile && intent.profileId) {
      profile = getProfile(intent.profileId);
    }
    if (!profile) {
      profile = createProfile(intent.newName || userInfo?.first_name || userInfo?.username);
    }

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
    profiles: authenticated ? listProfiles() : null,
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
  router.get('/mock-login', (req, res) => {
    // Two mock profiles so multi-profile flows are testable locally.
    const mocks = [
      { username: 'mockrower', first_name: 'Test', last_name: 'Rower', c2Id: 1 },
      { username: 'mockrower2', first_name: 'Casey', last_name: 'Rower', c2Id: 2 },
    ];
    for (const mock of mocks) {
      let profile = getProfileByC2UserId(mock.c2Id);
      if (!profile) profile = createProfile(mock.first_name);
      setProfileIdentity(profile.id, {
        id: mock.c2Id,
        username: mock.username,
        first_name: mock.first_name,
        last_name: mock.last_name,
      });
      storeTokens(profile.id, {
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expires_in: 3600,
      });
    }
    createAuthSession(res);
    res.redirect('/');
  });
}

export default router;
