/**
 * End-to-end tests for the SFTP + tunnels backend.
 *
 * Spawns the real FluentSSH server on a random port with a temp data dir and
 * exercises the HTTP API against a standalone mock SSH/SFTP server fixture.
 *
 * Run: pnpm exec tsx tests/sftp-tunnels.test.ts
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ServerEvent, SessionInfo, TunnelInfo } from '../shared/types.js';
import { startMockSftpServer } from './fixtures/mock-sftp.js';
import type { MockSftpServer } from './fixtures/mock-sftp.js';
import { startTunnelTarget } from './fixtures/tunnel-target.js';
import type { TunnelTargetHandle } from './fixtures/tunnel-target.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Result tracking                                                     */
/* ------------------------------------------------------------------ */

const results: string[] = [];
let failures = 0;
let activeApp: AppHandle | null = null;

function ok(name: string, details = '') {
  results.push(`PASS ${name}${details ? ` — ${details}` : ''}`);
  console.log(`  ✔ ${name}${details ? ` — ${details}` : ''}`);
}

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push(`FAIL ${name} — ${message}\n`);
    console.error(`  ✘ ${name}\n${message}\n`);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => resolve());
  });
  const address = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

interface ApiCallOptions {
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

interface ApiResult {
  status: number;
  headers: Headers;
  buffer: Buffer;
  text: string;
  data: unknown;
}

class ApiClient {
  cookie = '';
  constructor(private readonly base: string) {}

  private async fetchRaw(pathname: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await fetch(`${this.base}${pathname}`, { ...init, headers, redirect: 'manual' });
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0] ?? '';
      if (pair.startsWith('fluentssh_sid=')) this.cookie = pair;
    }
    return response;
  }

  async call(method: string, pathname: string, options: ApiCallOptions = {}): Promise<ApiResult> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: string | Buffer | undefined;
    if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/octet-stream';
      body = options.body;
    }
    const response = await this.fetchRaw(pathname, { method, headers, body: body as BodyInit | undefined });
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: response.status, headers: response.headers, buffer, text, data };
  }

  async bootstrap(): Promise<void> {
    const response = await this.call('GET', '/api/bootstrap');
    assert.equal(response.status, 200, `bootstrap failed: ${response.text}`);
  }
}

function errorCodeOf(result: ApiResult): unknown {
  return (result.data as { error?: { code?: unknown } } | null)?.error?.code;
}

