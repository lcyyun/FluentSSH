import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, APP_NAME } from './config.js';
import { initStore, getStore } from './core/store.js';
import { initVault } from './core/vault.js';
import { initSessionLogStore } from './core/session-logs.js';
import { sessionCookieMiddleware, requireSession } from './core/session-cookie.js';
import { errorMiddleware } from './core/http.js';
import { attachWebSockets, closeWebSockets } from './ws.js';
import { metaRouter } from './routes/meta.js';
import { hostsRouter, groupsRouter } from './routes/hosts.js';
import { vaultRouter } from './routes/vault.js';
import { settingsRouter } from './routes/settings.js';
import { snippetsRouter } from './routes/snippets.js';
import { auditRouter } from './routes/audit.js';
import { authPromptsRouter } from './routes/auth-prompts.js';
import { sessionsRouter } from './routes/sessions.js';
import { keysRouter } from './routes/keys.js';
import { knownHostsRouter } from './routes/known-hosts.js';
import { execRouter } from './routes/exec.js';
import { commandsRouter } from './routes/commands.js';
import { logsRouter } from './routes/logs.js';
import { sftpRouter } from './routes/sftp.js';
import { tunnelsRouter } from './routes/tunnels.js';
import { initTunnels, stopAllTunnels } from './tunnels/service.js';
import { closeAllSessions } from './ssh/session-manager.js';

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = initStore(config.dataDir);
  const vault = initVault(config.dataDir, store.data.settings.security.autoLockMinutes);
  initSessionLogStore(config.dataDir);
  // Load persisted tunnels and start autoStart tunnels once the HTTP server is up.
  initTunnels();

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '30mb' }));
  app.use(sessionCookieMiddleware);

  // Every API request extends the vault auto-lock window.
  app.use('/api', (req, _res, next) => {
    if (req.path !== '/vault/touch') vault.touch();
    next();
  });
  app.use('/api', requireSession);

  app.use('/api', metaRouter);
  app.use('/api/hosts', hostsRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/vault', vaultRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/snippets', snippetsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/auth/prompts', authPromptsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/keys', keysRouter);
  app.use('/api/known-hosts', knownHostsRouter);
  app.use('/api/exec', execRouter);
  app.use('/api/commands', commandsRouter);
  app.use('/api/logs', logsRouter);
  app.use('/api/sftp', sftpRouter);
  app.use('/api/tunnels', tunnelsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } });
  });

  const indexHtml = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.webDistDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.sendFile(indexHtml);
    });
  } else {
    app.get('*', (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          '<!doctype html><html><head><meta charset="utf-8"><title>FluentSSH</title></head><body style="font-family:Segoe UI, sans-serif; padding:40px"><h1>FluentSSH API is running</h1><p>The web UI has not been built yet. Run <code>pnpm dev</code> or <code>pnpm build</code> then <code>pnpm start</code>.</p></body></html>'
        );
    });
  }

  app.use(errorMiddleware);

  const server = http.createServer(app);
  attachWebSockets(server);

  server.listen(config.port, config.host, () => {
    console.log(`\n  ${APP_NAME} ${config.version}`);
    console.log(`  Local:   http://${config.host}:${config.port}`);
    console.log(`  Data:    ${config.dataDir}`);
    console.log(`  Vault:   ${vault.status().protected ? 'protected' : 'local key'} / ${vault.status().unlocked ? 'unlocked' : 'locked'}`);
    console.log(`  Web UI:  ${fs.existsSync(indexHtml) ? 'built' : 'not built (use pnpm dev)'}\n`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n[server] ${signal} received, shutting down...`);
    closeWebSockets();
    void (async () => {
      try {
        await Promise.allSettled([stopAllTunnels(), closeAllSessions()]);
      } catch {
        // ignore
      }
      try {
        getStore().flush();
      } catch {
        // ignore
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error('[server] uncaught exception', error);
  });
  process.on('unhandledRejection', (error) => {
    console.error('[server] unhandled rejection', error);
  });
}

main().catch((error) => {
  console.error('[server] failed to start', error);
  process.exit(1);
});
