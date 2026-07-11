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
  // Dev "skip auth": establishes a session and marks every existing profile
  // connected with a mock identity. Profiles come from the seed (the demo
  // seeds two) — mock-login must NOT invent its own, or throwaway profiles
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
