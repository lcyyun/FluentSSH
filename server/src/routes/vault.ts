import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { getVault } from '../core/vault.js';
import { getStore } from '../core/store.js';
import { audit } from '../core/audit.js';

export const vaultRouter = Router();

vaultRouter.get('/', (_req, res) => {
  res.json({ status: getVault().status() });
});

vaultRouter.post(
  '/unlock',
  asyncHandler(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(1024) }), req.body);
    const status = getVault().unlock(password);
    audit('vault', 'info', '保险库已解锁');
    res.json({ status });
  })
);

vaultRouter.post('/lock', (_req, res) => {
  const status = getVault().lock('manual');
  audit('vault', 'info', '保险库已锁定');
  res.json({ status });
});

vaultRouter.post(
  '/protect',
  asyncHandler(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(6).max(1024) }), req.body);
    const status = await getVault().protect(password);
    getVault().configureAutoLock(getStore().data.settings.security.autoLockMinutes);
    audit('vault', 'info', '已设置主密码保护保险库');
    res.json({ status });
  })
);

vaultRouter.post(
  '/unprotect',
  asyncHandler(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(1024) }), req.body);
    const status = getVault().unprotect(password);
    getVault().configureAutoLock(0);
    audit('vault', 'warn', '已移除保险库主密码');
    res.json({ status });
  })
);

vaultRouter.post('/touch', (_req, res) => {
  getVault().touch();
  res.json({ status: getVault().status() });
});
