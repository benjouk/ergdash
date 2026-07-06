# Security Policy

## Supported versions

ErgDash is pre-1.0. Only the latest release (and the current `main` branch)
receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/benjouk/ergdash/security/advisories/new)
rather than opening a public issue. You should get an initial response within
a week.

## Security model

ErgDash is a **single-user, self-hosted** application. It stores one person's
Concept2 Logbook data in one SQLite database, holds one set of OAuth tokens
(encrypted at rest with the session secret), and gates all `/api` routes
behind a single session established by completing the Concept2 OAuth flow.
There is no multi-user isolation and none is planned.

It is designed to run on a home server or LAN, optionally behind a reverse
proxy. If you expose it to the internet:

- Serve it over HTTPS (the session cookie's `Secure` flag follows
  `C2_REDIRECT_URI`, or set `COOKIE_SECURE=true`).
- Set a strong `SESSION_SECRET` (the server refuses to start in production
  without one).
- Cross-origin API access is disabled by default; only set `CORS_ORIGIN` if
  you know you need it.
- The unauthenticated `/health` endpoint returns only `{"status":"ok"}`;
  instance metadata (workout counts, sync state, DB size) requires a session.

Cross-site request forgery is mitigated by `SameSite=Lax` HttpOnly session
cookies, a JSON-only request body parser, and CORS being disabled by default,
rather than by per-request CSRF tokens.
