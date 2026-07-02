# ROW//DASH

A self-hosted dashboard for Concept2 RowErg users. Connects to the Concept2 Logbook API to sync your workout history and display training analytics — volume trends, pace tracking, personal bests, and fitness modelling.

## Quick Start (Docker)

```bash
cp .env.example .env
# Fill in C2_CLIENT_ID and C2_CLIENT_SECRET from https://log.concept2.com/developers
docker compose up -d
```

The app will be available at `http://localhost:3100`.

## Quick Start (Development)

Requires Node.js 22+.

```bash
# Server
cd server
npm install
npm run seed   # populate DB with mock data (no C2 credentials needed)
npm run dev    # starts on :3000 with --watch

# Client (separate terminal)
cd client
npm install
npm run dev    # starts Vite on :5173, proxies API to :3000
```

Open `http://localhost:5173`. In dev mode a "Skip Auth" link appears on the login screen.

## Architecture

Single-container stack: Express serves both the API and the built React frontend, backed by SQLite (WAL mode).

```
client/          React 18 + Vite 5 + React Router 6
  src/
    components/  Ticker, Feed, Charts, PaceRibbon, Stats
    views/       Dashboard, Session, Progress, Workouts, Settings, Connect
    context/     Theme, Auth, Sync, Units providers
    styles/      Design tokens (light/dark), global reset

server/          Express 4 + better-sqlite3
  src/
    routes/      auth, workouts, stats, sync, settings, health, ai (stub)
    middleware/  error handler
    db.js        DB init, migrations, WAL mode
    auth.js      OAuth2 (Authorization Code + Refresh)
    sync.js      Full sync, incremental sync, stroke enrichment
    analytics.js Auto-tagging, fade index, consistency, CTL/ATL/TSB,
                 HR zones, power curve, orchestration of stroke metrics
    strokeMetrics.js Pure per-stroke maths (DPS, watts/beat, HR drift,
                 rate discipline, HR recovery, zone time, best efforts)
    hrZones.js   HR zone model (settings + observed-max fallback)
    seed.js      Mock data generator (154 workouts)
  test/          Vitest unit tests for the pure metric functions
  migrations/    SQL schema
```

## Features

- **Dashboard** — Season metres, weekly volume chart, pace trend, personal bests, calendar heatmap, weekly time-in-zone, fitness sparkline
- **Session Detail** — Canvas pace ribbon heatmap, stroke-level charts, interval rep chart with HR recovery, rate-vs-pace scatter, HR zone bar, computed metrics (fade index, consistency, effort, distance per stroke, watts/beat, HR drift, rate discipline)
- **Workouts** — Filterable/sortable table with CSV export
- **Progress** — Fitness (CTL/ATL/TSB), pace/volume trends, power-duration curve with 90-day ghost, time-in-zone and polarization stacks, efficiency (watts/beat), distance per stroke, HR drift, cumulative metres race line, drag factor timeline, fade fingerprint
- **HR Zones** — Five configurable zones in Settings (% of max HR), estimated from observed data until set
- **Feed** — Always-visible sidebar of recent sessions with sparklines
- **Ticker** — Sticky header with key stats, pace trace, and navigation
- **Light/Dark theme** — System-aware with manual override
- **Units** — Toggle between /500m pace, watts, and cal/hr

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `C2_CLIENT_ID` | — | Concept2 OAuth client ID |
| `C2_CLIENT_SECRET` | — | Concept2 OAuth client secret |
| `C2_REDIRECT_URI` | `http://localhost:3100/auth/callback` | OAuth redirect URI |
| `PORT` | `3000` | Server listen port |
| `DATA_DIR` | `/data` | SQLite database directory |
| `SYNC_INTERVAL_MINUTES` | `15` | Auto-sync interval |
| `SESSION_SECRET` | `change-me-in-production` | Session signing secret |

## Tech Stack

**Client:** React, Vite, React Router, Recharts, D3 (scales only), Lucide icons, CSS Modules

**Server:** Express, better-sqlite3, node-cron

**Fonts:** Outfit (display), Fira Code (monospace) — self-hosted, variable woff2

## License

MIT
