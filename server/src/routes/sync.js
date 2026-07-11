import { Router } from 'express';
import { getSyncStatus, runIncrementalSync } from '../sync.js';

const router = Router();

router.post('/', (req, res) => {
  runIncrementalSync(req.profileId).catch(err => console.error('Manual sync failed:', err));
  res.json({ status: 'started' });
});

router.get('/status', (req, res) => {
  res.json(getSyncStatus(req.profileId));
});

export default router;
