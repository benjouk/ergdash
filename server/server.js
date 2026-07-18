import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from './src/db.js';
import { startSyncSchedule } from './src/sync.js';
import { startRankingRefreshSchedule } from './src/rankingsLive.js';
import { initAuth, hasValidSession, hasConnectedProfile } from './src/auth.js';
import { errorHandler } from './src/middleware/error.js';
import { resolveProfile } from './src/middleware/profile.js';
import { isDevAuthBypassEnabled, sameOriginWriteGuard, validateCorsOriginConfig } from './src/middleware/security.js';
import { seedDatabase, shouldAutoSeedDemoData } from './src/seed.js';
import {
  tagAllWorkouts,
  computeAllMetrics,
  computeFitnessLog,
  computePredictions,
  computeAllZoneTimes,
  computeAllBestEfforts,
} from './src/analytics.js';
import { backfillPbHistory } from './src/pbDetection.js';

import healthRouter from './src/routes/health.js';
import authRouter from './src/routes/auth.js';
import workoutsRouter from './src/routes/workouts.js';
import statsRouter from './src/routes/stats.js';
import syncRouter from './src/routes/sync.js';
import insightsRouter from './src/routes/insights.js';
import settingsRouter from './src/routes/settings.js';
import adminRouter from './src/routes/admin.js';
import goalsRouter from './src/routes/goals.js';
import plansRouter from './src/routes/plans.js';
import programsRouter from './src/routes/programs.js';
import importRouter from './src/routes/import.js';
import profilesRouter from './src/routes/profiles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

initDb();
initAuth();

if (shouldAutoSeedDemoData()) {
  seedDatabase();
}

app.use(helmet({
  // ErgDash explicitly supports direct HTTP access on a trusted LAN/VPN.
  // Never teach browsers to upgrade that address to HTTPS; operators using
  // HTTPS can set transport policy at their reverse proxy.
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
}));
// The client is always same-origin (Express serves the built frontend; the
// Vite dev server proxies /api, /auth and /health), so cross-origin access is
// disabled unless explicitly opted in via CORS_ORIGIN.
app.use(cors({ origin: validateCorsOriginConfig(), credentials: true }));
app.use(compression());
app.use(morgan('short'));
// Import routes parse their own bodies (raw file uploads and multi-MB commit
// payloads); the default 100kb JSON parser must not run for them.
const jsonParser = express.json();
app.use((req, res, next) => {
  if (req.path.startsWith('/api/import')) return next();
  return jsonParser(req, res, next);
});
app.use(sameOriginWriteGuard);

app.use('/health', healthRouter);
app.use('/auth', authRouter);

// Session is the only auth gate; profile resolution (and per-profile
// connection state) is handled by resolveProfile and the routes themselves,
// so a household member with a disconnected profile can still browse data
// and manage profiles.
function requireAuth(req, res, next) {
  if (isDevAuthBypassEnabled()) {
    // Explicit local-development bypass. In dev, use /auth/mock-login to get a session.
    return next();
  }
  if (!hasValidSession(req)) {
    return res.status(401).json({ error: 'Not authenticated. Please visit /auth/login to connect Concept2.' });
  }
  next();
}

app.use('/api/profiles', requireAuth, profilesRouter);
app.use('/api/workouts', requireAuth, resolveProfile, workoutsRouter);
app.use('/api/stats', requireAuth, resolveProfile, statsRouter);
app.use('/api/sync', requireAuth, resolveProfile, syncRouter);
app.use('/api/insights', requireAuth, resolveProfile, insightsRouter);
app.use('/api/settings', requireAuth, resolveProfile, settingsRouter);
app.use('/api/admin', requireAuth, resolveProfile, adminRouter);
app.use('/api/goals', requireAuth, resolveProfile, goalsRouter);
app.use('/api/plans', requireAuth, resolveProfile, plansRouter);
app.use('/api/programs', requireAuth, resolveProfile, programsRouter);
app.use('/api/import', requireAuth, resolveProfile, importRouter);

const distPath = join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/health') {
    return next();
  }
  res.sendFile(join(distPath, 'index.html'), err => {
    if (err) next();
  });
});

app.use(errorHandler);

recomputePacesIfMissing();
for (const { id } of getDb().prepare('SELECT id FROM profiles').all()) {
  backfillPbHistory(id);
  tagAllWorkouts(id);
  computeAllMetrics(id);
  computeFitnessLog(id);
  computePredictions(id);
  computeAllZoneTimes(id);
  computeAllBestEfforts(id);
}

if (hasConnectedProfile()) {
  startSyncSchedule();
}

startRankingRefreshSchedule();

function recomputePacesIfMissing() {
  const db = getDb();
  const missing = db.prepare(
    'SELECT COUNT(*) as c FROM workouts WHERE pace_ms IS NULL AND time_ms > 0 AND distance > 0'
  ).get().c;
  if (missing > 0) {
    db.prepare(
      'UPDATE workouts SET pace_ms = ROUND((CAST(time_ms AS REAL) / distance) * 500) WHERE pace_ms IS NULL AND time_ms > 0 AND distance > 0'
    ).run();
    db.prepare(
      'UPDATE intervals SET pace_ms = ROUND((CAST(time_ms AS REAL) / distance) * 500) WHERE pace_ms IS NULL AND time_ms > 0 AND distance > 0'
    ).run();
    console.log(`Recomputed pace for ${missing} workouts`);
  }
}

app.listen(PORT, () => {
  console.log(`ErgDash server listening on port ${PORT}`);
});
