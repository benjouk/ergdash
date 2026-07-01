# RowDash — Product Plan

## v1.0 · June 2026

---

## Status Update (2026-07-01)

### Implementation Progress: **~80% Complete** (Phases 1-4 ✅, Phase 5 Stubbed ❌, Phase 6 Partial ⚠️)

**Latest Work (PR #22):** Session comparison overlay is now live. It was originally built and merged (PR #21), then reverted directly on `main` outside of a PR, then restored and fixed:
- Fixed the comparison dropdown never appearing — `/api/workouts` returns `{ data: [...] }`, but the options-loading code read `.workouts` (undefined), so the option list silently stayed empty
- Fixed a stale-closure bug in the same effect (it checked `workout` state before React had committed it)
- Replaced the native `<select>` with a themed dropdown — the old version's icon overlapped its own label text, and its native browser popup didn't match the app's styling; each option now shows date, tag, distance, pace, and duration instead of just date and duration

**Status by Phase:**
| Phase | Scope | Status | Notes |
|-------|-------|--------|-------|
| 1 | Foundation (DB, OAuth, sync) | ✅ Complete | OAuth working, incremental sync, health endpoint |
| 2 | Core UI (Dashboard, Session, Feed) | ✅ Complete | All views built, Broadcast design implemented, responsive layout pass done (PR #19) |
| 3 | Analytics (metrics, CTL/ATL/TSB, PB predictions) | ✅ Complete | All calculations working, decay curve endpoint live |
| 4 | QOL (enrichment, manual sync, dark mode) | ✅ Complete | Enrichment working, cursor now persists |
| 5 | AI Integration (Claude, session notes, NL query) | ❌ Stubbed | Routes return 501; infrastructure ready, logic not implemented |
| 6 | Polish (mobile, shortcuts, export, accessibility) | ⚠️ Partial | Session comparison overlay ✅ done; layout is responsive; keyboard shortcuts, export (JSON/CSV), drag factor alerts, and an accessibility pass are still not built |

**Blockers for Launch:** None (all Phase 1-4 features complete and tested)

**Decision Needed:** Defer AI features (Phase 5) to v1.1 or include in v1.0?

---

## 1. What is RowDash?

RowDash is a self-hosted web dashboard for Concept2 RowErg users. It pulls workout data from the Concept2 Logbook API, stores it locally in SQLite, and presents it through a data-rich, AI-enhanced interface designed for tracking progress, comparing sessions, forecasting performance, and understanding training trends.

It ships as a single `docker compose up` deployment — one container, one port, one volume. No external database, no Redis, no nginx. Provide your Concept2 API credentials and optionally a Claude API key, and it works.

This is not a homelab utility. It's a standalone product that happens to be self-hosted. The design, the data analysis, and the AI coaching features should feel like a consumer fitness product.

---

## 2. Design direction — "Broadcast"

### Concept

Inspired by live sports TV graphics and race day monitors. The interface is built around a persistent dark ticker bar at the top that functions as both identity, navigation, and live status display. There is no sidebar. The pace ribbon — the product's signature visual — lives inside the ticker as an EKG-style trace.

Below the ticker, the layout splits asymmetrically: a wide primary panel for the active view (charts, session detail, comparisons) and a narrow right-hand feed panel for a scrolling workout log with per-session sparklines.

### Why this direction

The Broadcast direction was chosen over four alternatives (Instrument, Fluid, Editorial, Logbook) because it does three things the others don't:

1. The ticker makes the product instantly recognisable — no other rowing app looks like this
2. Navigation lives in the ticker, not a sidebar — this maximises the content area and eliminates the "generic SaaS dashboard" feel
3. The asymmetric split (wide primary + narrow feed) creates a natural information hierarchy: the thing you're studying on the left, the stream of sessions on the right

### Palette

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--bg` | `#F4F4F0` | `#0C0C0E` | Page background |
| `--surface` | `#FFFFFF` | `#16161A` | Card/panel background |
| `--surface-alt` | `#ECECEA` | `#1E1E22` | Elevated elements, hover |
| `--ink` | `#18181A` | `#EAEAE8` | Primary text |
| `--ink-2` | `#606068` | `#888890` | Secondary text |
| `--ink-3` | `#9898A0` | `#505058` | Tertiary text, labels |
| `--rule` | `#DCDCE0` | `#28282E` | Borders, dividers |
| `--accent` | `#00A870` | `#00E898` | Primary accent, positive trends |
| `--accent-bg` | `rgba(0,168,112,0.08)` | `rgba(0,232,152,0.06)` | Accent backgrounds |
| `--accent-2` | `#6855E0` | `#A090FF` | Secondary accent (intervals) |
| `--accent-2-bg` | `rgba(104,85,224,0.08)` | `rgba(160,144,255,0.06)` | Secondary backgrounds |
| `--hot` | `#E8562A` | `#FF7848` | PBs, warnings, interval effort |
| `--hot-bg` | `rgba(232,86,42,0.08)` | `rgba(255,120,72,0.06)` | Hot backgrounds |
| `--ticker-bg` | `#18181A` | `#08080A` | Ticker bar background |
| `--ticker-text` | `#E8E8E4` | `#D0D0CC` | Ticker text |
| `--ticker-accent` | `#00E898` | `#00E898` | Ticker highlights, trace |
| `--ticker-dim` | `#484850` | `#3A3A40` | Ticker inactive elements |

### Typography

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| Display / headings | Outfit | 600–800 | Geometric, broadcast feel. Tight tracking (-0.03em). |
| Body / UI | Outfit | 400–500 | Same family, keeps the identity consistent. |
| Data / monospace | Fira Code | 400–600 | Pace splits, times, distances, code-like readouts. |

Both fonts are open source. Self-hosted as woff2 within the Docker image — zero CDN dependencies at runtime.

### Layout structure

```
┌──────────────────────────────────────────────────────────────────┐
│  [LOGO]  │ Season │ Pace │ Streak │~~pace trace~~│ Nav tabs │ ◐ │  ← Ticker (56px, sticky)
├──────────────────────────────────────────────┬───────────────────┤
│                                              │                   │
│  Primary panel                               │  Feed panel       │
│  (charts, session detail, comparisons,       │  (scrolling       │
│   predictions, AI insights)                  │   workout list    │
│                                              │   with sparklines)│
│                                              │                   │
│  Stats row → Charts grid → PB strip          │  Session cards    │
│                                              │  with inline      │
│                                              │  pace curves      │
│                                              │                   │
├──────────────────────────────────────────────┴───────────────────┤
```

**Ticker bar (56px, sticky top):** Dark background. Contains: logo mark (`ROW//DASH`), 3 key stats (season meters, avg pace, streak), the pace trace (SVG line showing last 30 sessions' pace as a continuous EKG-style curve), navigation tabs (Dashboard, Progress, Workouts, Settings), and a theme toggle.

**Primary panel (~70% width):** The main workspace. Content changes based on the active view. Always fills the available vertical space.

**Feed panel (~320px fixed width):** Right-hand column. Shows a scrolling list of recent sessions with date, title, metrics, and a per-workout sparkline. Each item is clickable to navigate the primary panel to that session's detail view. This panel persists across all views — it's always visible as a constant reference.

**Mobile:** Ticker collapses to logo + hamburger. Feed panel moves below primary content as a full-width list. Navigation becomes a bottom sheet.

### Signature elements

1. **Pace trace in ticker:** The pace ribbon reimagined as a continuous line running through the ticker bar. Each of the last 30 sessions is a data point; the trace shows the overall pace trajectory at a glance, always visible.

2. **Per-session sparklines:** Every workout entry in the feed panel includes a tiny SVG line showing the pace profile across that session. Endurance sessions use `--accent`, intervals use `--accent-2`. These sparklines make the feed visually distinctive and information-dense.

3. **Session comparison overlay:** When comparing two sessions, their pace curves render as overlaid lines in different colours on the same chart, with a difference ribbon showing where one session was faster/slower. This is the power feature of the session detail view.

---

## 3. Architecture

### Single container, single concern

```
┌───────────────────────────────────────────────────────┐
│  Docker container: rowdash                            │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Express API server (Node.js 22)                │ │
│  │  ├── OAuth2 flow (Concept2 Logbook)             │ │
│  │  ├── Sync scheduler (node-cron)                 │ │
│  │  ├── Analytics engine (computed metrics)        │ │
│  │  ├── Claude API proxy (coaching, queries)       │ │
│  │  ├── REST API for frontend                      │ │
│  │  └── Serves static Vite build                   │ │
│  │                                                  │ │
│  │  Data: SQLite via better-sqlite3 (WAL mode)     │ │
│  │  Volume: /data (DB, tokens, settings)           │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Single port (3000). No external DB. No Redis.        │
│  Vite build compiled at image build time.             │
└───────────────────────────────────────────────────────┘
```

### Data flow

```
Concept2 RowErg
    │
    ▼ (Bluetooth → ErgData app → C2 Logbook cloud)
    │
C2 Logbook API (log.concept2.com/api)
    │
    ▼ (OAuth2 Bearer token, periodic sync)
    │
rowdash-server
    │
    ├── Sync: GET /api/users/me/results (paginated, up to 250/page)
    │   → workouts table (summary data)
    │
    ├── Enrich: GET /api/users/me/results/:id (per-workout)
    │   → strokes table (stroke-by-stroke data)
    │   → Newest first, 1 req/sec rate limit
    │
    ├── Compute: analytics engine runs after each sync
    │   → computed_metrics table (scores, trends, predictions)
    │
    ├── AI: Claude API (user's own key, optional)
    │   → ai_insights table (coaching notes, summaries)
    │
    ▼
SQLite (/data/rowdash.db)
    │
    ▼ (internal REST API)
    │
React frontend (Vite build, served as static files)
```

### Sync strategy

**Initial sync:** On first OAuth connection, paginate through all historical workouts (summary only). Frontend shows a progress indicator via `GET /api/sync/status` polling. May take several minutes for users with years of data.

**Incremental sync:** Every 15 minutes (configurable), fetch new workouts since the last sync timestamp. Smart detection: compare workout count from API against local count to show a "new session available" pulse in the ticker before the next scheduled sync.

**Stroke data enrichment:** Background job fetches per-stroke data for workouts that don't have it yet, newest first. Rate-limited to 1 request per second. Non-blocking — the dashboard works fully with summary data; stroke data enriches charts and enables the pace ribbon detail view. Progress visible in settings: "Enriching stroke data: 142/847 sessions · ~12 min remaining."

**Manual sync:** Button in settings and keyboard shortcut (`S`) to trigger immediate sync.

### Technology stack

**Backend:**
- Node.js 22 (LTS)
- Express 4.x
- better-sqlite3 (synchronous, no ORM)
- node-cron (sync scheduler)
- Native fetch (OAuth2, Claude API calls)

**Frontend:**
- React 18 (functional components, hooks)
- Vite 5 (dev server + production build)
- React Router 6 (client-side routing)
- Recharts 2 (line, bar, area, scatter charts)
- D3 scales + interpolation (pace ribbon canvas only)
- CSS Modules + CSS custom properties (theming)
- Lucide React (icons)

**State management:** React Context + `useReducer` for global state (theme, auth status, sync status, unit preference). Component-local state for everything else. No Redux, no Zustand.

**Docker:** Multi-stage build. Stage 1: Vite compiles frontend. Stage 2: Alpine Node.js production image serves static files via Express. No dev tooling in production.

---

## 4. Database schema

```sql
-- ══════════════════════════════════════
--  Core data (from C2 API)
-- ══════════════════════════════════════

CREATE TABLE workouts (
    id              INTEGER PRIMARY KEY,    -- C2 result ID
    user_id         INTEGER NOT NULL,
    date            TEXT NOT NULL,           -- ISO 8601
    timezone        TEXT,
    type            TEXT NOT NULL,           -- 'rower', 'skierg', 'bikeerg'
    workout_type    TEXT NOT NULL,           -- 'FixedDistanceSplits', 'FixedTimeSplits', etc.
    inferred_tag    TEXT,                    -- auto-detected: 'endurance', 'interval', 'test', 'warmup'
    distance        INTEGER NOT NULL,       -- metres
    time_ms         INTEGER NOT NULL,       -- duration in milliseconds
    pace_ms         INTEGER,                -- average pace per 500m in ms
    stroke_rate     REAL,                   -- average spm
    stroke_count    INTEGER,
    calories        INTEGER,
    heart_rate_avg  INTEGER,
    heart_rate_max  INTEGER,
    drag_factor     INTEGER,
    comments        TEXT,
    rest_distance   INTEGER,                -- for intervals
    rest_time_ms    INTEGER,                -- for intervals
    has_stroke_data INTEGER DEFAULT 0,      -- boolean: stroke data fetched?
    raw_json        TEXT,                   -- full API response for future-proofing
    synced_at       TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE intervals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    interval_index  INTEGER NOT NULL,
    type            TEXT,                    -- 'work' or 'rest'
    distance        INTEGER,
    time_ms         INTEGER,
    pace_ms         INTEGER,
    stroke_rate     REAL,
    stroke_count    INTEGER,
    calories        INTEGER,
    heart_rate_avg  INTEGER,
    heart_rate_max  INTEGER,
    UNIQUE(workout_id, interval_index)
);

CREATE TABLE strokes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    stroke_number   INTEGER NOT NULL,
    time_s          REAL,                   -- elapsed seconds
    distance_m      REAL,                   -- elapsed metres
    pace_ms         INTEGER,                -- per 500m in ms
    watts           REAL,
    cal_hr          REAL,
    stroke_rate     REAL,
    heart_rate      INTEGER,
    UNIQUE(workout_id, stroke_number)
);

-- ══════════════════════════════════════
--  Analytics (computed by the engine)
-- ══════════════════════════════════════

CREATE TABLE computed_metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    fade_index      REAL,                   -- % pace drop, first quarter vs last quarter
    consistency     REAL,                   -- split evenness score (0-100)
    effort_score    REAL,                   -- normalised difficulty rating
    drag_delta      REAL,                   -- difference from user's typical drag factor
    computed_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(workout_id)
);

CREATE TABLE fitness_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL UNIQUE,    -- one row per day
    fitness         REAL,                   -- CTL: chronic training load (rolling 42-day EWMA)
    fatigue         REAL,                   -- ATL: acute training load (rolling 7-day EWMA)
    form            REAL,                   -- TSB: fitness minus fatigue
    computed_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE predictions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    distance        INTEGER NOT NULL,       -- standard distance in metres (2000, 5000, etc.)
    predicted_time  INTEGER,                -- predicted PB time in ms
    confidence      REAL,                   -- 0-1 confidence based on data density
    window_start    TEXT,                   -- earliest projected PB date
    window_end      TEXT,                   -- latest projected PB date
    computed_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(distance)
);

-- ══════════════════════════════════════
--  AI insights (from Claude API)
-- ══════════════════════════════════════

CREATE TABLE ai_insights (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT NOT NULL,           -- 'session_note', 'weekly_summary', 'anomaly', 'query_response'
    workout_id      INTEGER REFERENCES workouts(id) ON DELETE CASCADE,
    week_start      TEXT,                   -- for weekly summaries
    content         TEXT NOT NULL,           -- the generated text
    prompt_tokens   INTEGER,
    response_tokens INTEGER,
    model           TEXT,                   -- e.g. 'claude-sonnet-4-6'
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ══════════════════════════════════════
--  System
-- ══════════════════════════════════════

CREATE TABLE sync_state (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL
);

-- ══════════════════════════════════════
--  Indexes
-- ══════════════════════════════════════

CREATE INDEX idx_workouts_date ON workouts(date DESC);
CREATE INDEX idx_workouts_type ON workouts(workout_type);
CREATE INDEX idx_workouts_distance ON workouts(distance);
CREATE INDEX idx_workouts_tag ON workouts(inferred_tag);
CREATE INDEX idx_strokes_workout ON strokes(workout_id);
CREATE INDEX idx_intervals_workout ON intervals(workout_id);
CREATE INDEX idx_computed_workout ON computed_metrics(workout_id);
CREATE INDEX idx_fitness_date ON fitness_log(date);
CREATE INDEX idx_insights_type ON ai_insights(type);
CREATE INDEX idx_insights_workout ON ai_insights(workout_id);
```

---

## 5. Analytics engine

The analytics engine runs server-side after each sync. It operates on the local SQLite data — no external API calls except for the AI features. All computations are deterministic and re-runnable.

### 5.1 Workout auto-tagging

When new workouts are synced, the engine examines the workout type and interval data to infer a human-readable tag:

| C2 workout_type | Intervals | Inferred tag |
|-----------------|-----------|--------------|
| `FixedDistanceSplits` | None or uniform | `endurance` |
| `FixedDistanceSplits` | Multiple work/rest | `interval` |
| `FixedTimeSplits` | None or uniform | `endurance` |
| `FixedTimeSplits` | Multiple work/rest | `interval` |
| Any | Distance is a standard test distance (2k, 5k, 6k, 10k) AND no rest intervals | `test` |
| Any | Distance < 2000m AND time < 10 min | `warmup` |

Tags are stored in `workouts.inferred_tag` and used for filtering, trend analysis, and AI context.

### 5.2 Per-session metrics

Computed for every workout that has stroke data. Stored in `computed_metrics`.

**Fade index:** Percentage pace degradation from first quarter to last quarter of the piece. Calculated as `((avg_pace_Q4 - avg_pace_Q1) / avg_pace_Q1) * 100`. Lower is better. A perfectly even-split session has a fade index near 0. Positive means you slowed down; negative means you negative-split (got faster).

**Consistency score (0–100):** How even were your splits? Calculated as `100 - (coefficient_of_variation_of_split_paces * scaling_factor)`. A session with perfectly identical splits scores 100. Wide variation scores lower. Tracking this over time is a genuine training signal — improving consistency is a coaching priority the C2 logbook ignores.

**Effort score:** Normalised difficulty rating that makes different workout types comparable. Combines pace (relative to the user's best at that distance), stroke rate (relative to the user's average), heart rate (if available), and duration. A 2k test and a 10k steady state become comparable on a single scale. Formula: weighted combination of pace percentile (40%), rate percentile (20%), HR percentile (20%), duration factor (20%).

**Drag factor delta:** Difference between this session's drag factor and the user's rolling 30-session average. Flags when it's drifted more than ±5 points — a nudge to clean the flywheel chain and fan housing.

### 5.3 Fitness / fatigue model

Borrows the well-established CTL/ATL/TSB model from TrainingPeaks, adapted for rowing:

**Training load per session:** `effort_score × (distance / 1000)`. This gives a single number representing the total training stress of each workout.

**Fitness (CTL — Chronic Training Load):** 42-day exponentially weighted moving average of daily training load. Represents your accumulated fitness base.

**Fatigue (ATL — Acute Training Load):** 7-day EWMA of daily training load. Represents recent fatigue.

**Form (TSB — Training Stress Balance):** `fitness - fatigue`. When positive, you're fresh and fit. When negative, you're fatigued. A large negative means you're overreaching.

Computed daily and stored in `fitness_log`. Visualised as a three-line chart in the Progress view.

### 5.4 Pace decay curve

For sessions with stroke data, compute the average pace per quartile (Q1–Q4) and overlay against the user's historical average decay curve at that distance. This reveals pacing patterns:

- Consistent: flat curve → well-paced
- Front-loaded: fast Q1, slow Q4 → going out too hard
- Negative split: slow Q1, fast Q4 → strong finish, good discipline

Shown on the session detail view as a small 4-bar chart comparing this session's quartile paces to the historical average.

### 5.5 Predicted PB windows

For each standard distance (2k, 5k, 6k, 10k, half marathon) where the user has ≥5 sessions:

1. Fit a weighted linear regression to the user's pace at that distance over time (more recent sessions weighted higher)
2. Extrapolate the trend to predict when the next PB will occur
3. Generate a confidence interval based on data density and variance
4. Store in `predictions` table

Displayed as: "5k PB window: 2–4 weeks at current trajectory" with a progress indicator. When the user is inside their predicted PB window, the PB card in the UI gets a subtle animated glow using `--hot`.

### 5.6 Split consistency tracking

Track the consistency score over time as a trended metric. Display in the Progress view alongside pace and volume trends. This is a novel training metric that no mainstream rowing app surfaces.

---

## 6. AI features (Claude API)

All AI features are optional. They require the user to provide their own Claude API key in settings. The key is stored encrypted in the SQLite database (AES-256-GCM, same pattern as OAuth tokens). All calls route through the Express backend — the key is never exposed to the frontend.

### 6.1 Model and cost

**Model:** `claude-sonnet-4-6` — fast, cheap, more than capable for the structured prompts used here.

**Cost per feature:**
- Session coach note: ~$0.001 (150 token response, ~800 token prompt)
- Weekly summary: ~$0.005 (400 token response, ~2000 token prompt)
- Anomaly narrative: ~$0.002 (100 token response, ~600 token prompt)
- Natural language query: ~$0.003 (200 token response, ~1000 token prompt)

**Monthly cost at 4 sessions/week:** ~$0.03. Genuinely negligible.

### 6.2 Context window strategy

Claude needs enough training history to make useful observations without costs ballooning. Every AI call includes a standardised context block:

```
User context:
- Last 20 sessions: date, distance, time, pace, rate, HR, type, tag, effort_score, consistency, fade_index
- Aggregate stats: total metres (season + lifetime), session count, avg pace (30d/90d/all), PB table
- Fitness/fatigue: current CTL, ATL, TSB values and 14-day trend direction
- Current session (if session-specific): full split data, stroke data summary (min/max/avg pace, rate)

Constraints:
- Be specific and data-grounded. Reference actual numbers.
- No generic motivational language. No "great job!" unless something genuinely warrants it.
- Keep responses under [token limit] tokens.
- Write in second person ("your pace dropped" not "the user's pace dropped").
```

This context is ~600–800 tokens and provides enough for genuinely insightful observations.

### 6.3 Session coach notes

**Trigger:** After each sync that pulls new workouts.

**Prompt pattern:** "Given the session data and training context below, provide one specific coaching observation about this workout. Focus on pacing strategy, effort patterns, or how this session fits into the recent training trajectory. Be concrete — reference numbers."

**Output:** 2–3 sentences. Stored in `ai_insights` with `type='session_note'`. Displayed on the session detail view as a text block below the header stats.

**Examples of good output:**
- "Your stroke rate dropped 3 spm in the last 500m but your pace only faded 2 seconds — that's efficient power maintenance under fatigue."
- "This is your third session this week where your first split was 4+ seconds faster than your average. Consider starting 2–3 seconds slower to preserve energy for the back half."
- "Your 5k pace has improved 5 seconds over the last 3 sessions at this distance. You're approaching your predicted PB window."

### 6.4 Weekly training summary

**Trigger:** On demand (button in UI), or automatically every Sunday evening if the user has opted in.

**Prompt pattern:** "Summarise this week's training. Cover: sessions completed, total volume, how it compares to last week, current fitness/fatigue/form status, any PBs or near-PBs, and one specific recommendation for next week."

**Output:** 4–6 sentences. Displayed in a dedicated "Weekly review" panel on the Dashboard view when a summary exists for the current week.

### 6.5 Anomaly detection narratives

**Trigger:** When the analytics engine detects an anomaly:
- Pace improved/degraded more than 2σ from the rolling trend
- Heart rate was unusually high/low relative to pace
- Drag factor drifted more than ±5 from the rolling average
- Streak broke after ≥4 consecutive weeks
- New PB set

**Prompt pattern:** "The analytics engine detected [specific anomaly]. Given the training context, provide a brief interpretation — what might explain this and whether any action is warranted."

**Output:** 1–2 sentences. Displayed as a notification-style card in the Dashboard feed.

### 6.6 Natural language query

**Trigger:** User types a question into the command bar in the ticker.

**Prompt pattern:** System prompt instructs Claude to interpret the natural language query and respond with structured JSON indicating which data to fetch and how to display it. The backend interprets this JSON, runs the appropriate SQLite queries, and returns the result to the frontend.

**Example queries and responses:**
- "my fastest 5k this year" → routes to the session detail view for that workout
- "compare last Wednesday to the one before" → opens session comparison overlay
- "how has my stroke rate changed over the last month" → renders a rate-over-time line chart
- "sessions where I held sub-2:00 pace" → filters the workouts table
- "am I overtraining?" → shows the fitness/fatigue chart with a narrative interpretation

**Implementation:** Two-step process. Step 1: Claude interprets the query and returns a structured intent (which API endpoint to call, with what parameters). Step 2: The frontend executes that intent. This keeps Claude out of the data path — it interprets, it doesn't access.

---

## 7. Quality of life features

### 7.1 Session comparison overlay

Pick any two sessions of the same distance and overlay their pace curves stroke-by-stroke on the same chart. The left panel shows the dual-line overlay with a shaded difference ribbon (green where session B was faster, red where slower). Summary stats show the delta for pace, rate, and HR. Accessed via a "Compare with..." dropdown on any session detail view, or by selecting two rows in the workouts table.

### 7.2 Pace format preference

Global toggle: pace (/500m), watts, or cal/hr. Applies across the entire UI — every pace display, every chart axis, every table column. Persisted in settings. Defaults to /500m pace.

### 7.3 Keyboard shortcuts

| Key | Action |
|-----|--------|
| `J` / `K` | Navigate up/down in the feed panel |
| `Enter` | Open selected session in primary panel |
| `C` | Enter comparison mode (select a second session) |
| `F` | Toggle fullscreen on focused chart |
| `S` | Trigger manual sync |
| `/` | Focus the natural language query bar |
| `T` | Toggle theme |
| `1–4` | Switch between Dashboard / Progress / Workouts / Settings |

### 7.4 Export

One-click export from the workouts table or settings:
- **Per-session:** Download the selected session as JSON (includes splits, strokes, computed metrics, AI notes)
- **Bulk:** Export all data as JSON or CSV. JSON preserves the full structure; CSV flattens to one row per workout for spreadsheet users
- **Not buried in settings** — export button visible in the workouts table header

### 7.5 Smart sync indicator

The ticker shows sync status with three states:
1. **Green dot:** Up to date, no new data since last sync
2. **Pulsing dot:** New session detected on C2 (lightweight count check), sync pending
3. **Spinning:** Sync in progress

The "new session detected" state checks on a shorter interval (every 2 minutes) by doing a HEAD-style count query against the C2 API — cheap and respectful.

### 7.6 Rate limiter visibility

During initial sync or stroke data backfill, show a progress bar in settings with:
- Sessions synced / total
- Estimated time remaining
- Current rate (req/sec)
- Ability to pause/resume

### 7.7 Drag factor monitoring

Track drag factor over time. When it drifts more than ±5 from the user's 30-session rolling average, surface a subtle notification: "Your drag factor has drifted from 125 to 118 over the last 5 sessions. This could affect pace comparability. Clean the flywheel chain and fan housing, then recalibrate." Dismiss once, don't nag.

### 7.8 Dark mode that works

- System preference detection (`prefers-color-scheme`)
- Manual override (light / dark / system) in settings and via `T` shortcut
- Persisted server-side in SQLite settings table, not localStorage
- Theme applies via CSS custom properties — no JS re-rendering
- Transition: 200ms ease on `background-color` and `color` only (no flash, no FOUC)

---

## 8. API routes

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/login` | Redirects to C2 OAuth2 authorization |
| `GET` | `/auth/callback` | Handles OAuth2 callback, stores tokens |
| `GET` | `/auth/status` | Returns auth state + user info |
| `POST` | `/auth/logout` | Clears stored tokens |

### Workouts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workouts` | List workouts. Params: `from`, `to`, `type`, `tag`, `min_distance`, `sort`, `limit`, `offset` |
| `GET` | `/api/workouts/:id` | Single workout with intervals, strokes, computed metrics, AI notes |

### Stats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats/summary` | Season/lifetime metres, session count, streak, avg pace |
| `GET` | `/api/stats/trends` | Time-series data. Params: `metric` (pace/volume/rate/consistency/effort), `period`, `from`, `to` |
| `GET` | `/api/stats/personal-bests` | PBs for standard distances with predictions |
| `GET` | `/api/stats/compare` | Side-by-side comparison. Param: `ids` (comma-separated) |
| `GET` | `/api/stats/fitness` | Fitness/fatigue/form time series. Params: `from`, `to` |
| `GET` | `/api/stats/decay-curve` | Pace quartile data for a distance. Params: `distance`, `workout_id` (optional, for comparison) |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sync` | Trigger manual sync |
| `GET` | `/api/sync/status` | Current state, last sync time, enrichment progress |

### AI

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai/insight/:workout_id` | Get or generate a session coaching note |
| `GET` | `/api/ai/weekly` | Get or generate this week's training summary |
| `POST` | `/api/ai/query` | Natural language query. Body: `{ "query": "..." }` |
| `GET` | `/api/ai/status` | Whether Claude API key is configured and valid |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings` | All settings (theme, units, sync interval, AI preferences) |
| `PATCH` | `/api/settings` | Update settings |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | 200 with uptime, last sync, DB size, sync status. For Beszel/Uptime Kuma. |

---

## 9. Frontend views

### 9.1 Onboarding / Connect

First-run experience. Centered layout (no ticker, no feed panel). Shows:
- RowDash logo and one-line description
- "Connect to Concept2" button → OAuth2 flow
- After auth: initial sync progress (session count, estimated time, progress bar)
- Optional: "Add Claude API key" step (skippable)
- On completion: redirect to dashboard

### 9.2 Dashboard (home)

The at-a-glance view. Primary panel shows:

**Stats row:** Season metres, sessions this week, current streak, 30-day avg pace (with delta vs prior 30 days). Displayed as a single bordered row divided into cells (not separate cards).

**Charts grid (2-column):**
- Left: weekly volume bar chart (12 weeks, endurance vs interval stacked)
- Right: pace trend line chart (all distances, smoothed)

**PB strip:** Horizontal row of PB cards for standard distances (2k, 5k, 10k, HM). Each shows time, pace, and date. New PBs highlighted with `--hot` dot. PB cards in the predicted window get a subtle glow.

**Weekly AI summary (if available):** Text block below the charts with this week's AI-generated training summary.

**Fitness/fatigue mini chart:** Small sparkline showing the last 30 days of CTL/ATL/TSB.

### 9.3 Session detail

Deep dive into a single workout. Primary panel shows:

**Header:** Date, distance, time, avg pace, avg rate, avg HR — displayed as large stat cells.

**Pace ribbon (expanded):** Full-width canvas-rendered pace heatmap using D3 colour scales. Per-stroke if stroke data exists, per-interval otherwise.

**AI coach note:** 2–3 sentence coaching observation (if Claude API key is configured).

**Charts (if stroke data):**
- Pace over distance/time (Recharts `LineChart`)
- Stroke rate over distance/time (secondary axis or separate chart)
- Heart rate over distance/time (if available)
- Pace decay quartile chart (this session vs historical average)

**Intervals table (if interval workout):** Split data with best interval highlighted.

**Computed metrics:** Fade index, consistency score, effort score, drag factor delta — shown as a small metrics bar.

**Compare button:** "Compare with..." dropdown showing sessions of the same distance/tag.

### 9.4 Session comparison

When comparing two sessions, the primary panel shows:

**Dual header:** Both sessions' summary stats side by side with deltas.

**Overlaid pace chart:** Two lines on the same axes. Difference ribbon shaded green/red.

**Split-by-split table:** Both sessions' intervals or quartiles in parallel columns.

### 9.5 Progress

Long-term trend analysis. Primary panel shows:

**Fitness / fatigue / form chart:** Three-line time series (CTL, ATL, TSB). Toggle between 30/60/90 day views.

**Pace trends:** Filterable by distance and tag. Shows individual data points + smoothed trend line.

**Consistency trend:** How split evenness has changed over time.

**Volume trends:** Monthly metres, sessions, hours — toggle between metrics.

**Stroke rate vs pace scatter:** All sessions plotted. Colour-coded by distance band. Useful for spotting efficiency patterns.

**Predicted PB windows:** Cards for each standard distance showing projected PB timing and confidence.

### 9.6 Workouts (log)

Full history table in the primary panel:

- Columns: date, tag, distance, time, pace, rate, HR, effort score, consistency
- Filters: date range, tag multi-select, distance range
- Sort by any column
- Multi-select for bulk comparison or export
- Export button in table header

### 9.7 Settings

- Theme: light / dark / system
- Units: pace / watts / cal/hr
- Concept2: connection status, reconnect, disconnect
- Sync: interval dropdown (5/15/30/60 min), manual trigger, enrichment progress
- Claude API: key input (masked), test connection, auto-generate preferences (session notes on/off, weekly summary on/off, anomaly alerts on/off)
- Data: export all (JSON/CSV), clear database, DB size
- About: version, links

### 9.8 Natural language query bar

Accessible via `/` keyboard shortcut or clicking the search area in the ticker. Opens an overlay input field. User types a natural language question. Claude interprets it, the frontend executes the resulting intent (navigate to a view, filter data, render a chart, show a narrative).

---

## 10. Project structure

```
rowdash/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── README.md
├── LICENSE
│
├── server/
│   ├── package.json
│   ├── server.js                        # Entry point, Express setup, static serving
│   ├── src/
│   │   ├── db.js                        # SQLite init, migrations, prepared statements
│   │   ├── auth.js                      # OAuth2 flow, token storage/refresh
│   │   ├── sync.js                      # C2 API sync, stroke enrichment, rate limiter
│   │   ├── analytics.js                 # Computed metrics, fitness model, predictions
│   │   ├── ai.js                        # Claude API proxy, prompt builder, context assembler
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── workouts.js
│   │   │   ├── stats.js
│   │   │   ├── sync.js
│   │   │   ├── ai.js
│   │   │   ├── settings.js
│   │   │   └── health.js
│   │   └── middleware/
│   │       ├── error.js                 # Global error handler
│   │       └── validate.js              # Request validation
│   └── migrations/
│       └── 001-initial.sql
│
├── client/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── public/
│   │   └── fonts/
│   │       ├── outfit-*.woff2
│   │       └── fira-code-*.woff2
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                      # Layout shell: ticker + primary + feed
│       ├── api.js                       # Fetch wrapper, error handling
│       ├── context/
│       │   ├── ThemeContext.jsx
│       │   ├── AuthContext.jsx
│       │   ├── SyncContext.jsx
│       │   └── UnitsContext.jsx
│       ├── hooks/
│       │   ├── useWorkouts.js
│       │   ├── useStats.js
│       │   ├── useAI.js
│       │   └── useKeyboard.js
│       ├── styles/
│       │   ├── tokens.css
│       │   ├── global.css
│       │   └── ticker.css
│       ├── views/
│       │   ├── Dashboard.jsx
│       │   ├── Session.jsx
│       │   ├── Comparison.jsx
│       │   ├── Progress.jsx
│       │   ├── Workouts.jsx
│       │   ├── Settings.jsx
│       │   └── Connect.jsx
│       └── components/
│           ├── Ticker/
│           │   ├── Ticker.jsx           # The persistent top bar
│           │   ├── PaceTrace.jsx        # SVG trace in ticker
│           │   ├── QueryBar.jsx         # Natural language input
│           │   └── Ticker.module.css
│           ├── Feed/
│           │   ├── FeedPanel.jsx        # Right-hand session feed
│           │   ├── FeedItem.jsx         # Individual session card
│           │   ├── Sparkline.jsx        # Per-session pace sparkline
│           │   └── Feed.module.css
│           ├── PaceRibbon/
│           │   ├── PaceRibbon.jsx       # Canvas-rendered pace heatmap
│           │   └── PaceRibbon.module.css
│           ├── Charts/
│           │   ├── PaceChart.jsx
│           │   ├── VolumeChart.jsx
│           │   ├── FitnessChart.jsx     # CTL/ATL/TSB three-line chart
│           │   ├── DecayCurve.jsx       # Quartile comparison bars
│           │   ├── ScatterPlot.jsx
│           │   ├── ComparisonOverlay.jsx # Dual-line with difference ribbon
│           │   └── Charts.module.css
│           ├── Stats/
│           │   ├── StatsRow.jsx
│           │   ├── PBStrip.jsx
│           │   ├── MetricsBar.jsx       # Fade, consistency, effort, drag
│           │   └── Stats.module.css
│           └── common/
│               ├── Card.jsx
│               ├── Button.jsx
│               ├── Select.jsx
│               ├── ProgressBar.jsx
│               ├── Spinner.jsx
│               └── Tooltip.jsx
```

---

## 11. Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `C2_CLIENT_ID` | Yes | — | Concept2 OAuth2 client ID |
| `C2_CLIENT_SECRET` | Yes | — | Concept2 OAuth2 client secret |
| `C2_REDIRECT_URI` | No | `http://localhost:3100/auth/callback` | OAuth2 callback URL |
| `C2_API_BASE` | No | `https://log.concept2.com` | API base. Set to `https://log-dev.concept2.com` for dev. |
| `CLAUDE_API_KEY` | No | — | Can also be set via UI. Env var takes precedence. |
| `SYNC_INTERVAL_MINUTES` | No | `15` | How often to sync new workouts |
| `DATA_DIR` | No | `/data` | SQLite DB and config location |
| `PORT` | No | `3000` | Internal server port |

---

## 12. Docker

### Dockerfile (multi-stage)

```dockerfile
# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=frontend-build /app/client/dist ./dist

EXPOSE 3000
VOLUME /data

ENV NODE_ENV=production
ENV DATA_DIR=/data

CMD ["node", "server.js"]
```

### Docker Compose

```yaml
services:
  rowdash:
    build: .
    container_name: rowdash
    ports:
      - "3100:3000"
    volumes:
      - rowdash-data:/data
    environment:
      - C2_CLIENT_ID=${C2_CLIENT_ID}
      - C2_CLIENT_SECRET=${C2_CLIENT_SECRET}
      - C2_REDIRECT_URI=${C2_REDIRECT_URI:-http://localhost:3100/auth/callback}
      - SYNC_INTERVAL_MINUTES=${SYNC_INTERVAL_MINUTES:-15}
      - CLAUDE_API_KEY=${CLAUDE_API_KEY:-}
    restart: unless-stopped

volumes:
  rowdash-data:
```

---

## 13. Resilience & stability

- **SQLite WAL mode** enabled at DB init for concurrent reads during sync writes.
- **Graceful degradation:** Dashboard works fully with summary data. Stroke data enriches charts. AI features enhance insights. Each layer is optional — the core experience works without strokes or Claude.
- **Token refresh:** C2 OAuth2 tokens last ~1 hour, refresh tokens ~1 year. Auto-refresh before expiry. If refresh fails, UI shows a reconnect prompt, never a blank screen.
- **Claude API resilience:** All AI calls wrapped in try/catch with timeouts (10s). If Claude is down, the UI shows cached insights or a "not available" placeholder. AI failure never blocks any other functionality.
- **Error boundaries:** React error boundaries per-view. API errors caught server-side and logged. Frontend shows meaningful error states with retry actions.
- **Health endpoint:** `GET /health` returns 200 with uptime, last sync, DB size, enrichment status. Compatible with Beszel, Uptime Kuma, or any HTTP health checker.
- **Backup:** Entire state is one SQLite file. Back up the Docker volume or copy `rowdash.db` directly.
- **Rate limiting:** C2 API sync self-limits to 1 req/sec. Claude API calls are inherently infrequent. No abuse risk.
- **Process resilience:** `restart: unless-stopped`. Uncaught exceptions exit cleanly. Docker restarts. No in-process crash recovery.

---

## 14. Concept2 API reference

**Base URL:** `https://log.concept2.com` (production) / `https://log-dev.concept2.com` (development)

**Auth:** OAuth2 Authorization Code + Refresh grant. Register at Profile → Edit Profile → Applications. Scopes: `user:read,results:read`.

**Key endpoints:**
- `GET /api/users/me` — user profile
- `GET /api/users/me/results` — paginated workout list (max 250 per page)
- `GET /api/users/me/results/:id` — single workout with stroke data

**Pagination:** Page-based. Response includes `meta.pagination.links.next`. Default 50 per page, max 250.

**Rate limiting:** Not currently enforced. We self-limit to 1 req/sec anyway.

**Token lifecycle:** Access tokens expire in ~1 hour. Refresh tokens last ~1 year. Refresh returns a new refresh token, so the chain is indefinite as long as the user doesn't go >1 year without using the app.

**Dev server requirement:** Concept2 requires new applications to develop against `log-dev.concept2.com` first. Contact Concept2 for production approval once development is complete.

**Stroke data availability:** Only workouts recorded via ErgData (Bluetooth) have per-stroke data. Workouts logged manually or via USB/PM5 have summary data only. The `has_stroke_data` flag distinguishes between them.

---

## 15. Resolved decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Design direction | Broadcast (E) | Ticker navigation is distinctive and maximises content area. Feed panel provides persistent context. No sidebar = not a generic dashboard. |
| Typography | Outfit + Fira Code | Geometric, broadcast feel (Outfit) paired with a proper coding font for data (Fira Code). Both open source. |
| Frontend | React 18 + Vite 5 | Multi-view app with interactive charts, overlays, filtering, theming. Vite for fast dev + tiny production build. |
| Charting | Recharts + D3 scales | Recharts for standard charts (React-native, composable). D3 scales for precise colour mapping in the canvas pace ribbon. |
| State | React Context + useReducer | Global state is minimal: theme, auth, sync, units. No Redux needed. |
| Styling | CSS Modules + custom properties | Scoped styles, no conflicts. Custom properties for theme toggle without JS re-rendering. |
| Database | SQLite (better-sqlite3) | Single-user, read-heavy, ~5k rows max. One file = trivial backup. |
| AI model | claude-sonnet-4-6 | Fast, cheap (~$0.03/month), capable enough for structured coaching prompts. |
| AI architecture | Backend proxy | Claude API key never exposed to frontend. All calls through Express. Cached results in ai_insights table. |
| Docker | Multi-stage, single container | Frontend builds at image build time. Production image is Node.js Alpine only. One port, one volume. |
| Stroke priority | Newest first | Users care most about recent sessions. Background enrichment works backwards. |
| Analytics | Server-side, post-sync | All computations run in the Express process after sync. Deterministic, re-runnable, no external deps. |

---

## 16. What's NOT in v1

- **Training plan tracking (BPP/custom)** — schema supports it (see predictions table pattern), UI is v2
- **Bodyweight / press-up logging** — out of scope, rowing only
- **Multi-user support** — single C2 account per instance
- **SkiErg / BikeErg views** — data stored but UI focuses on rowing
- **Strava / Garmin integration** — C2 Logbook is the single source of truth
- **Push notifications** — not needed for self-hosted
- **Force curve data** — not available via C2 API (BLE/ErgData only)
- **Mobile native app** — responsive web only
- **Social / sharing features** — single-user product

---

## 17. Build phases

### Phase 1: Foundation
- Project scaffolding (server + client directories, Docker setup)
- SQLite schema, migrations, WAL mode
- OAuth2 flow with Concept2 (dev server first)
- Initial sync + incremental sync with progress reporting
- Health endpoint

### Phase 2: Core UI
- Ticker bar with navigation, theme toggle, sync status
- Feed panel with workout list and sparklines
- Dashboard view: stats row, volume chart, pace trend, PB strip
- Session detail view: header stats, pace ribbon, split charts
- Workouts log: filterable, sortable table

### Phase 3: Analytics engine
- Workout auto-tagging
- Per-session computed metrics (fade index, consistency, effort score, drag delta)
- Fitness/fatigue/form model (CTL/ATL/TSB)
- Predicted PB windows
- Pace decay curve analysis
- Progress view with all trend charts

### Phase 4: Quality of life
- Session comparison overlay
- Pace format toggle (pace / watts / cal/hr)
- Keyboard shortcuts
- Export (JSON + CSV)
- Smart sync indicator
- Enrichment progress bar
- Drag factor monitoring
- Dark mode persistence

### Phase 5: AI integration
- Claude API key management (settings UI + encrypted storage)
- Session coach notes (auto-generate on sync)
- Weekly training summary
- Anomaly detection narratives
- Natural language query bar

### Phase 6: Polish
- Mobile responsive (ticker collapse, feed below content, bottom nav)
- Accessibility (pace ribbon table fallback, focus management, ARIA)
- Error states and empty states
- Onboarding flow refinement
- README and documentation
- Production C2 API approval
