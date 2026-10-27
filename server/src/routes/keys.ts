import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { generateKey, importKey, listKeys, updateKey, deleteKey } from '../ssh/keys-service.js';

const KeyAlgorithmSchema = z.enum(['ed25519', 'rsa', 'ecdsa']);

const KeyGenerateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  algorithm: KeyAlgorithmSchema.optional(),
  bits: z.number().int().min(256).max(8192).optional(),
  comment: z.string().max(1024).optional(),
  passphrase: z.string().max(4096).optional()
});

const KeyImportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  privateKey: z.string().min(1).max(1_000_000),
  passphrase: z.string().max(4096).optional(),
  comment: z.string().max(1024).optional()
});

const KeyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  comment: z.string().max(1024).optional()
});

export const keysRouter = Router();

keysRouter.get('/', (_req, res) => {
  res.json({ keys: listKeys() });
});

keysRouter.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const input = parse(KeyGenerateSchema, req.body);
    res.status(201).json({ key: generateKey(input) });
  })
);

keysRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const input = parse(KeyImportSchema, req.body);
    res.status(201).json({ key: importKey(input) });
  })
);

keysRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parse(KeyUpdateSchema, req.body);
    res.json({ key: updateKey(req.params.id, input) });
  })
);

keysRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteKey(req.params.id);
    res.status(204).end();
  })
);
