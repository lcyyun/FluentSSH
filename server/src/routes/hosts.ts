import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { getStore } from '../core/store.js';
import {
  createGroup,
  createHost,
  deleteGroup,
  deleteHost,
  duplicateHost,
  exportSshConfig,
  getHostOrThrow,
  importSshConfig,
  listGroups,
  toHostProfile,
  updateGroup,
  updateHost
} from '../core/hosts-service.js';

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #rrggbb');

const TerminalPrefsSchema = z.object({
  term: z.string().max(64).optional(),
  fontSize: z.number().min(8).max(40).optional(),
  colorScheme: z.string().max(64).optional(),
  encoding: z.string().max(32).optional()
});

const HostInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  hostname: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1).max(120),
  groupId: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  favorite: z.boolean().optional(),
  color: ColorSchema.optional(),
  authType: z.enum(['password', 'key', 'agent', 'keyboard-interactive']).optional(),
  keyId: z.string().nullable().optional(),
  password: z.string().max(4096).optional(),
  passphrase: z.string().max(4096).optional(),
  proxyJumpId: z.string().nullable().optional(),
  terminal: TerminalPrefsSchema.optional(),
  startupCommand: z.string().max(4096).optional(),
  env: z.record(z.string(), z.string()).optional(),
  keepaliveInterval: z.number().int().min(0).max(600_000).optional(),
  connectTimeout: z.number().int().min(1000).max(300_000).optional(),
  compression: z.boolean().optional(),
  legacyAlgorithms: z.boolean().optional(),
  defaultPath: z.string().max(1024).optional(),
  notes: z.string().max(10_000).optional()
});

const GroupInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: ColorSchema.optional(),
  parentId: z.string().nullable().optional()
});

export const hostsRouter = Router();

hostsRouter.get('/', (_req, res) => {
  res.json({ hosts: getStore().data.hosts.map(toHostProfile) });
});

hostsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(HostInputSchema, req.body);
    if (input.proxyJumpId) {
      // proxyJumpId is validated by existence later on connect; keep the create fast.
    }
    const host = createHost(input);
    res.status(201).json({ host });
  })
);

hostsRouter.post(
  '/import/ssh-config',
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ content: z.string().min(1).max(1_000_000), groupName: z.string().max(80).optional() }),
      req.body
    );
    res.json({ result: importSshConfig(input.content, input.groupName) });
  })
);

hostsRouter.get('/export', (req, res) => {
  const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(Boolean) : undefined;
  const content = exportSshConfig(ids?.length ? ids : undefined);
  res.json({ content });
});

hostsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const host = getHostOrThrow(req.params.id);
    res.json({ host: toHostProfile(host) });
  })
);

hostsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(HostInputSchema.partial(), req.body);
    res.json({ host: updateHost(req.params.id, input) });
  })
);

hostsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteHost(req.params.id);
    res.status(204).end();
  })
);

hostsRouter.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    res.status(201).json({ host: duplicateHost(req.params.id) });
  })
);

hostsRouter.get(
  '/:id/ssh-config',
  asyncHandler(async (req, res) => {
    getHostOrThrow(req.params.id);
    res.json({ content: exportSshConfig([req.params.id]) });
  })
);

/* ----------------------------- Groups ----------------------------- */

export const groupsRouter = Router();

groupsRouter.get('/', (_req, res) => {
  res.json({ groups: listGroups() });
});

groupsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(GroupInputSchema, req.body);
    res.status(201).json({ group: createGroup(input) });
  })
);

groupsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(GroupInputSchema.partial(), req.body);
    res.json({ group: updateGroup(req.params.id, input) });
  })
);

groupsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteGroup(req.params.id);
    res.status(204).end();
  })
);

