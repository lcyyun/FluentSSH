import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { runExec } from '../ssh/exec-service.js';

const InlineConnectionSchema = z.object({
  hostname: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65_535).optional(),
  username: z.string().trim().min(1).max(120),
  authType: z.enum(['password', 'key', 'agent', 'keyboard-interactive']).optional(),
  password: z.string().max(4096).optional(),
  keyId: z.string().max(120).nullable().optional(),
  passphrase: z.string().max(4096).optional(),
  name: z.string().max(120).optional(),
  proxyJumpId: z.string().max(120).nullable().optional(),
  connectTimeout: z.number().int().min(1000).max(300_000).optional(),
  keepaliveInterval: z.number().int().min(0).max(600_000).optional()
});

const ExecInputSchema = z
  .object({
    hostId: z.string().min(1).max(120).optional(),
    inline: InlineConnectionSchema.optional(),
    command: z.string().min(1).max(200_000),
    timeoutMs: z.number().int().min(1000).max(600_000).optional()
  })
  .refine((value) => Boolean(value.hostId || value.inline), {
    message: '需要提供 hostId 或 inline 连接信息。',
    path: ['hostId']
  });

export const execRouter = Router();

execRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(ExecInputSchema, req.body);
    res.json({ result: await runExec(input) });
  })
);
