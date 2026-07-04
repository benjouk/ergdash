const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
};
const OAUTH_STATE_COOKIE = 'ergdash_oauth_state';
const DEFAULT_C2_API_BASE = 'https://log.concept2.com';

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function randomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map(value => value.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
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

function oauthStateCookie(state, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

function clearOauthStateCookie(url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${OAUTH_STATE_COOKIE}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function oauthRedirectUri(env, url) {
  return env.C2_REDIRECT_URI || `${url.origin}/auth/callback`;
}

function c2ApiBase(env) {
  return env.C2_API_BASE || DEFAULT_C2_API_BASE;
}

function handleAuthStatus() {
  return json({
    authenticated: false,
    connected: false,
    user: null,
  });
}

function handleAuthLogin(env, url) {
  if (!env.C2_CLIENT_ID) {
    return json({
      error: 'Concept2 OAuth is not configured. Set C2_CLIENT_ID in Cloudflare Worker variables.',
    }, { status: 500 });
  }

  const state = randomHex();
  const params = new URLSearchParams({
    client_id: env.C2_CLIENT_ID,
    redirect_uri: oauthRedirectUri(env, url),
    response_type: 'code',
    scope: 'user:read,results:read',
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: `${c2ApiBase(env)}/oauth/authorize?${params}`,
      'set-cookie': oauthStateCookie(state, url),
    },
  });
}

function handleAuthCallback(request, url) {
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const returnedState = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return json({
      error: `Concept2 OAuth denied or failed: ${error}`,
    }, {
      status: 400,
      headers: { 'set-cookie': clearOauthStateCookie(url) },
    });
  }

  if (!code) {
    return json({
      error: 'Missing Concept2 authorization code.',
    }, {
      status: 400,
      headers: { 'set-cookie': clearOauthStateCookie(url) },
    });
  }

  if (!expectedState || !returnedState || expectedState !== returnedState) {
    return json({
      error: 'Invalid Concept2 OAuth state.',
    }, {
      status: 400,
      headers: { 'set-cookie': clearOauthStateCookie(url) },
    });
  }

  return json({
    error: 'Concept2 OAuth reached ErgDash Cloud, but token storage and sync are not implemented yet.',
    next: 'Wire this callback to D1-backed users, token storage, sessions, and the sync queue.',
  }, {
    status: 501,
    headers: { 'set-cookie': clearOauthStateCookie(url) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        target: 'cloud',
        app: 'ErgDash',
      });
    }

    if (url.pathname === '/auth/status') {
      return handleAuthStatus();
    }

    if (url.pathname === '/auth/logout') {
      return json({ ok: true });
    }

    if (url.pathname === '/auth/login') {
      return handleAuthLogin(env, url);
    }

    if (url.pathname === '/auth/callback') {
      return handleAuthCallback(request, url);
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      return json({
        error: 'ErgDash Cloud API is not implemented yet.',
      }, { status: 501 });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, _env, _ctx) {
    // Future home for per-user Concept2 sync dispatch once D1/Queues are wired.
  },
};
