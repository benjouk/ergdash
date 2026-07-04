import { Router } from 'express';

const router = Router();

router.get('/insight/:workout_id', (req, res) => {
  res.status(501).json({ error: 'AI features not yet implemented' });
});

router.get('/weekly', (req, res) => {
  res.status(501).json({ error: 'AI features not yet implemented' });
});

router.post('/query', (req, res) => {
  res.status(501).json({ error: 'AI features not yet implemented' });
});

router.get('/status', (req, res) => {
  res.json({
    configured: !!process.env.CLAUDE_API_KEY,
    available: false,
  });
});

export default router;
