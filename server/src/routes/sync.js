import { Router } from 'express';
import { getSyncStatus, runIncrementalSync } from '../sync.js';

const router = Router();

router.post('/', (req, res) => {
  runIncrementalSync().catch(err => console.error('Manual sync failed:', err));
  res.json({ status: 'started' });
});

router.get('/status', (req, res) => {
  res.json(getSyncStatus());
});

export default router;
