# ErgDash Cloud Architecture

ErgDash Cloud is the public, multi-user version of ErgDash.

The Cloudflare target lives in `apps/cloud`. It starts as a Worker shell that serves the React app, exposes a health endpoint, and can start the Concept2 OAuth flow. The callback still needs a Cloudflare-native implementation before public launch.

## Planned Cloudflare Services

- Workers Static Assets for the React UI
- D1 for relational user, workout, token, settings, and analytics data
- Queues for Concept2 sync/enrichment jobs
- Cron Triggers for periodic incremental sync
- Worker secrets for OAuth and encryption material

## Current OAuth Status

`/auth/login` redirects to Concept2 with `user:read,results:read`.

`/auth/callback` validates the state cookie, then returns `501` until these pieces are implemented:

- token exchange using `C2_CLIENT_SECRET`
- encrypted refresh-token storage
- app session creation
- initial sync queue dispatch

## Migration Notes

The current Docker backend is single-user and stores global auth/sync state. The Cloud backend should not share that model. It needs user-scoped tables and route guards throughout:

- `users`
- `oauth_tokens`
- `sessions`
- `user_settings`
- `sync_state`
- `workouts`
- derived analytics tables such as `fitness_log`, `predictions`, and `pb_history`

The shared React UI can move forward while the Cloud backend is built behind the existing API route names.
