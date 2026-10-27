import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse } from '../core/http.js';
import { getStore } from '../core/store.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { getVault } from '../core/vault.js';
import { audit } from '../core/audit.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json({ settings: getStore().data.settings });
});

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(
      z
        .object({
          theme: z.enum(['light', 'dark', 'system']).optional(),
          accent: z.enum(['blue', 'teal', 'purple', 'green', 'orange', 'pink', 'graphite']).optional(),
          reduceMotion: z.boolean().optional(),
          compactMode: z.boolean().optional(),
          terminal: z
            .object({
              fontFamily: z.string().max(200).optional(),
              fontSize: z.number().min(9).max(32).optional(),
              lineHeight: z.number().min(1).max(2).optional(),
              cursorStyle: z.enum(['block', 'underline', 'bar']).optional(),
              cursorBlink: z.boolean().optional(),
              scrollback: z.number().int().min(1000).max(200_000).optional(),
              bell: z.boolean().optional(),
              copyOnSelect: z.boolean().optional()
            })
            .partial()
            .optional(),
          security: z
            .object({
              autoLockMinutes: z.number().min(0).max(1440).optional(),
              lockOnBrowserBlur: z.boolean().optional(),
              strictHostKeys: z.boolean().optional(),
              recordSessions: z.boolean().optional()
            })
            .partial()
            .optional(),
          connections: z
            .object({
              keepaliveInterval: z.number().int().min(0).max(600_000).optional(),
              connectTimeout: z.number().int().min(1000).max(300_000).optional(),
              defaultUsername: z.string().max(120).optional(),
              defaultPort: z.number().int().min(1).max(65535).optional()
            })
            .partial()
            .optional(),
          files: z
            .object({
              showHidden: z.boolean().optional(),
              confirmDelete: z.boolean().optional(),
              editorFontSize: z.number().min(9).max(32).optional()
            })
            .partial()
            .optional(),
          ui: z
            .object({
              navCollapsed: z.boolean().optional(),
              hostView: z.enum(['grid', 'list']).optional()
            })
            .partial()
            .optional()
        })
        .strict(),
      req.body
    );
    const settings = getStore().updateSettings(input);
    getVault().configureAutoLock(settings.security.autoLockMinutes);
    res.json({ settings });
  })
);

settingsRouter.post('/', (_req, res) => {
  const settings = getStore().updateSettings(DEFAULT_SETTINGS);
  getVault().configureAutoLock(settings.security.autoLockMinutes);
  audit('system', 'info', '恢复默认设置');
  res.json({ settings });
});
