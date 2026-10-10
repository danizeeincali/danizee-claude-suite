import express from 'express';

export const router = express.Router();

router.post('/api/upload', (req, res) => {
  res.json({ stored: true });
});

router.get('/api/health', (req, res) => res.json({ ok: true }));
