import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Snippet } from '../../../shared/types.js';
import { asyncHandler, parse } from '../core/http.js';
import { getStore } from '../core/store.js';
import { notFound } from '../core/errors.js';

const SnippetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  command: z.string().min(1).max(20_000),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional()
});

export const snippetsRouter = Router();

snippetsRouter.get('/', (_req, res) => {
  res.json({ snippets: getStore().data.snippets });
});

snippetsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(SnippetInputSchema, req.body);
    const now = Date.now();
    const snippet: Snippet = {
      id: randomUUID(),
      name: input.name,
      command: input.command,
      description: input.description ?? '',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now
    };
    getStore().mutate((data) => {
      data.snippets.unshift(snippet);
    });
    res.status(201).json({ snippet });
  })
);

snippetsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(SnippetInputSchema.partial(), req.body);
    const snippet = getStore().data.snippets.find((item) => item.id === req.params.id);
    if (!snippet) throw notFound('命令片段不存在。');
    Object.assign(snippet, {
      ...input,
      updatedAt: Date.now()
    });
    getStore().flush();
    res.json({ snippet });
  })
);

snippetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const store = getStore();
    const before = store.data.snippets.length;
    store.mutate((data) => {
      data.snippets = data.snippets.filter((item) => item.id !== req.params.id);
    });
    if (before === getStore().data.snippets.length) throw notFound('命令片段不存在。');
    res.status(204).end();
  })
);
