import { describe, expect, it, vi } from 'vitest';
import { sameOriginWriteGuard, validateCorsOriginConfig, isDevAuthBypassEnabled } from '../src/middleware/security.js';
import { isStrictDate, validateDateRange } from '../src/middleware/validate.js';

function runMiddleware(mw, req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    mw(req, res, () => resolve({ status: 200 }));
  });
}

describe('sameOriginWriteGuard', () => {
  it('rejects production writes without origin metadata', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await runMiddleware(sameOriginWriteGuard, {
      method: 'POST',
      protocol: 'https',
      get: (name) => (name === 'host' ? 'example.com' : undefined),
    });
    expect(result.status).toBe(403);
    vi.unstubAllEnvs();
  });

  it('allows production same-origin writes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await runMiddleware(sameOriginWriteGuard, {
      method: 'POST',
      protocol: 'https',
      get: (name) => ({ host: 'example.com', origin: 'https://example.com' }[name.toLowerCase()]),
    });
    expect(result.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

describe('security config', () => {
  it('requires an explicit dev auth bypass flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ERGDASH_DEV_AUTH_BYPASS', '');
    expect(isDevAuthBypassEnabled()).toBe(false);
    vi.stubEnv('ERGDASH_DEV_AUTH_BYPASS', '1');
    expect(isDevAuthBypassEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('rejects wildcard production CORS origins', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', '*');
    expect(() => validateCorsOriginConfig()).toThrow(/CORS_ORIGIN/);
    vi.unstubAllEnvs();
  });
});

describe('validateDateRange', () => {
  it('rejects calendar dates that JavaScript would silently normalize', () => {
    expect(isStrictDate('2026-02-31')).toBe(false);
    expect(isStrictDate('2024-02-29')).toBe(true);
  });

  it('requires strict YYYY-MM-DD dates', async () => {
    const result = await runMiddleware(validateDateRange, {
      query: { from: '2024-02-31', to: 'next tuesday' },
    });
    expect(result.status).toBe(400);
    expect(result.body.details).toHaveLength(2);
  });

  it('accepts valid date-only ranges', async () => {
    const result = await runMiddleware(validateDateRange, {
      query: { from: '2024-02-29', to: '2024-03-01' },
    });
    expect(result.status).toBe(200);
  });
});
