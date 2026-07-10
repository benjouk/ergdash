const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseAllowedOrigins() {
  const values = [process.env.APP_ORIGIN, process.env.CORS_ORIGIN]
    .filter(Boolean)
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean);
  return new Set(values);
}

export function isDevAuthBypassEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.ERGDASH_DEV_AUTH_BYPASS === '1';
}

export function validateCorsOriginConfig() {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) return false;
  const origins = origin.split(',').map(value => value.trim()).filter(Boolean);
  if (origins.length === 0) return false;
  if (process.env.NODE_ENV === 'production') {
    for (const value of origins) {
      if (value === '*' || !value.startsWith('https://')) {
        throw new Error('CORS_ORIGIN must be a comma-separated list of explicit https:// origins in production.');
      }
    }
  }
  return origins.length === 1 ? origins[0] : origins;
}

export function sameOriginWriteGuard(req, res, next) {
  if (process.env.NODE_ENV !== 'production' || SAFE_METHODS.has(req.method)) {
    return next();
  }

  const allowed = parseAllowedOrigins();
  const host = req.get('host');
  if (host) {
    allowed.add(`${req.protocol}://${host}`);
  }

  const origin = req.get('origin');
  if (origin) {
    if (allowed.has(origin)) return next();
    return res.status(403).json({ error: 'Cross-origin request rejected' });
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return next();
    } catch {}
    return res.status(403).json({ error: 'Cross-origin request rejected' });
  }

  return res.status(403).json({ error: 'Missing Origin header' });
}
