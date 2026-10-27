import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import {
  createTunnel,
  deleteTunnel,
  listTunnelInfos,
  startTunnel,
  stopTunnel,
  updateTunnel
} from '../tunnels/service.js';

/**
 * Tunnel REST API (see docs/API.md). Configs are persisted by the service;
 * live state and SSH connections are in-memory.
 */

const HostSchema = z.string().trim().max(255);

const TunnelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  hostId: z.string().trim().min(1).max(120),
  type: z.enum(['local', 'remote', 'dynamic']),
  // `bindHost` / `targetHost` accept an empty string: the UI sends '' for the
  // fields it hides (dynamic tunnels have no target at all).
  bindHost: HostSchema.optional(),
  bindPort: z.number().int().min(0).max(65535),
  targetHost: HostSchema.optional(),
  targetPort: z.number().int().min(0).max(65535).optional(),
  autoStart: z.boolean().optional()
});

const TunnelPatchSchema = TunnelInputSchema.partial();

export const tunnelsRouter = Router();

tunnelsRouter.get('/', (_req, res) => {
  res.json({ tunnels: listTunnelInfos() });
});

tunnelsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(TunnelInputSchema, req.body);
    const tunnel = createTunnel(input);
    res.status(201).json({ tunnel });
  })
);

tunnelsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = parse(TunnelPatchSchema, req.body);
    const tunnel = updateTunnel(req.params.id, patch);
    res.json({ tunnel });
  })
);

tunnelsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const stop = req.query.stop === '1' || req.query.stop === 'true';
    await deleteTunnel(req.params.id, { stop });
    res.status(204).end();
  })
);

tunnelsRouter.post(
  '/:id/start',
  asyncHandler(async (req, res) => {
    const tunnel = await startTunnel(req.params.id);
    res.json({ tunnel });
  })
);

tunnelsRouter.post(
  '/:id/stop',
  asyncHandler(async (req, res) => {
    const tunnel = await stopTunnel(req.params.id);
    res.json({ tunnel });
  })
);