function errorDetailsOf(result: ApiResult): Record<string, unknown> | null {
  return ((result.data as { error?: { details?: Record<string, unknown> } } | null)?.error?.details ?? null) as Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/* App lifecycle                                                       */
/* ------------------------------------------------------------------ */

interface AppHandle {
  port: number;
  base: string;
  dataDir: string;
  client: ApiClient;
  child: ChildProcess;
  logs: () => string;
  stop: () => Promise<void>;
}

async function startApp(dataDir?: string): Promise<AppHandle> {
  const dir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fluentssh-sftp-tunnels-data-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      FLUENTSSH_HOST: HOST,
      FLUENTSSH_PORT: String(port),
      FLUENTSSH_DATA_DIR: dir,
      // Keep the API-only HTML fallback; don't depend on a web build.
      FLUENTSSH_WEB_DIST: path.join(ROOT, 'web', 'dist', '__sftp_tunnels_test_missing__')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const base = `http://${HOST}:${port}`;
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early (code ${child.exitCode})\n${stdout}\n${stderr}`);
    }
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await sleep(150);
  }
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`server did not become ready\n${stdout}\n${stderr}`);
  }
  const client = new ApiClient(base);
  await client.bootstrap();
  const handle: AppHandle = {
    port,
    base,
    dataDir: dir,
    client,
    child,
    logs: () => `--- server stdout ---\n${stdout}\n--- server stderr ---\n${stderr}`,
    stop: async () => {
      const exited = () => child.exitCode !== null || child.signalCode !== null;
      if (exited()) return;
      child.kill('SIGTERM');
      const softDeadline = Date.now() + 5000;
      while (!exited() && Date.now() < softDeadline) await sleep(50);
      if (!exited()) {
        child.kill('SIGKILL');
        const hardDeadline = Date.now() + 3000;
        while (!exited() && Date.now() < hardDeadline) await sleep(50);
      }
    }
  };
  activeApp = handle;
  return handle;
}

function removeDataDir(app: AppHandle) {
  try {
    fs.rmSync(app.dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Event WebSocket                                                     */
/* ------------------------------------------------------------------ */

interface EventSocket {
  events: ServerEvent[];
  waitFor: <T extends ServerEvent['type']>(
    type: T,
    timeoutMs?: number,
    predicate?: (event: Extract<ServerEvent, { type: T }>) => boolean
  ) => Promise<Extract<ServerEvent, { type: T }>>;
  close: () => void;
}

async function openEventSocket(app: AppHandle): Promise<EventSocket> {
  const bootstrap = await app.client.call('GET', '/api/bootstrap');
  const token = (bootstrap.data as { info: { eventToken: string } }).info.eventToken;
  assert.ok(token, 'bootstrap must return an event token');
  const ws = new WebSocket(`ws://${HOST}:${app.port}/ws/events?token=${encodeURIComponent(token)}`);
  const events: ServerEvent[] = [];
  type Waiter = {
    type: string;
    predicate: (event: ServerEvent) => boolean;
    resolve: (event: ServerEvent) => void;
    timer: NodeJS.Timeout;
  };
  const waiters: Waiter[] = [];
  ws.on('message', (raw) => {
    try {
      const event = JSON.parse(raw.toString()) as ServerEvent;
      events.push(event);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter.type === event.type && waiter.predicate(event)) {
          clearTimeout(waiter.timer);
          waiters.splice(index, 1);
          waiter.resolve(event);
        }
      }
    } catch {
      // ignore malformed frames
    }
  });
  await once(ws, 'open');
  // The server sends `hello` right after the upgrade; wait for it so callers
  // never race the handshake.
  const helloDeadline = Date.now() + 3000;
  while (Date.now() < helloDeadline && !events.some((event) => event.type === 'hello')) await sleep(10);
  return {
    events,
    waitFor: (type, timeoutMs = 5000, predicate = () => true) =>
      new Promise((resolve, reject) => {
        // Only future events count: callers assert on transitions and stale
        // events from previous steps must not satisfy the wait.
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for server event ${type}; saw: ${events.map((event) => event.type).join(', ')}`));
        }, timeoutMs);
        waiters.push({
          type,
          predicate: predicate as (event: ServerEvent) => boolean,
          resolve: resolve as (event: ServerEvent) => void,
          timer
        });
      }),
    close: () => ws.close()
  };
}

/* ------------------------------------------------------------------ */
/* Tunnel helpers                                                      */
/* ------------------------------------------------------------------ */

async function listTunnels(app: AppHandle): Promise<TunnelInfo[]> {
  const response = await app.client.call('GET', '/api/tunnels');
  assert.equal(response.status, 200, response.text);
  return (response.data as { tunnels: TunnelInfo[] }).tunnels;
}

async function createTunnel(app: AppHandle, input: Record<string, unknown>): Promise<TunnelInfo> {
  const response = await app.client.call('POST', '/api/tunnels', { json: input });
  assert.equal(response.status, 201, `create tunnel failed: ${response.text}`);
  return (response.data as { tunnel: TunnelInfo }).tunnel;
}

async function startTunnel(app: AppHandle, id: string): Promise<TunnelInfo> {
  const response = await app.client.call('POST', `/api/tunnels/${id}/start`);
  assert.equal(response.status, 200, `start tunnel failed: ${response.text}`);
  return (response.data as { tunnel: TunnelInfo }).tunnel;
}

async function stopTunnel(app: AppHandle, id: string): Promise<TunnelInfo> {
  const response = await app.client.call('POST', `/api/tunnels/${id}/stop`);
  assert.equal(response.status, 200, `stop tunnel failed: ${response.text}`);
  return (response.data as { tunnel: TunnelInfo }).tunnel;
}

async function httpGet(url: string, timeoutMs = 5000): Promise<{ status: number; text: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { status: response.status, text: await response.text(), headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* SOCKS5 test client                                                  */
/* ------------------------------------------------------------------ */

interface SocketReader {
  read: (length: number) => Promise<Buffer>;
  readAll: () => Promise<Buffer>;
}

function createSocketReader(socket: net.Socket): SocketReader {
  let buffer = Buffer.alloc(0);
  let ended = false;
  const pending: Array<{ length: number; resolve: (value: Buffer) => void; reject: (error: Error) => void }> = [];
  const allWaiters: Array<{ resolve: (value: Buffer) => void; reject: (error: Error) => void }> = [];
  let failure: Error | null = null;

  const flush = () => {
    while (pending.length > 0 && buffer.length >= pending[0].length) {
      const waiter = pending.shift() as (typeof pending)[number];
      const value = buffer.subarray(0, waiter.length);
      buffer = buffer.subarray(waiter.length);
      waiter.resolve(value);
    }
    if (ended || failure) {
      while (pending.length > 0) {
        const waiter = pending.shift() as (typeof pending)[number];
        if (failure) waiter.reject(failure);
        else waiter.reject(new Error('socket closed while waiting for data'));
      }
      if (ended || failure) {
        while (allWaiters.length > 0) {
          const waiter = allWaiters.shift() as (typeof allWaiters)[number];
          if (failure) waiter.reject(failure);
          else waiter.resolve(buffer);
        }
        buffer = Buffer.alloc(0);
      }
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  });
  socket.on('end', () => {
    ended = true;
    flush();
  });
  socket.on('error', (error) => {
    failure = error;
    flush();
  });

  return {
    read: (length: number) =>
      new Promise<Buffer>((resolve, reject) => {
        pending.push({ length, resolve, reject });
        flush();
      }),
    readAll: () =>
      new Promise<Buffer>((resolve, reject) => {
        allWaiters.push({ resolve, reject });
        flush();
      })
  };
}

async function socksHttpRequest(
  proxyPort: number,
  targetHost: string,
  targetPort: number,
  requestPath: string,
  mode: 'ipv4' | 'domain' = 'ipv4'
): Promise<{ status: number; text: string }> {
  const socket = net.connect({ host: HOST, port: proxyPort });
  await once(socket, 'connect');
  const reader = createSocketReader(socket);

  // Greeting: SOCKS5, one method, no-auth.
  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  const greeting = await reader.read(2);
  assert.equal(greeting[0], 0x05, 'SOCKS version');
  assert.equal(greeting[1], 0x00, 'SOCKS no-auth method');

  const address =
    mode === 'domain'
      ? Buffer.concat([Buffer.from([0x03, Buffer.byteLength(targetHost)]), Buffer.from(targetHost, 'utf8')])
      : Buffer.from([0x01, ...targetHost.split('.').map((part) => Number(part) & 0xff)]);
  const request = Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00]),
    address,
    Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
  ]);
  socket.write(request);
  const reply = await reader.read(10);
  assert.equal(reply[0], 0x05, 'SOCKS reply version');
  assert.equal(reply[1], 0x00, `SOCKS connect failed with code ${reply[1]}`);

  socket.write(
    `GET ${requestPath} HTTP/1.1\r\nHost: tunnel-test\r\nConnection: close\r\nAccept: application/json\r\n\r\n`,
    'utf8'
  );
  const raw = await reader.readAll();
  socket.destroy();
  const text = raw.toString('utf8');
  const match = /^HTTP\/1\.1 (\d{3})/.exec(text);
  assert.ok(match, `invalid HTTP response through SOCKS: ${text.slice(0, 120)}`);
  return { status: Number(match[1]), text };
}

/* ------------------------------------------------------------------ */
/* SFTP helpers                                                        */
/* ------------------------------------------------------------------ */

async function createSftpSession(app: AppHandle, hostId: string): Promise<SessionInfo> {
  const response = await app.client.call('POST', '/api/sessions/sftp', { json: { hostId } });
  assert.equal(response.status, 202, `create sftp session failed: ${response.text}`);
  const session = (response.data as { session: SessionInfo }).session;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const info = await app.client.call('GET', `/api/sessions/${session.id}`);
    assert.equal(info.status, 200, info.text);
    const current = (info.data as { session: SessionInfo }).session;
    if (current.state === 'connected') return current;
    if (current.state === 'error' || current.state === 'closed' || current.state === 'disconnected') {
      throw new Error(
        `SFTP session failed to connect: state=${current.state} code=${current.errorCode} error=${current.lastError}`
      );
    }
    await sleep(150);
  }
  throw new Error('Timed out waiting for the SFTP session to connect.');
}

async function sftpCall(app: AppHandle, method: string, pathname: string, options: ApiCallOptions = {}): Promise<ApiResult> {
  return app.client.call(method, `/api/sftp${pathname}`, options);
}

function sftpQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('FluentSSH SFTP + tunnels integration tests\n');
  const watchdog = setTimeout(() => {
    console.error('\nGLOBAL TIMEOUT: the test run exceeded 360s, aborting.');
    process.exit(2);
  }, 360_000);
  watchdog.unref();
  process.on('exit', () => {
    try {
      activeApp?.child.kill('SIGKILL');
    } catch {
      // ignore
    }
  });

  const fixture = await startMockSftpServer();
  const fixture2 = await startMockSftpServer();
  const target = await startTunnelTarget({ name: 'tunnel-target-a' });
  const target2 = await startTunnelTarget({ name: 'tunnel-target-b' });
  console.log(`mock SFTP server: ${HOST}:${fixture.port} (fp ${fixture.hostKeyFingerprint})`);
  console.log(`mock SFTP server 2: ${HOST}:${fixture2.port}`);
  console.log(`HTTP target: ${target.url}, second: ${target2.url}\n`);

  let app: AppHandle | null = null;
  let eventSocket: EventSocket | null = null;
  // Read through a closure so TypeScript does not narrow the nullable variable
  // to `null` based on the initializer.
  const closeEventSocket = () => {
    (eventSocket as EventSocket | null)?.close();
  };
  try {
    app = await startApp();
    console.log(`FluentSSH server: ${app.base} (data ${app.dataDir})\n`);

    /* ------------------------ setup: hosts + trust ----------------------- */

    let hostId = '';
    let hostId2 = '';

    console.log('[setup]');
    await step('create host + trust host key', async () => {
      const hostResponse = await app!.client.call('POST', '/api/hosts', {
        json: {
          name: 'Mock SFTP',
          hostname: HOST,
          port: fixture.port,
          username: fixture.username,
          authType: 'password',
          password: fixture.password
        }
      });
      assert.equal(hostResponse.status, 201, hostResponse.text);
      hostId = (hostResponse.data as { host: { id: string } }).host.id;

      const trustResponse = await app!.client.call('POST', '/api/known-hosts/trust', {
        json: {
          hostname: HOST,
          port: fixture.port,
          keyType: fixture.hostKeyType,
          fingerprint: fixture.hostKeyFingerprint
        }
      });
      assert.equal(trustResponse.status, 201, trustResponse.text);

      const host2Response = await app!.client.call('POST', '/api/hosts', {
        json: {
          name: 'Mock SFTP 2 (untrusted)',
          hostname: HOST,
          port: fixture2.port,
          username: fixture2.username,
          authType: 'password',
          password: fixture2.password
        }
      });
      assert.equal(host2Response.status, 201, host2Response.text);
      hostId2 = (host2Response.data as { host: { id: string } }).host.id;
      ok('host profiles created, fixture 1 host key trusted');
    });

    await step('open /ws/events and receive hello', async () => {
      eventSocket = await openEventSocket(app!);
      const hello = eventSocket.events.find((event) => event.type === 'hello') as Extract<ServerEvent, { type: 'hello' }>;
      assert.ok(hello, 'expected a hello event');
      assert.equal(typeof hello.serverTime, 'number');
      ok('server event WebSocket connected');
    });

    /* ------------------------------ tunnels ------------------------------ */

    console.log('\n[tunnels: local forwarding]');
    let localTunnelId = '';

    await step('create + start local tunnel', async () => {
      const tunnel = await createTunnel(app!, {
        name: 'local http',
        hostId,
        type: 'local',
        bindHost: HOST,
        bindPort: 0,
        targetHost: HOST,
        targetPort: target.port,
        autoStart: false
      });
      assert.equal(tunnel.status, 'stopped');
      localTunnelId = tunnel.id;
      const updated = eventSocket!.waitFor('tunnel.updated', 8000, (event) => event.tunnel.status === 'active');
      const started = await startTunnel(app!, tunnel.id);
      assert.equal(started.status, 'active');
      assert.ok(started.bindPort > 0, 'ephemeral bind port must be assigned back to the config');
      assert.equal(started.hostName, 'Mock SFTP');
      const event = await updated;
      assert.equal(event.tunnel.status, 'active');
      ok('local tunnel active', `127.0.0.1:${started.bindPort} -> ${HOST}:${target.port}`);
    });

    await step('HTTP traffic flows through the local tunnel', async () => {
      const tunnels = await listTunnels(app!);
      const tunnel = tunnels.find((item) => item.id === localTunnelId);
      assert.ok(tunnel, 'tunnel must be listed');
      const response = await httpGet(`http://${HOST}:${tunnel.bindPort}/hello?via=local`);
      assert.equal(response.status, 200);
      const payload = JSON.parse(response.text) as { name: string; path: string; query: Record<string, string>; method: string };
      assert.equal(payload.name, 'tunnel-target-a');
      assert.equal(payload.path, '/hello');
      assert.equal(payload.query.via, 'local');
      assert.equal(payload.method, 'GET');
      await sleep(1200);
      const after = (await listTunnels(app!)).find((item) => item.id === localTunnelId);
      assert.ok(after, 'tunnel must still be listed');
      assert.ok(after.bytesIn > 0, `bytesIn should be > 0, got ${after.bytesIn}`);
      assert.ok(after.bytesOut > 0, `bytesOut should be > 0, got ${after.bytesOut}`);
      ok('HTTP 200 through local tunnel', `bytesIn=${after.bytesIn} bytesOut=${after.bytesOut}`);
    });

    await step('local tunnel stop closes the listener', async () => {
      const tunnels = await listTunnels(app!);
      const tunnel = tunnels.find((item) => item.id === localTunnelId) as TunnelInfo;
      const port = tunnel.bindPort;
      const stoppedEvent = eventSocket!.waitFor('tunnel.updated', 8000, (event) => event.tunnel.status === 'stopped');
      const stopped = await stopTunnel(app!, localTunnelId);
      assert.equal(stopped.status, 'stopped');
      assert.equal(stopped.startedAt, null);
      const event = await stoppedEvent;
      assert.equal(event.tunnel.status, 'stopped');
      await assert.rejects(httpGet(`http://${HOST}:${port}/after-stop`, 2000), /fetch failed|ECONNREFUSED|aborted/i);
      ok('stopped tunnel refuses new connections', `port ${port} closed`);
    });

    await step('tunnel update rules (must be stopped) + delete', async () => {
      const patchStopped = await app!.client.call('PATCH', `/api/tunnels/${localTunnelId}`, {
        json: { name: 'local http renamed' }
      });
      assert.equal(patchStopped.status, 200, patchStopped.text);
      assert.equal((patchStopped.data as { tunnel: TunnelInfo }).tunnel.name, 'local http renamed');
      const started = await startTunnel(app!, localTunnelId);
      assert.equal(started.status, 'active');
      const patchActive = await app!.client.call('PATCH', `/api/tunnels/${localTunnelId}`, {
        json: { name: 'should fail' }
      });
      assert.equal(patchActive.status, 409, patchActive.text);
      assert.equal(errorCodeOf(patchActive), 'CONFLICT');
      const deleteActive = await app!.client.call('DELETE', `/api/tunnels/${localTunnelId}`);
      assert.equal(deleteActive.status, 409, deleteActive.text);
      const deleteActiveStop = await app!.client.call('DELETE', `/api/tunnels/${localTunnelId}?stop=1`);
      assert.equal(deleteActiveStop.status, 204, deleteActiveStop.text);
      const remaining = await listTunnels(app!);
      assert.equal(remaining.some((item) => item.id === localTunnelId), false);
      ok('PATCH blocked while active; DELETE ?stop=1 stops and deletes');
    });

    console.log('\n[tunnels: dynamic SOCKS5]');
    let dynamicTunnelId = '';

    await step('start dynamic tunnel and proxy HTTP through SOCKS5', async () => {
      const tunnel = await createTunnel(app!, {
        name: 'socks5',
        hostId,
        type: 'dynamic',
        bindHost: HOST,
        bindPort: 0,
        // The UI sends empty target fields for dynamic tunnels; they must be
        // ignored rather than rejected.
        targetHost: '',
        targetPort: 0
      });
      dynamicTunnelId = tunnel.id;
      const started = await startTunnel(app!, tunnel.id);
      assert.equal(started.status, 'active');
      assert.ok(started.bindPort > 0);

      const ipv4 = await socksHttpRequest(started.bindPort, HOST, target.port, '/socks-ipv4', 'ipv4');
      assert.equal(ipv4.status, 200);
      assert.match(ipv4.text, /"name":"tunnel-target-a"/);

      const domain = await socksHttpRequest(started.bindPort, HOST, target2.port, '/socks-domain', 'domain');
      assert.equal(domain.status, 200);
      assert.match(domain.text, /"name":"tunnel-target-b"/);
      ok('SOCKS5 CONNECT (IPv4 + domain) proxies HTTP', `proxy 127.0.0.1:${started.bindPort}`);
    });

    await step('dynamic tunnel counters + stop', async () => {
      await sleep(1200);
      const tunnel = (await listTunnels(app!)).find((item) => item.id === dynamicTunnelId) as TunnelInfo;
      assert.ok(tunnel.bytesIn > 0, `bytesIn=${tunnel.bytesIn}`);
      assert.ok(tunnel.bytesOut > 0, `bytesOut=${tunnel.bytesOut}`);
      const stopped = await stopTunnel(app!, dynamicTunnelId);
      assert.equal(stopped.status, 'stopped');
      ok('dynamic tunnel counters and stop', `bytesIn=${tunnel.bytesIn} bytesOut=${tunnel.bytesOut}`);
    });

    console.log('\n[tunnels: remote forwarding]');
    let remoteTunnelId = '';

    await step('start remote tunnel and reach local target from the "remote" side', async () => {
      const tunnel = await createTunnel(app!, {
        name: 'remote http',
        hostId,
        type: 'remote',
        bindHost: HOST,
        bindPort: 0,
        targetHost: HOST,
        targetPort: target.port
      });
      remoteTunnelId = tunnel.id;
      const started = await startTunnel(app!, tunnel.id);
      assert.equal(started.status, 'active');
      assert.ok(started.bindPort > 0, 'assigned remote bind port must be recorded');
      assert.ok(fixture.remoteForwardPorts().includes(started.bindPort), 'mock server should own the remote bind port');
      // "Remote" side: dial the mock SSH server's bound port; it forwards back
      // through SSH to our local target.
      const response = await httpGet(`http://${HOST}:${started.bindPort}/from-remote`);
      assert.equal(response.status, 200);
      assert.match(response.text, /"name":"tunnel-target-a"/);
      assert.match(response.text, /"path":"\/from-remote"/);
      ok('HTTP through remote forward', `remote 127.0.0.1:${started.bindPort} -> local ${HOST}:${target.port}`);
    });

    await step('remote tunnel stop unbinds the remote port', async () => {
      const tunnel = (await listTunnels(app!)).find((item) => item.id === remoteTunnelId) as TunnelInfo;
      const remotePort = tunnel.bindPort;
      await stopTunnel(app!, remoteTunnelId);
      await sleep(300);
      assert.equal(fixture.remoteForwardPorts().includes(remotePort), false, 'mock server should have unbound the port');
      await assert.rejects(httpGet(`http://${HOST}:${remotePort}/after-stop`, 2000), /fetch failed|ECONNREFUSED|aborted/i);
      const deleted = await app!.client.call('DELETE', `/api/tunnels/${remoteTunnelId}`);
      assert.equal(deleted.status, 204, deleted.text);
      ok('remote forward unbound and tunnel deleted');
    });

    console.log('\n[tunnels: host-key + validation errors]');
    let errorTunnelId = '';

    await step('untrusted host key surfaces HOST_KEY_UNKNOWN and tunnel error state', async () => {
      const tunnel = await createTunnel(app!, {
        name: 'untrusted host',
        hostId: hostId2,
        type: 'local',
        bindHost: HOST,
        bindPort: 0,
        targetHost: HOST,
        targetPort: target.port
      });
      errorTunnelId = tunnel.id;
      const failedEvent = eventSocket!.waitFor('tunnel.updated', 8000, (event) => event.tunnel.status === 'error');
      const startResponse = await app!.client.call('POST', `/api/tunnels/${tunnel.id}/start`);
      assert.equal(startResponse.status, 409, startResponse.text);
      assert.equal(errorCodeOf(startResponse), 'HOST_KEY_UNKNOWN');
      const details = errorDetailsOf(startResponse);
      assert.equal(details?.fingerprint, fixture2.hostKeyFingerprint);
      const listed = (await listTunnels(app!)).find((item) => item.id === tunnel.id) as TunnelInfo;
      assert.equal(listed.status, 'error');
      assert.ok(listed.error && listed.error.includes(fixture2.hostKeyFingerprint), `error should mention fingerprint: ${listed.error}`);
      // Structured error fields let the UI open the host-key trust dialog even
      // for failures that only surface through `tunnel.updated` (autoStart).
      assert.equal(listed.errorCode, 'HOST_KEY_UNKNOWN');
      assert.equal(listed.errorDetails?.fingerprint, fixture2.hostKeyFingerprint);
      assert.equal(listed.errorDetails?.hostname, HOST);
      assert.equal(listed.errorDetails?.port, fixture2.port);
      assert.equal(listed.errorDetails?.keyType, fixture2.hostKeyType);
      const event = await failedEvent;
      assert.equal(event.tunnel.errorCode, 'HOST_KEY_UNKNOWN');
      assert.equal(event.tunnel.errorDetails?.fingerprint, fixture2.hostKeyFingerprint);
      ok('HOST_KEY_UNKNOWN propagated to API + TunnelInfo.error/errorCode/errorDetails', String(details?.fingerprint));
    });

    await step('trusting the key then starting again succeeds', async () => {
      const trust = await app!.client.call('POST', '/api/known-hosts/trust', {
        json: {
          hostname: HOST,
          port: fixture2.port,
          keyType: fixture2.hostKeyType,
          fingerprint: fixture2.hostKeyFingerprint
        }
      });
      assert.equal(trust.status, 201, trust.text);
      const started = await startTunnel(app!, errorTunnelId);
      assert.equal(started.status, 'active');
      // Structured error leftovers must be cleared once the tunnel recovers.
      assert.equal(started.errorCode, null);
      assert.equal(started.errorDetails, null);
      const response = await httpGet(`http://${HOST}:${started.bindPort}/after-trust`);
      assert.equal(response.status, 200);
      await stopTunnel(app!, errorTunnelId);
      const deleted = await app!.client.call('DELETE', `/api/tunnels/${errorTunnelId}`);
      assert.equal(deleted.status, 204);
      ok('retry after trust works (errorCode/errorDetails cleared)');
    });

    await step('tunnel validation errors', async () => {
      const missing = await app!.client.call('POST', '/api/tunnels', { json: { name: 'x', hostId, type: 'local', bindPort: 0 } });
      assert.equal(missing.status, 400, missing.text);
      assert.equal(errorCodeOf(missing), 'VALIDATION');
      const badHost = await app!.client.call('POST', '/api/tunnels', {
        json: { name: 'x', hostId: 'no-such-host', type: 'local', bindPort: 0, targetHost: HOST, targetPort: 1 }
      });
      assert.equal(badHost.status, 404, badHost.text);
      assert.equal(errorCodeOf(badHost), 'NOT_FOUND');
      const badPort = await app!.client.call('POST', '/api/tunnels', {
        json: { name: 'x', hostId, type: 'local', bindPort: 70000, targetHost: HOST, targetPort: 1 }
      });
      assert.equal(badPort.status, 400, badPort.text);
      ok('VALIDATION / NOT_FOUND tunnel errors');
    });

    await step('tunnel audit events recorded', async () => {
      const auditResponse = await app!.client.call('GET', '/api/audit?category=tunnel&limit=50');
      assert.equal(auditResponse.status, 200, auditResponse.text);
      const events = (auditResponse.data as { events: Array<{ category: string; message: string }> }).events;
      assert.ok(events.length > 0, 'expected tunnel audit events');
      assert.ok(events.some((event) => event.message.includes('隧道已启动')), 'expected a start audit event');
      ok('tunnel audit events', `${events.length} events`);
    });

    /* ------------------------------- SFTP ------------------------------- */

    console.log('\n[SFTP: session + read operations]');
    let sftpSessionId = '';

    await step('create SFTP session via API and wait for connected', async () => {
      const session = await createSftpSession(app!, hostId);
      sftpSessionId = session.id;
      assert.equal(session.kind, 'sftp');
      assert.equal(session.hostId, hostId);
      const listResponse = await app!.client.call('GET', '/api/sessions?kind=sftp');
      assert.equal(listResponse.status, 200, listResponse.text);
      const sessions = (listResponse.data as { sessions: SessionInfo[] }).sessions;
      assert.ok(sessions.some((item) => item.id === session.id));
      ok('SFTP session connected', session.id);
    });

    await step('GET /sftp/home + list root', async () => {
      const home = await sftpCall(app!, 'GET', `/home?${sftpQuery({ sessionId: sftpSessionId })}`);
      assert.equal(home.status, 200, home.text);
      assert.equal((home.data as { path: string }).path, '/');
      const list = await sftpCall(app!, 'GET', `/list?${sftpQuery({ sessionId: sftpSessionId, path: '/' })}`);
      assert.equal(list.status, 200, list.text);
      const payload = list.data as { path: string; entries: Array<{ name: string }>; total: number };
      assert.equal(payload.path, '/');
      assert.equal(Array.isArray(payload.entries), true);
      assert.equal(payload.total, payload.entries.length);
      ok('home + list', `home=${(home.data as { path: string }).path}, root entries=${payload.total}`);
    });

    await step('mkdir (with 409 on duplicate) + empty dir listing', async () => {
      const mkdir = await sftpCall(app!, 'POST', '/mkdir', { json: { sessionId: sftpSessionId, path: '/work' } });
      assert.equal(mkdir.status, 200, mkdir.text);
      assert.equal((mkdir.data as { path: string }).path, '/work');
      const duplicate = await sftpCall(app!, 'POST', '/mkdir', { json: { sessionId: sftpSessionId, path: '/work' } });
      assert.equal(duplicate.status, 409, duplicate.text);
      assert.equal(errorCodeOf(duplicate), 'CONFLICT');
      const list = await sftpCall(app!, 'GET', `/list?${sftpQuery({ sessionId: sftpSessionId, path: '/work' })}`);
      assert.equal(list.status, 200);
      assert.equal((list.data as { total: number }).total, 0);
      ok('mkdir + duplicate conflict');
    });

    await step('write text + read back (utf8, no truncation)', async () => {
      const content = '你好 FluentSSH\nline2\n';
      const write = await sftpCall(app!, 'PUT', '/write', {
        json: { sessionId: sftpSessionId, path: '/work/hello.txt', content }
      });
      assert.equal(write.status, 200, write.text);
      assert.equal((write.data as { ok: boolean }).ok, true);
      assert.equal((write.data as { size: number }).size, Buffer.byteLength(content));
      const read = await sftpCall(app!, 'GET', `/read?${sftpQuery({ sessionId: sftpSessionId, path: '/work/hello.txt' })}`);
      assert.equal(read.status, 200, read.text);
      const payload = read.data as { content: string; encoding: string; binary: boolean; truncated: boolean; size: number };
      assert.equal(payload.content, content);
      assert.equal(payload.encoding, 'utf8');
      assert.equal(payload.binary, false);
      assert.equal(payload.truncated, false);
      assert.equal(payload.size, Buffer.byteLength(content));
      ok('write/read text round-trip', `${payload.size} bytes`);
    });

    await step('write base64 binary + binary detection', async () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff, 0x00, 0x7f]);
      const write = await sftpCall(app!, 'PUT', '/write', {
        json: { sessionId: sftpSessionId, path: '/work/blob.bin', content: binary.toString('base64'), encoding: 'base64' }
      });
      assert.equal(write.status, 200, write.text);
      assert.equal((write.data as { size: number }).size, binary.length);
      const read = await sftpCall(app!, 'GET', `/read?${sftpQuery({ sessionId: sftpSessionId, path: '/work/blob.bin' })}`);
      const payload = read.data as { content: string; encoding: string; binary: boolean; size: number };
      assert.equal(payload.binary, true);
      assert.equal(payload.encoding, 'base64');
      assert.equal(Buffer.from(payload.content, 'base64').equals(binary), true);
      ok('binary detection + base64 read');
    });

    await step('read truncation via maxBytes', async () => {
      const content = 'x'.repeat(5000);
      await sftpCall(app!, 'PUT', '/write', { json: { sessionId: sftpSessionId, path: '/work/large.txt', content } });
      const read = await sftpCall(
        app!,
        'GET',
        `/read?${sftpQuery({ sessionId: sftpSessionId, path: '/work/large.txt', maxBytes: 1024 })}`
      );
      assert.equal(read.status, 200, read.text);
      const payload = read.data as { content: string; truncated: boolean; size: number };
      assert.equal(payload.size, 5000);
      assert.equal(payload.truncated, true);
      assert.equal(Buffer.byteLength(payload.content), 1024);
      ok('maxBytes truncation', 'read 1024 of 5000 bytes');
    });

    await step('stat + missing path errors', async () => {
      const stat = await sftpCall(app!, 'GET', `/stat?${sftpQuery({ sessionId: sftpSessionId, path: '/work/hello.txt' })}`);
      assert.equal(stat.status, 200, stat.text);
      const entry = (stat.data as { entry: Record<string, unknown> }).entry;
      assert.equal(entry.type, 'file');
      assert.equal(entry.name, 'hello.txt');
      assert.equal(entry.isSymlink, false);
      assert.match(String(entry.permissions), /^-/);
      const missing = await sftpCall(app!, 'GET', `/stat?${sftpQuery({ sessionId: sftpSessionId, path: '/work/nope.txt' })}`);
      assert.equal(missing.status, 404, missing.text);
      assert.equal(errorCodeOf(missing), 'NOT_FOUND');
      ok('stat + 404 for missing file');
    });

    console.log('\n[SFTP: mutations]');

    await step('chmod (numeric octal) and rename', async () => {
      const chmod = await sftpCall(app!, 'POST', '/chmod', {
        json: { sessionId: sftpSessionId, path: '/work/hello.txt', mode: 0o600 }
      });
      assert.equal(chmod.status, 200, chmod.text);
      const entry = (chmod.data as { entry: { mode: number; permissions: string } }).entry;
      if (process.platform !== 'win32') assert.equal(entry.mode & 0o777, 0o600);
      assert.match(entry.permissions, /^-/);
      const chmodString = await sftpCall(app!, 'POST', '/chmod', {
        json: { sessionId: sftpSessionId, path: '/work/hello.txt', mode: '644' }
      });
      assert.equal(chmodString.status, 200, chmodString.text);
      const invalidMode = await sftpCall(app!, 'POST', '/chmod', {
        json: { sessionId: sftpSessionId, path: '/work/hello.txt', mode: 'rwx' }
      });
      assert.equal(invalidMode.status, 400, invalidMode.text);
      assert.equal(errorCodeOf(invalidMode), 'VALIDATION');

      const rename = await sftpCall(app!, 'POST', '/rename', {
        json: { sessionId: sftpSessionId, from: '/work/hello.txt', to: '/work/hello-renamed.txt' }
      });
      assert.equal(rename.status, 200, rename.text);
      assert.equal((rename.data as { path: string }).path, '/work/hello-renamed.txt');
      const read = await sftpCall(
        app!,
        'GET',
        `/read?${sftpQuery({ sessionId: sftpSessionId, path: '/work/hello-renamed.txt' })}`
      );
      assert.equal(read.status, 200);
      const oldPath = await sftpCall(app!, 'GET', `/stat?${sftpQuery({ sessionId: sftpSessionId, path: '/work/hello.txt' })}`);
      assert.equal(oldPath.status, 404);

      const conflictRename = await sftpCall(app!, 'POST', '/rename', {
        json: { sessionId: sftpSessionId, from: '/work/large.txt', to: '/work/hello-renamed.txt' }
      });
      assert.equal(conflictRename.status, 409, conflictRename.text);
      assert.equal(errorCodeOf(conflictRename), 'CONFLICT');
      ok('chmod + rename + rename conflict');
    });

    await step('symlink: create, stat, list, delete', async () => {
      const symlink = await sftpCall(app!, 'POST', '/symlink', {
        json: { sessionId: sftpSessionId, target: '/work/hello-renamed.txt', path: '/work/link.txt' }
      });
      assert.equal(symlink.status, 200, symlink.text);
      const stat = await sftpCall(app!, 'GET', `/stat?${sftpQuery({ sessionId: sftpSessionId, path: '/work/link.txt' })}`);
      assert.equal(stat.status, 200, stat.text);
      const entry = (stat.data as { entry: { type: string; isSymlink: boolean; linkTarget: string | null } }).entry;
      assert.equal(entry.type, 'symlink');
      assert.equal(entry.isSymlink, true);
      assert.ok(entry.linkTarget, 'linkTarget should be populated');
      const list = await sftpCall(app!, 'GET', `/list?${sftpQuery({ sessionId: sftpSessionId, path: '/work' })}`);
      const entries = (list.data as { entries: Array<{ name: string; type: string }> }).entries;
      assert.ok(entries.some((item) => item.name === 'link.txt' && item.type === 'symlink'));
      const del = await sftpCall(app!, 'POST', '/delete', {
        json: { sessionId: sftpSessionId, paths: ['/work/link.txt'] }
      });
      assert.equal(del.status, 200, del.text);
      assert.equal((del.data as { deleted: number }).deleted, 1);
      ok('symlink create/stat/list/delete', `target=${entry.linkTarget}`);
    });

    await step('search finds files recursively', async () => {
      const mkdir = await sftpCall(app!, 'POST', '/mkdir', { json: { sessionId: sftpSessionId, path: '/work/nested' } });
      assert.equal(mkdir.status, 200, mkdir.text);
      await sftpCall(app!, 'PUT', '/write', {
        json: { sessionId: sftpSessionId, path: '/work/nested/find-me.txt', content: 'needle' }
      });
      const search = await sftpCall(
        app!,
        'GET',
        `/search?${sftpQuery({ sessionId: sftpSessionId, path: '/', query: 'find-me', limit: 100 })}`
      );
      assert.equal(search.status, 200, search.text);
      const payload = search.data as { entries: Array<{ name: string; path: string }>; scanned: number; truncated: boolean };
      assert.ok(payload.scanned > 0);
      assert.ok(payload.entries.some((item) => item.name === 'find-me.txt' && item.path === '/work/nested/find-me.txt'));
      assert.equal(payload.truncated, false);
      const noMatch = await sftpCall(app!, 'GET', `/search?${sftpQuery({ sessionId: sftpSessionId, path: '/', query: 'zzz-no-such' })}`);
      assert.equal(noMatch.status, 200);
      assert.equal((noMatch.data as { entries: unknown[] }).entries.length, 0);
      ok('recursive search', `scanned=${payload.scanned}`);
    });

    console.log('\n[SFTP: upload / download]');

    await step('upload raw stream + download round-trip', async () => {
      const payload = Buffer.from('uploaded content ✓\n'.repeat(50), 'utf8');
      const upload = await sftpCall(
        app!,
        'PUT',
        `/upload?${sftpQuery({ sessionId: sftpSessionId, path: '/work', name: 'uploaded.txt' })}`,
        { body: payload }
      );
      assert.equal(upload.status, 200, upload.text);
      const result = upload.data as { path: string; size: number };
      assert.equal(result.path, '/work/uploaded.txt');
      assert.equal(result.size, payload.length);

      const download = await sftpCall(
        app!,
        'GET',
        `/download?${sftpQuery({ sessionId: sftpSessionId, path: '/work/uploaded.txt' })}`
      );
      assert.equal(download.status, 200, download.text.slice(0, 200));
      assert.equal(download.headers.get('content-type'), 'application/octet-stream');
      assert.equal(download.headers.get('content-length'), String(payload.length));
      const disposition = download.headers.get('content-disposition') ?? '';
      assert.match(disposition, /^attachment;/);
      assert.match(disposition, /filename\*=UTF-8''uploaded\.txt/);
      assert.equal(download.buffer.equals(payload), true);
      ok('upload/download round-trip', `${payload.length} bytes`);
    });

    await step('upload overwrite protection', async () => {
      const duplicate = await sftpCall(
        app!,
        'PUT',
        `/upload?${sftpQuery({ sessionId: sftpSessionId, path: '/work', name: 'uploaded.txt' })}`,
        { body: Buffer.from('should be rejected') }
      );
      assert.equal(duplicate.status, 409, duplicate.text);
      assert.equal(errorCodeOf(duplicate), 'CONFLICT');
      const replaced = Buffer.from('replaced content');
      const overwrite = await sftpCall(
        app!,
        'PUT',
        `/upload?${sftpQuery({ sessionId: sftpSessionId, path: '/work', name: 'uploaded.txt', overwrite: 1 })}`,
        { body: replaced }
      );
      assert.equal(overwrite.status, 200, overwrite.text);
      const download = await sftpCall(
        app!,
        'GET',
        `/download?${sftpQuery({ sessionId: sftpSessionId, path: '/work/uploaded.txt' })}`
      );
      assert.equal(download.buffer.equals(replaced), true);
      ok('409 without overwrite, overwrite=1 replaces');
    });

    await step('large streaming upload + download (1 MiB)', async () => {
      const payload = Buffer.alloc(1024 * 1024);
      for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
      const upload = await sftpCall(
        app!,
        'PUT',
        `/upload?${sftpQuery({ sessionId: sftpSessionId, path: '/work', name: 'big.bin', overwrite: 1 })}`,
        { body: payload }
      );
      assert.equal(upload.status, 200, upload.text);
      assert.equal((upload.data as { size: number }).size, payload.length);
      const download = await sftpCall(
        app!,
        'GET',
        `/download?${sftpQuery({ sessionId: sftpSessionId, path: '/work/big.bin' })}`
      );
      assert.equal(download.status, 200);
      assert.equal(download.buffer.length, payload.length);
      assert.equal(download.buffer.equals(payload), true);
      const read = await sftpCall(
        app!,
        'GET',
        `/read?${sftpQuery({ sessionId: sftpSessionId, path: '/work/big.bin', maxBytes: 1024 })}`
      );
      assert.equal(read.status, 200);
      const readPayload = read.data as { binary: boolean; truncated: boolean; encoding: string };
      assert.equal(readPayload.binary, true);
      assert.equal(readPayload.truncated, true);
      assert.equal(readPayload.encoding, 'base64');
      await sftpCall(app!, 'POST', '/delete', { json: { sessionId: sftpSessionId, paths: ['/work/big.bin'] } });
      ok('1 MiB upload/download round-trip', `${payload.length} bytes`);
    });

    await step('download missing file -> 404 JSON; directory download -> 400', async () => {
      const missing = await sftpCall(
        app!,
        'GET',
        `/download?${sftpQuery({ sessionId: sftpSessionId, path: '/work/does-not-exist.bin' })}`
      );
      assert.equal(missing.status, 404, missing.text);
      assert.equal(errorCodeOf(missing), 'NOT_FOUND');
      const directory = await sftpCall(app!, 'GET', `/download?${sftpQuery({ sessionId: sftpSessionId, path: '/work' })}`);
      assert.equal(directory.status, 400, directory.text);
      assert.equal(errorCodeOf(directory), 'VALIDATION');
      ok('download error handling');
    });

    console.log('\n[SFTP: delete]');

    await step('delete files (ids) + recursive directory delete', async () => {
      const treeMkdir = await sftpCall(app!, 'POST', '/mkdir', { json: { sessionId: sftpSessionId, path: '/tree' } });
      assert.equal(treeMkdir.status, 200);
      await sftpCall(app!, 'POST', '/mkdir', { json: { sessionId: sftpSessionId, path: '/tree/sub' } });
      await sftpCall(app!, 'PUT', '/write', {
        json: { sessionId: sftpSessionId, path: '/tree/sub/a.txt', content: 'tree file' }
      });
      const nonRecursive = await sftpCall(app!, 'POST', '/delete', {
        json: { sessionId: sftpSessionId, paths: ['/tree'] }
      });
      assert.notEqual(nonRecursive.status, 200, 'non-empty dir delete without recursive must fail');
      const recursive = await sftpCall(app!, 'POST', '/delete', {
        json: { sessionId: sftpSessionId, paths: ['/tree'], recursive: true }
      });
      assert.equal(recursive.status, 200, recursive.text);
      assert.equal((recursive.data as { deleted: number }).deleted, 1);
      const stat = await sftpCall(app!, 'GET', `/stat?${sftpQuery({ sessionId: sftpSessionId, path: '/tree' })}`);
      assert.equal(stat.status, 404);

      const files = await sftpCall(app!, 'POST', '/delete', {
        json: { sessionId: sftpSessionId, paths: ['/work/blob.bin', '/work/large.txt'], recursive: false }
      });
      assert.equal(files.status, 200, files.text);
      assert.equal((files.data as { deleted: number }).deleted, 2);
      ok('delete files + recursive tree');
    });

    await step('delete protections: root rejected, missing path 404', async () => {
      const root = await sftpCall(app!, 'POST', '/delete', { json: { sessionId: sftpSessionId, paths: ['/'] } });
      assert.equal(root.status, 400, root.text);
      assert.equal(errorCodeOf(root), 'VALIDATION');
      const missing = await sftpCall(app!, 'POST', '/delete', {
        json: { sessionId: sftpSessionId, paths: ['/work/ghost.txt'] }
      });
      assert.equal(missing.status, 404, missing.text);
      ok('delete protections');
    });

    console.log('\n[SFTP: session + validation errors]');

    await step('missing/invalid session id validation', async () => {
      const missing = await sftpCall(app!, 'GET', '/list');
      assert.equal(missing.status, 400, missing.text);
      assert.equal(errorCodeOf(missing), 'VALIDATION');
      const unknown = await sftpCall(app!, 'GET', `/list?${sftpQuery({ sessionId: 'no-such-session' })}`);
      assert.equal(unknown.status, 404, unknown.text);
      assert.equal(errorCodeOf(unknown), 'NOT_FOUND');
      ok('VALIDATION + NOT_FOUND for session ids');
    });

    await step('closed session -> SESSION_NOT_CONNECTED or NOT_FOUND', async () => {
      const closeResponse = await app!.client.call('DELETE', `/api/sessions/${sftpSessionId}`);
      assert.ok([204, 200].includes(closeResponse.status), closeResponse.text);
      await sleep(200);
      const list = await sftpCall(app!, 'GET', `/list?${sftpQuery({ sessionId: sftpSessionId })}`);
      assert.ok([404, 409].includes(list.status), `expected 404/409 after close, got ${list.status}: ${list.text}`);
      assert.ok(['NOT_FOUND', 'SESSION_NOT_CONNECTED'].includes(String(errorCodeOf(list))));
      ok('closed session is rejected', `status=${list.status} code=${String(errorCodeOf(list))}`);
    });

    await step('SFTP audit events recorded', async () => {
      const auditResponse = await app!.client.call('GET', '/api/audit?category=sftp&limit=100');
      assert.equal(auditResponse.status, 200, auditResponse.text);
      const events = (auditResponse.data as { events: Array<{ category: string; message: string }> }).events;
      assert.ok(events.length > 0, 'expected sftp audit events');
      assert.ok(events.some((event) => event.message.startsWith('写入文件')), 'expected write audit event');
      assert.ok(events.some((event) => event.message.startsWith('上传文件')), 'expected upload audit event');
      assert.ok(events.some((event) => event.message.startsWith('下载文件')), 'expected download audit event');
      ok('SFTP audit events', `${events.length} events`);
    });

    /* --------------------------- autoStart restart ----------------------- */

    console.log('\n[tunnels: autoStart across restart]');

    await step('autoStart tunnel starts after restart (+ failing autoStart exposes errorCode)', async () => {
      // Make fixture 2 untrusted again so its autoStart tunnel fails with a
      // structured host-key error after the restart (the UI-facing case).
      const knownHostsResponse = await app!.client.call('GET', '/api/known-hosts');
      const knownHosts = (knownHostsResponse.data as { knownHosts: Array<{ id: string; hostname: string; port: number }> })
        .knownHosts;
      const fixture2Entry = knownHosts.find((item) => item.hostname === HOST && item.port === fixture2.port);
      assert.ok(fixture2Entry, 'fixture 2 known-host entry should exist before un-trusting it');
      const untrust = await app!.client.call('DELETE', `/api/known-hosts/${fixture2Entry.id}`);
      assert.equal(untrust.status, 204, untrust.text);

      const tunnel = await createTunnel(app!, {
        name: 'auto start local',
        hostId,
        type: 'local',
        bindHost: HOST,
        bindPort: 0,
        targetHost: HOST,
        targetPort: target.port,
        autoStart: true
      });
      assert.equal(tunnel.status, 'stopped');
      const failingTunnel = await createTunnel(app!, {
        name: 'auto start untrusted',
        hostId: hostId2,
        type: 'local',
        bindHost: HOST,
        bindPort: 0,
        targetHost: HOST,
        targetPort: target2.port,
        autoStart: true
      });
      assert.equal(failingTunnel.status, 'stopped');
      closeEventSocket();
      eventSocket = null;
      const dataDir = app!.dataDir;
      // The store persists mutations with a short debounce; on Windows a SIGTERM
      // kills the process without running the graceful shutdown hook, so give
      // the debounced write a moment to hit disk before restarting.
      await sleep(500);
      await app!.stop();

      const restarted = await startApp(dataDir);
      app = restarted;
      const deadline = Date.now() + 12_000;
      let active: TunnelInfo | null = null;
      let failed: TunnelInfo | null = null;
      while (Date.now() < deadline) {
        const tunnels = await listTunnels(app);
        active = tunnels.find((item) => item.id === tunnel.id && item.status === 'active') ?? null;
        failed = tunnels.find((item) => item.id === failingTunnel.id && item.status === 'error') ?? null;
        if (active && failed) break;
        await sleep(250);
      }
      if (!active || !failed) {
        const tunnelsNow = await listTunnels(app);
        const auditResponse = await app.client.call('GET', '/api/audit?limit=60');
        throw new Error(
          `autoStart state mismatch after restart. tunnels=${JSON.stringify(
            tunnelsNow.map((item) => ({
              id: item.id,
              status: item.status,
              error: item.error,
              errorCode: item.errorCode,
              autoStart: item.autoStart
            }))
          )} audit=${JSON.stringify(auditResponse.data)}\n${app.logs()}`
        );
      }
      // A failing autoStart only surfaces through GET /api/tunnels / tunnel.updated,
      // so the structured host-key details must be present for the UI trust dialog.
      assert.equal(failed.errorCode, 'HOST_KEY_UNKNOWN');
      assert.equal(failed.errorDetails?.fingerprint, fixture2.hostKeyFingerprint);
      assert.equal(failed.errorDetails?.hostname, HOST);
      assert.equal(failed.errorDetails?.port, fixture2.port);
      assert.equal(failed.errorDetails?.keyType, fixture2.hostKeyType);
      const response = await httpGet(`http://${HOST}:${active.bindPort}/auto-start`);
      assert.equal(response.status, 200);
      assert.match(response.text, /"name":"tunnel-target-a"/);
      await stopTunnel(app, tunnel.id);
      const deleted = await app.client.call('DELETE', `/api/tunnels/${tunnel.id}`);
      assert.equal(deleted.status, 204);
      const deletedFailing = await app.client.call('DELETE', `/api/tunnels/${failingTunnel.id}`);
      assert.equal(deletedFailing.status, 204);
      ok(
        'autoStart tunnel active after restart; failing autoStart exposes HOST_KEY_UNKNOWN + details',
        `127.0.0.1:${active.bindPort}`
      );
    });

    /* ------------------------------- summary ---------------------------- */

    console.log('\n[summary]');
    for (const line of results) console.log(line);
    if (failures > 0) {
      console.error(`\n${failures} test step(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log(`\nAll ${results.length} test steps passed.`);
    }
  } finally {
    closeEventSocket();
    if (app) {
      try {
        await app.stop();
      } catch {
        // ignore
      }
      removeDataDir(app);
    }
    await fixture.stop();
    await fixture2.stop();
    await target.close();
    await target2.close();
  }
}

main().catch((error) => {
  console.error('\nFATAL', error);
  process.exitCode = 1;
});
