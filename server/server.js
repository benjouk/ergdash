import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from './src/db.js';
import { startSyncSchedule } from './src/sync.js';
import { initAuth, hasValidSession, isAuthenticated } from './src/auth.js';
import { errorHandler } from './src/middleware/error.js';
import { seedDatabase } from './src/seed.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

initDb();
initAuth();

if (process.env.NODE_ENV !== 'production') {
  seedDatabase();
}

app.use(helmet({ contentSecurityPolicy: false }));
// The client is always same-origin (Express serves the built frontend; the
// Vite dev server proxies /api, /auth and /health), so cross-origin access is
// disabled unless explicitly opted in via CORS_ORIGIN.
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(compression());
app.use(morgan('short'));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/auth', authRouter);

function requireAuth(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    // Dev mode: bypass auth. In dev, use /auth/mock-login to get a session
    return next();
  }
  if (!isAuthenticated() || !hasValidSession(req)) {
    return res.status(401).json({ error: 'Not authenticated. Please visit /auth/login to connect Concept2.' });
  }
  next();
}

app.use('/api/workouts', requireAuth, workoutsRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/sync', requireAuth, syncRouter);
app.use('/api/insights', requireAuth, insightsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/admin', requireAuth, adminRouter);
app.use('/api/goals', requireAuth, goalsRouter);
app.use('/api/plans', requireAuth, plansRouter);

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
backfillPbHistory();
tagAllWorkouts();
computeAllMetrics();
computeFitnessLog();
computePredictions();
computeAllZoneTimes();
computeAllBestEfforts();

if (isAuthenticated()) {
  startSyncSchedule();
}

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
