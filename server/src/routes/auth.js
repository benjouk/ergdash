import { Router } from 'express';
import { getDb } from '../db.js';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  storeTokens,
  isAuthenticated,
  createAuthSession,
  hasValidSession,
  clearAuthSession,
  getUserInfo,
  clearAuth,
  fetchC2Api,
} from '../auth.js';
import { runFullSync, startSyncSchedule } from '../sync.js';

const router = Router();

router.get('/login', (req, res) => {
  const url = getAuthorizationUrl();
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    const db = getDb();
    const savedState = db.prepare(
      "SELECT value FROM sync_state WHERE key = 'oauth_state' AND updated_at >= datetime('now', '-10 minutes')"
    ).get();
    db.prepare("DELETE FROM sync_state WHERE key = 'oauth_state'").run();
    if (!state || !savedState || state !== savedState.value) {
      return res.status(400).json({ error: 'Invalid or expired state parameter' });
    }

    const tokens = await exchangeCodeForTokens(code);
    storeTokens(tokens);
    createAuthSession(res);

    const userInfo = await fetchC2Api('/api/users/me', tokens.access_token);
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('user_info', ?, datetime('now'))").run(
      JSON.stringify(userInfo.data || userInfo)
    );

    runFullSync().catch(err => console.error('Initial sync failed:', err));
    startSyncSchedule();

    res.redirect('/?connected=true');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/status', (req, res) => {
  const connected = isAuthenticated();
  const authenticated = connected && hasValidSession(req);
  res.json({
    authenticated,
    connected,
    user: authenticated ? getUserInfo() : null,
  });
});

router.post('/logout', (req, res) => {
  if (process.env.NODE_ENV === 'production' && !hasValidSession(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  clearAuthSession(req, res);
  clearAuth();
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== 'production') {
  router.get('/mock-login', (req, res) => {
    const db = getDb();
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    );
    storeTokens({
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      expires_in: 3600,
    });
    db.transaction(() => {
      upsert.run('user_info', JSON.stringify({
        id: 1,
        username: 'mockrower',
        first_name: 'Test',
        last_name: 'Rower',
      }));
    })();
    createAuthSession(res);
    res.redirect('/');
  });
}

export default router;
