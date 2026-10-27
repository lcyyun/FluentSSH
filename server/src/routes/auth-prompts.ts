import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { promptBroker } from '../core/prompts.js';

export const authPromptsRouter = Router();

authPromptsRouter.get('/', (_req, res) => {
  res.json({ prompts: promptBroker.list() });
});

authPromptsRouter.post(
  '/:requestId/respond',
  asyncHandler(async (req, res) => {
    const { responses } = parse(z.object({ responses: z.array(z.string().max(4096)).max(20) }), req.body);
    promptBroker.respond(req.params.requestId, responses);
    res.json({ ok: true });
  })
);

authPromptsRouter.post(
  '/:requestId/cancel',
  asyncHandler(async (req, res) => {
    promptBroker.cancel(req.params.requestId);
    res.json({ ok: true });
  })
);
