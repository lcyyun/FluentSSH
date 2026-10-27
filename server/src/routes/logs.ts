import { Router } from 'express';
import fs from 'node:fs';
import { asyncHandler } from '../core/http.js';
import { ApiError } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { getSessionLogStore } from '../core/session-logs.js';

export const logsRouter = Router();

logsRouter.get('/', (_req, res) => {
  const logs = getSessionLogStore().list().map((meta) => {
    let size = meta.size;
    try {
      if (fs.existsSync(meta.path)) size = fs.statSync(meta.path).size;
    } catch {
      // keep the recorded size
    }
    return { ...meta, size };
  });
  res.json({ logs });
});

logsRouter.get(
  '/:sessionId',
  asyncHandler(async (req, res) => {
    const { meta, content } = getSessionLogStore().read(req.params.sessionId);
    if (!meta && !content) {
      throw new ApiError(404, 'NOT_FOUND', '会话记录不存在或已被删除。');
    }
    const body = content ?? Buffer.alloc(0);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.sessionId}.log"`);
    res.setHeader('Content-Length', String(body.length));
    res.send(body);
  })
);

logsRouter.delete(
  '/:sessionId',
  asyncHandler(async (req, res) => {
    const { meta, content } = getSessionLogStore().read(req.params.sessionId);
    if (!meta && !content) {
      throw new ApiError(404, 'NOT_FOUND', '会话记录不存在或已被删除。');
    }
    getSessionLogStore().remove(req.params.sessionId);
    audit('connection', 'info', `删除会话记录 ${meta?.hostLabel ?? req.params.sessionId}`, {
      hostLabel: meta?.hostLabel ?? null,
      details: { sessionId: req.params.sessionId }
    });
    res.status(204).end();
  })
);
