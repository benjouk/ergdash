import { Router } from 'express';
import { getDb } from '../db.js';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  storeTokens,
  isAuthenticated,
  getUserInfo,
  clearAuth,
  fetchC2Api,
} from '../auth.js';
import { runFullSync } from '../sync.js';

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
    const savedState = db.prepare("SELECT value FROM sync_state WHERE key = 'oauth_state'").get();
    if (savedState && state !== savedState.value) {
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    const tokens = await exchangeCodeForTokens(code);
    storeTokens(tokens);

    const userInfo = await fetchC2Api('/api/users/me', tokens.access_token);
    db.prepare("INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('user_info', ?, datetime('now'))").run(
      JSON.stringify(userInfo.data || userInfo)
    );

    runFullSync().catch(err => console.error('Initial sync failed:', err));

    res.redirect('/?connected=true');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=auth_failed');
  }
});

router.get('/status', (req, res) => {
  res.json({
    authenticated: isAuthenticated(),
    user: getUserInfo(),
  });
});

router.post('/logout', (req, res) => {
  clearAuth();
  res.json({ ok: true });
});

if (process.env.NODE_ENV !== 'production') {
  router.get('/mock-login', (req, res) => {
    const db = getDb();
    const upsert = db.prepare(
      "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    );
    db.transaction(() => {
      upsert.run('access_token', 'mock-token');
      upsert.run('refresh_token', 'mock-refresh');
      upsert.run('token_expires_at', new Date(Date.now() + 3600000).toISOString());
      upsert.run('user_info', JSON.stringify({
        id: 1,
        username: 'mockrower',
        first_name: 'Test',
        last_name: 'Rower',
      }));
    })();
    res.redirect('/');
  });
}

export default router;
