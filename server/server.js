import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './src/db.js';
import { startSyncSchedule } from './src/sync.js';
import { isAuthenticated } from './src/auth.js';
import { errorHandler } from './src/middleware/error.js';
import { seedDatabase } from './src/seed.js';

import healthRouter from './src/routes/health.js';
import authRouter from './src/routes/auth.js';
import workoutsRouter from './src/routes/workouts.js';
import statsRouter from './src/routes/stats.js';
import syncRouter from './src/routes/sync.js';
import aiRouter from './src/routes/ai.js';
import settingsRouter from './src/routes/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

initDb();

if (process.env.NODE_ENV !== 'production') {
  seedDatabase();
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ credentials: true }));
app.use(compression());
app.use(morgan('short'));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/auth', authRouter);

function requireAuth(req, res, next) {
  if (process.env.NODE_ENV !== 'production' && !isAuthenticated()) {
    return next();
  }
  if (!isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

app.use('/api/workouts', requireAuth, workoutsRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/sync', requireAuth, syncRouter);
app.use('/api/ai', requireAuth, aiRouter);
app.use('/api/settings', settingsRouter);

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

if (isAuthenticated()) {
  startSyncSchedule();
}

app.listen(PORT, () => {
  console.log(`RowDash server listening on port ${PORT}`);
});
