import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverSrcDir = path.dirname(fileURLToPath(import.meta.url));
/** D:\ssh */
export const ROOT_DIR = path.resolve(serverSrcDir, '../..');

export const config = {
  host: process.env.FLUENTSSH_HOST ?? '127.0.0.1',
  port: Number(process.env.FLUENTSSH_PORT ?? 4317),
  dataDir: path.resolve(process.env.FLUENTSSH_DATA_DIR ?? path.join(ROOT_DIR, 'data')),
  webDistDir: path.resolve(process.env.FLUENTSSH_WEB_DIST ?? path.join(ROOT_DIR, 'web/dist')),
  version: '1.0.0',
  isDev: process.env.NODE_ENV === 'development',
  /** How often (ms) an idle browser extends the vault auto-lock timer. */
  vaultTouchIntervalMs: 60_000
};

export const APP_NAME = 'FluentSSH';
