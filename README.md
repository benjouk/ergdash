# ErgDash

ErgDash is a Concept2 RowErg training dashboard. It connects to the Concept2 Logbook API to sync workout history and display training analytics: volume trends, pace tracking, personal bests, stroke metrics, and fitness modelling.

This repository now manages two deployment targets:

- **ErgDash Cloud** in `apps/cloud` — the Cloudflare Workers target for the public multi-user product.
- **ErgDash Docker** in `apps/docker` — the current self-hosted single-user app and reference implementation.

## Repository Layout

```text
apps/
  cloud/          Cloudflare Worker shell for ergdash.com
  docker/
    client/       React 18 + Vite 5 frontend
    server/       Express 4 + better-sqlite3 backend
docs/
  cloud.md        Cloud backend migration notes
  self-hosted.md  Docker deploy and development notes
```

## Quick Start

Requires Node.js 22+.

```bash
npm install
npm test
```

Run the self-hosted Docker-era app in development:

```bash
npm run dev:docker:server
npm run dev:docker:client
```

Open `http://localhost:5173`. In dev mode a "Skip Auth" link appears on the login screen.

Run the Cloudflare Worker shell locally:

```bash
npm run build:cloud-assets
npm run dev:cloud
```

## Docker Target

The self-hosted app remains in `apps/docker`.

```bash
cd apps/docker
cp .env.example .env
# Fill in C2_CLIENT_ID and C2_CLIENT_SECRET from https://log.concept2.com/developers
docker-compose up -d --build
```

The Docker app is available at `http://localhost:3100`.

## Cloud Target

The Cloudflare Worker target lives in `apps/cloud`.

Cloudflare Git integration can run:

```bash
npm ci
npm run build:cloud-assets
npm run deploy -w apps/cloud
```

The Worker currently serves the React app and exposes `/health`. The multi-user D1/Queues backend still needs to be built before ErgDash Cloud can replace the self-hosted backend.

## Features

- **Dashboard** — Season metres, weekly volume chart, pace trend, personal bests, calendar heatmap, weekly time-in-zone, fitness sparkline
- **Session Detail** — Canvas pace ribbon heatmap, stroke-level charts, interval rep chart with HR recovery, rate-vs-pace scatter, HR zone bar, computed metrics
- **Workouts** — Filterable/sortable table with CSV/JSON export
- **Progress** — Fitness (CTL/ATL/TSB), pace/volume trends, power-duration curve, time-in-zone, polarization, efficiency, distance per stroke, HR drift, cumulative metres, drag factor, fade fingerprint
- **HR Zones** — Five configurable zones in Settings
- **Tools** — Performance calculators and training utilities
- **Light/Dark theme** — System-aware with manual override
- **Units** — Toggle between /500m pace, watts, and cal/hr

## Tech Stack

**Cloud:** Cloudflare Workers, Workers Static Assets, future D1/Queues/Cron

**Docker client:** React, Vite, React Router, Recharts, D3 scales, Lucide icons, CSS Modules

**Docker server:** Express, better-sqlite3, node-cron

**Fonts:** Outfit, Archivo, Fira Code

## License

MIT
