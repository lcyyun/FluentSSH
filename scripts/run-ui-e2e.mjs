#!/usr/bin/env node
/**
 * One-command UI E2E runner.
 *
 * Builds the web app, starts the mock SSH/SFTP lab + a throwaway FluentSSH
 * server (temp data dir, random port), seeds two lab hosts, runs Playwright
 * against the installed Chrome, then cleans everything up.
 *
 * Prerequisites: `pnpm install`, Google Chrome installed at the expected path
 * (tests/ui.test.mjs uses C:/Program Files/Google/Chrome/Application/chrome.exe).
 *
 * Run: pnpm test:ui
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'tests/.artifacts');
const isWindows = process.platform === 'win32';
const children = [];

function run(label, command, args, env = {}) {
  console.log(`\n[${label}] ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, shell: isWindows });
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logFile = fs.openSync(path.join(ARTIFACTS, `ui-e2e-${label}.log`), 'a');
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.stdout.on('data', (chunk) => fs.writeSync(logFile, chunk));
  child.stderr.on('data', (chunk) => fs.writeSync(logFile, chunk));
  children.push({ label, child });
  return child;
}

function stopChildren() {
  for (const { child } of children) {
    if (!child.pid) continue;
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // best effort
    }
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

fs.mkdirSync(ARTIFACTS, { recursive: true });
for (const file of ['mock-lab.json', 'e2e-seed.json']) {
  fs.rmSync(path.join(ARTIFACTS, file), { force: true });
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentssh-ui-e2e-'));
const port = await getFreePort();
const BASE = `http://127.0.0.1:${port}`;

try {
  console.log('▸ building web app…');
  run('build', 'pnpm', ['exec', 'vite', 'build']);

  console.log('▸ starting mock SSH/SFTP lab and FluentSSH server…');
  start('mock-lab', 'pnpm', ['exec', 'tsx', 'scripts/mock-lab.ts']);
  start('server', 'pnpm', ['exec', 'tsx', 'server/src/index.ts'], {
    FLUENTSSH_PORT: String(port),
    FLUENTSSH_DATA_DIR: dataDir
  });
  await waitFor(
    async () => (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })).ok,
    40_000,
    'FluentSSH server'
  );
  await waitFor(() => fs.existsSync(path.join(ARTIFACTS, 'mock-lab.json')), 30_000, 'mock lab details');

  console.log('▸ seeding lab hosts and trusting host keys…');
  run('seed', process.execPath, ['scripts/e2e-setup.mjs'], { E2E_BASE: BASE });

  console.log('▸ running Playwright UI E2E…');
  run('ui', process.execPath, ['tests/ui.test.mjs'], { QA_BASE: BASE });
  console.log('\nUI E2E finished successfully. Screenshots: tests/.artifacts/e2e-*.png');
} catch (error) {
  console.error('\nUI E2E runner failed:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  stopChildren();
  await new Promise((resolve) => setTimeout(resolve, 800));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
