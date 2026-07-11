import { Router } from 'express';
import {
  listProfiles,
  getProfile,
  renameProfile,
  deleteProfile,
  clearAuth,
} from '../auth.js';
import { isSyncInProgress } from '../sync.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listProfiles());
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfile(id)) return res.status(404).json({ error: 'Profile not found' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const profile = renameProfile(id, name);
  res.json({ id: profile.id, name: profile.name });
});

router.post('/:id/disconnect', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfile(id)) return res.status(404).json({ error: 'Profile not found' });
  clearAuth(id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getProfile(id)) return res.status(404).json({ error: 'Profile not found' });
  if (isSyncInProgress(id)) {
    return res.status(409).json({ error: 'Profile is currently syncing; try again shortly' });
  }
  deleteProfile(id);
  res.json({ ok: true });
});

export default router;
