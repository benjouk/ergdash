# ErgDash Cloud

Cloudflare Workers target for the public ErgDash app.

This is intentionally a thin scaffold for now:

- serves the shared React build from `apps/docker/client/dist`
- exposes `/health`
- reserves `/api/*` and `/auth/*` for the future D1-backed multi-user backend

## Local Development

From the repository root:

```bash
npm install
npm run build:cloud-assets
npm run dev:cloud
```

## Cloudflare Git Integration

Connect the GitHub repository to a Cloudflare Worker and use:

```bash
npm ci
npm run build:cloud-assets
npm run deploy -w apps/cloud
```

Add Worker secrets in Cloudflare, not in the repo:

- `C2_CLIENT_ID`
- `C2_CLIENT_SECRET`
- `SESSION_SECRET`
- token encryption secret for the future D1 backend
