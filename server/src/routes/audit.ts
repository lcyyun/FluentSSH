import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { getStore } from '../core/store.js';

export const auditRouter = Router();

auditRouter.get('/', (req, res) => {
  const query = parse(
    z.object({
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      category: z.string().max(32).optional(),
      level: z.enum(['info', 'warn', 'error']).optional()
    }),
    req.query
  );
  let events = getStore().data.audit;
  if (query.category) events = events.filter((event) => event.category === query.category);
  if (query.level) events = events.filter((event) => event.level === query.level);
  res.json({ events: events.slice(0, query.limit ?? 300) });
});

auditRouter.delete('/', (_req, res) => {
  getStore().mutate((data) => {
    data.audit = [];
  });
  res.status(204).end();
});
