const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
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
