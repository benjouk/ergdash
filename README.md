# ErgDash

A self-hosted dashboard for Concept2 RowErg users. Connects to the Concept2 Logbook API to sync your workout history and display training analytics: volume trends, pace tracking, personal bests, and fitness modelling.

## Setup

1. Register an OAuth app at [log.concept2.com/developers](https://log.concept2.com/developers). Set the redirect URI to `http://localhost:3100/auth/callback`, or your real host/port. It must match `C2_REDIRECT_URI` exactly.
2. `cp .env.example .env` and fill in `C2_CLIENT_ID`, `C2_CLIENT_SECRET`, and `SESSION_SECRET` (`openssl rand -base64 32`).

## Run (Docker)

Multi-arch images (`linux/amd64`, `linux/arm64`) are published to [`ghcr.io/benjouk/ergdash`](https://github.com/benjouk/ergdash/pkgs/container/ergdash). `latest` tracks `main`; releases are tagged `1.2.3` / `1.2`.

```yaml
services:
  ergdash:
    image: ghcr.io/benjouk/ergdash:latest
    ports:
      - "3100:3000"
    volumes:
      - ergdash-data:/data
    environment:
      C2_CLIENT_ID: your-client-id
      C2_CLIENT_SECRET: your-client-secret
      SESSION_SECRET: your-session-secret
    restart: unless-stopped

volumes:
  ergdash-data:
```

The app is at `http://localhost:3100`. From a repo checkout, the included [docker-compose.yml](docker-compose.yml) reads the same settings from `.env`:

```bash
docker compose pull && docker compose up -d   # or build from source: docker compose up -d --build
```

## Development

Requires Node.js 22+. No C2 credentials needed: the dev server seeds mock data and the login screen has a "Skip Auth" link.

```bash
# Server
cd server && npm install
npm run dev    # :3000, --watch

# Client (separate terminal)
cd client && npm install
npm run dev    # Vite on :5173, proxies API to :3000
```

Open `http://localhost:5173`.

## Architecture

Single-container stack: Express serves both the API and the built React frontend, backed by SQLite (WAL mode).

```
client/          React 18 + Vite 5 + React Router 6
  src/
    components/  Ticker, Feed, Charts, Stats, Session, BottomNav, Skeleton, Toast
    views/       Dashboard, Session, Progress, Workouts, Plan, Tools, Settings, Connect
    context/     Theme, Auth, Sync, Units, Prefs, TimeRange, Toast providers
    styles/      Design tokens (light/dark), global reset

server/          Express 4 + better-sqlite3
  src/
    routes/      auth, workouts, stats, sync, settings, goals, plans,
                 admin (backup/export/reset), health, ai (stub)
    middleware/  error handler
    db.js        DB init, migrations, WAL mode
    auth.js      OAuth2 (Authorization Code + Refresh)
    sync.js      Full sync, incremental sync, stroke enrichment
    analytics.js Auto-tagging, fade index, consistency, CTL/ATL/TSB,
                 HR zones, power curve, orchestration of stroke metrics
    strokeMetrics.js Pure per-stroke maths (DPS, watts/beat, HR drift,
                 rate discipline, HR recovery, zone time, best efforts)
    hrZones.js   HR zone model (settings + observed-max fallback)
    pbDetection.js PB progression detection and history backfill
    insights.js  Rules-based training insights (pure, no DB)
    goalProgress.js Pure goal-window and progress/gap maths
    planMatching.js Same-day heuristic linking synced workouts to plans
    seed.js      Mock data generator (workouts, goals, planned sessions)
  test/          Vitest unit tests for the pure metric functions
  migrations/    SQL schema
```

## Features

- **Dashboard:** Season metres, weekly volume chart, pace trend, personal bests, calendar heatmap, weekly time-in-zone, fitness sparkline
- **Session Detail:** Canvas pace ribbon heatmap, stroke-level charts, interval rep chart with HR recovery, rate-vs-pace scatter, HR zone bar, computed metrics (fade index, consistency, effort, distance per stroke, watts/beat, HR drift, rate discipline)
- **Workouts:** Filterable/sortable table with CSV export
- **Goals & Targets:** Weekly/monthly/season/annual volume goals overlaid on the dashboard, plus performance targets per benchmark distance compared against current PBs and trend-based race predictions, with an optional race-day countdown
- **Plan:** Month calendar to schedule future sessions (type, target distance/duration, pace, rate, notes); synced workouts auto-match same-day plans with manual link/unlink, missed days are flagged, and a Progress chart tracks plan adherence over time
- **Progress:** Fitness (CTL/ATL/TSB), pace/volume trends, power-duration curve with 90-day ghost, time-in-zone and polarization stacks, efficiency (watts/beat), distance per stroke, HR drift, cumulative metres race line, drag factor timeline, fade fingerprint
- **HR Zones:** Five configurable zones in Settings (% of max HR), estimated from observed data until set
- **Feed:** Always-visible sidebar of recent sessions with sparklines
- **Ticker:** Sticky header with key stats, pace trace, and navigation
- **Light/Dark theme:** System-aware with manual override
- **Units:** Toggle between /500m pace, watts, and cal/hr

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `C2_CLIENT_ID` | - | Concept2 OAuth client ID |
| `C2_CLIENT_SECRET` | - | Concept2 OAuth client secret |
| `C2_REDIRECT_URI` | `http://localhost:3100/auth/callback` | OAuth redirect URI |
| `C2_API_BASE` | `https://log.concept2.com` | Concept2 API base URL (only change for testing against a mock) |
| `PORT` | `3000` | Server listen port |
| `DATA_DIR` | `/data` (Docker) / `server/data` (local) | SQLite database directory |
| `SYNC_INTERVAL_MINUTES` | `15` | Auto-sync interval |
| `SESSION_SECRET` | - | Session signing secret (required in production, min 16 chars; generate with `openssl rand -base64 32`) |
| `CLAUDE_API_KEY` | - | Optional; reserved for the AI insights integration (`/api/ai` is currently a stub) |
| `COOKIE_SECURE` | auto | Force the session cookie's `Secure` flag on/off; auto-detects from `C2_REDIRECT_URI` |
| `CORS_ORIGIN` | disabled | Allow cross-origin API access from this origin. Not needed for normal setups; the frontend is served same-origin |

## Security Model

ErgDash is a **single-user, self-hosted** app: one Concept2 account, one set of
OAuth tokens (encrypted at rest), one SQLite database, and one session gating
all `/api` routes. It's designed for a home server or LAN. If you expose it to
the internet, put it behind HTTPS and set a strong `SESSION_SECRET`. The
unauthenticated `/health` endpoint returns only a liveness signal; instance
metadata requires a session. CSRF is mitigated by `SameSite=Lax` HttpOnly
cookies, a JSON-only body parser, and CORS being disabled by default. See
[SECURITY.md](SECURITY.md) for details and vulnerability reporting.

## Tech Stack

**Client:** React, Vite, React Router, Recharts, D3 (scales only), Lucide icons, CSS Modules

**Server:** Express, better-sqlite3, node-cron

**Fonts:** Outfit (display/body), Archivo (hero numerals), Fira Code (monospace); self-hosted, variable woff2

## License

MIT
