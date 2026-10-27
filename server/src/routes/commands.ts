import { Router } from 'express';
import { clearCommandHistory, listCommandHistory } from '../ssh/exec-service.js';

export const commandsRouter = Router();

commandsRouter.get('/history', (req, res) => {
  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;
  const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
  res.json({ history: listCommandHistory(limit) });
});

commandsRouter.delete('/history', (_req, res) => {
  clearCommandHistory();
  res.status(204).end();
});
