import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import {
  deleteKnownHost,
  exportKnownHosts,
  importKnownHosts,
  listKnownHosts,
  trustHostKey
} from '../ssh/known-hosts-service.js';

const TrustHostKeySchema = z.object({
  hostname: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  keyType: z.string().max(120),
  fingerprint: z.string().trim().min(1).max(512)
});

const ImportSchema = z.object({
  content: z.string().min(1).max(2_000_000)
});

export const knownHostsRouter = Router();

knownHostsRouter.get('/', (_req, res) => {
  res.json({ knownHosts: listKnownHosts() });
});

knownHostsRouter.get('/export', (_req, res) => {
  res.json({ content: exportKnownHosts() });
});

knownHostsRouter.post(
  '/trust',
  asyncHandler(async (req, res) => {
    const input = parse(TrustHostKeySchema, req.body);
    res.status(201).json({ knownHost: trustHostKey(input) });
  })
);

knownHostsRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const input = parse(ImportSchema, req.body);
    res.json({ ...importKnownHosts(input.content) });
  })
);

knownHostsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteKnownHost(req.params.id);
    res.status(204).end();
  })
);
