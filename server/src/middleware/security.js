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
  // Reconstruct the request's own origin so a same-origin write is allowed
  // without any configuration. Behind a TLS-terminating reverse proxy,
  // req.protocol is 'http' (Express isn't told to trust the proxy) while the
  // browser's Origin is https://, so we accept the host under both schemes and
  // honour the forwarded host/proto the proxy advertises. The host match is the
  // CSRF boundary here - a cross-site request carries the attacker's Origin,
  // not this host - so tolerating either scheme is safe.
  const forwardedHost = req.get('x-forwarded-host');
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  for (const host of [req.get('host'), forwardedHost]) {
    if (!host) continue;
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
    if (forwardedProto) allowed.add(`${forwardedProto}://${host}`);
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
