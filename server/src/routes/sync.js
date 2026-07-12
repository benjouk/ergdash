import { Router } from 'express';
import { getSyncStatus, runIncrementalSync } from '../sync.js';
import { isProfileConnected } from '../auth.js';

const router = Router();

// A manual sync is one of the few actions that genuinely needs the active
// profile connected — otherwise runIncrementalSync no-ops on a missing token
// and the caller gets a misleading "started". Reading status stays allowed.
router.post('/', (req, res) => {
  if (!isProfileConnected(req.profileId)) {
    return res.status(409).json({ error: 'Profile is not connected to Concept2.' });
  }
  runIncrementalSync(req.profileId).catch(err => console.error('Manual sync failed:', err));
  res.json({ status: 'started' });
});

router.get('/status', (req, res) => {
  res.json(getSyncStatus(req.profileId));
});

export default router;
