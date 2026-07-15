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

ErgDash is a **shared-trust, self-hosted household application**. One instance
can store several Concept2 profiles, each with separate workouts, settings,
goals, and encrypted OAuth tokens. Profiles are data partitions, not security
principals: every valid ErgDash browser session can switch profiles and use
instance-wide administration, backup, and restore controls.

The first Concept2 account bootstraps a fresh instance. After setup, a browser
without an ErgDash session can sign in only with a Concept2 identity already
registered in that instance. Adding a new household profile or explicitly
reconnecting one requires an existing ErgDash session.

ErgDash is designed for a trusted home LAN or an authenticated VPN. Direct
HTTP access on a LAN is supported intentionally: the app does not send HSTS
and does not ask browsers to upgrade HTTP assets to HTTPS. Do not expose the
application port directly to the public internet. If you use an HTTPS reverse
proxy, keep that proxy behind your VPN/access layer and set `APP_ORIGIN` to its
public origin.

- Set a strong, stable `SESSION_SECRET` (production refuses to start without
  one). It also encrypts stored OAuth tokens, so retain it with backups.
- The session cookie's `Secure` flag follows an HTTPS `C2_REDIRECT_URI`, or can
  be set explicitly with `COOKIE_SECURE=true`; it remains usable over LAN HTTP
  when the callback is HTTP.
- Cross-origin API access is disabled by default. Only set `CORS_ORIGIN` for a
  specific trusted HTTPS origin when it is genuinely required.
- The unauthenticated `/health` endpoint returns only `{"status":"ok"}`;
  instance metadata requires a session.

Cross-site request forgery is mitigated by `SameSite=Lax` HttpOnly session
cookies, a JSON-only request body parser, and CORS being disabled by default,
rather than by per-request CSRF tokens.
