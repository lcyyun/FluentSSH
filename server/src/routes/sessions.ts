import { Router } from 'express';
import { z } from 'zod';
import type { SessionKind } from '../../../shared/types.js';
import { asyncHandler, parse } from '../core/http.js';
import { ApiError } from '../core/errors.js';
import {
  closeSession,
  createSftpSession,
  createTerminalSession,
  disconnectSession,
  getSessionInfo,
  listSessions,
  reconnectSession
} from '../ssh/session-manager.js';

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

const TargetSchema = z.object({
  hostId: z.string().min(1).max(120).optional(),
  inline: InlineConnectionSchema.optional()
});

const TerminalInputSchema = TargetSchema.extend({
  cols: z.number().int().min(2).max(1000).optional(),
  rows: z.number().int().min(1).max(1000).optional(),
  title: z.string().max(200).optional(),
  initialCommand: z.string().max(8192).optional()
}).refine((value) => Boolean(value.hostId || value.inline), {
  message: '需要提供 hostId 或 inline 连接信息。',
  path: ['hostId']
});

const SftpInputSchema = TargetSchema.extend({
  initialPath: z.string().max(4096).optional(),
  title: z.string().max(200).optional()
}).refine((value) => Boolean(value.hostId || value.inline), {
  message: '需要提供 hostId 或 inline 连接信息。',
  path: ['hostId']
});

export const sessionsRouter = Router();

sessionsRouter.get('/', (req, res) => {
  const rawKind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  if (rawKind && rawKind !== 'terminal' && rawKind !== 'sftp') {
    throw new ApiError(400, 'VALIDATION', 'kind 仅支持 terminal 或 sftp。');
  }
  res.json({ sessions: listSessions(rawKind as SessionKind | undefined) });
});

sessionsRouter.post(
  '/terminal',
  asyncHandler(async (req, res) => {
    const input = parse(TerminalInputSchema, req.body);
    res.status(202).json({ session: createTerminalSession(input) });
  })
);

sessionsRouter.post(
  '/sftp',
  asyncHandler(async (req, res) => {
    const input = parse(SftpInputSchema, req.body);
    res.status(202).json({ session: createSftpSession(input) });
  })
);

sessionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = getSessionInfo(req.params.id);
    if (!session) throw new ApiError(404, 'NOT_FOUND', '会话不存在或已被删除。');
    res.json({ session });
  })
);

sessionsRouter.post(
  '/:id/reconnect',
  asyncHandler(async (req, res) => {
    res.status(202).json({ session: reconnectSession(req.params.id) });
  })
);

sessionsRouter.post(
  '/:id/disconnect',
  asyncHandler(async (req, res) => {
    res.json({ session: disconnectSession(req.params.id) });
  })
);

sessionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await closeSession(req.params.id);
    res.status(204).end();
  })
);
