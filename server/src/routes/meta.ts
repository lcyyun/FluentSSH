import { Router } from 'express';
import { getRequestToken } from '../core/session-cookie.js';
import { config, APP_NAME } from '../config.js';
import { getVault } from '../core/vault.js';
import { getStore } from '../core/store.js';
import os from 'node:os';
import path from 'node:path';

export const metaRouter = Router();

metaRouter.get('/health', (_req, res) => {
  res.json({ ok: true, name: APP_NAME, version: config.version });
});

metaRouter.get('/bootstrap', (req, res) => {
  res.json({
    info: {
      name: APP_NAME,
      version: config.version,
      platform: os.platform(),
      nodeVersion: process.version,
      dataDir: path.basename(config.dataDir) === 'data' ? 'data' : config.dataDir,
      serverTime: Date.now(),
      eventToken: getRequestToken(req) ?? ''
    },
    vault: getVault().status(),
    settings: getStore().data.settings
  });
});

metaRouter.get('/info', (_req, res) => {
  res.json({
    name: APP_NAME,
    version: config.version,
    platform: os.platform(),
    nodeVersion: process.version,
    serverTime: Date.now()
  });
});
