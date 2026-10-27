/**
 * SSH core backend end-to-end tests (ssh-core teammate).
 *
 * Boots the real FluentSSH server as a child process on a random port with a
 * temporary FLUENTSSH_DATA_DIR, plus an in-process mock SSH server, and
 * exercises the documented HTTP/WS contract from docs/API.md:
 *
 *  - host-key unknown -> trust -> reconnect flow
 *  - host-key mismatch -> session error details
 *  - password auth terminal session + live terminal WebSocket (backlog,
 *    fan-out, input, resize, ping/pong, socket close keeps session alive)
 *  - keyboard-interactive auth prompt round trip (awaiting-auth -> connected)
 *  - public key auth using a generated key
 *  - exec + command history + audit
 *  - key generation (ed25519/rsa/ecdsa), import (plain + passphrase), rename,
 *    delete conflict when referenced by a host
 *  - known-hosts list/trust/import/export/delete
 *  - session recording list/download/delete
 *  - disconnect/reconnect and DELETE semantics, session.closed event
 *
 * Run: pnpm exec tsx tests/ssh-core.test.ts
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import sshpk from 'sshpk';
import type {
  AuthPrompt,
  HostProfile,
  ServerEvent,
  SessionInfo,
  SshKeyMeta,
  TerminalServerMessage
} from '../shared/types.js';
import { startMockSshServer, type MockSshServer } from './fixtures/mock-ssh-server.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOT_TIMEOUT_MS = 40_000;
const STEP_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Small test harness                                                  */
/* ------------------------------------------------------------------ */

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`超时（${ms}ms）：${label}`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function step(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  process.stdout.write(`  ▸ ${name} … `);
  try {
    await withTimeout(fn(), STEP_TIMEOUT_MS, name);
    results.push({ name, ok: true });
    process.stdout.write(`ok (${Date.now() - started}ms)\n`);
  } catch (error) {
    const detail = error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack}` : ''}` : String(error);
    results.push({ name, ok: false, detail });
    process.stdout.write(`FAILED\n    ${detail.split('\n').slice(0, 12).join('\n    ')}\n`);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP client                                                         */
/* ------------------------------------------------------------------ */

interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

class ApiClient {
  readonly baseUrl: string;
  cookie = '';
  eventToken = '';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T = unknown>(
    method: string,
    route: string,
    body?: unknown,
    options: { rawBody?: Buffer; contentType?: string } = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (options.rawBody) {
      payload = new Uint8Array(options.rawBody);
      headers['content-type'] = options.contentType ?? 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const res = await fetch(`${this.baseUrl}${route}`, { method, headers, body: payload });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      this.cookie = setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, data: data as T, headers: res.headers };
  }

  get<T = unknown>(route: string) {
    return this.request<T>('GET', route);
  }

  post<T = unknown>(route: string, body?: unknown) {
    return this.request<T>('POST', route, body);
  }

  patch<T = unknown>(route: string, body?: unknown) {
    return this.request<T>('PATCH', route, body);
  }

  del<T = unknown>(route: string) {
    return this.request<T>('DELETE', route);
  }
}

function errorCode(response: ApiResponse): string {
  const data = response.data as { error?: { code?: string } } | null;
  return data?.error?.code ?? '';
}

/* ------------------------------------------------------------------ */
/* Child server                                                        */
/* ------------------------------------------------------------------ */

interface RunningServer {
  child: ChildProcess;
  api: ApiClient;
  baseUrl: string;
  logs: () => string;
  stop: () => Promise<void>;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to acquire free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function startFluentSshServer(dataDir: string): Promise<RunningServer> {
  const port = await getFreePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      FLUENTSSH_PORT: String(port),
      FLUENTSSH_HOST: '127.0.0.1',
      FLUENTSSH_DATA_DIR: dataDir,
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    if (output.length > 200_000) output = output.slice(-100_000);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
    if (output.length > 200_000) output = output.slice(-100_000);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`FluentSSH server exited early (code ${child.exitCode}):\n${output}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await delay(150);
  }
  if (!ready) throw new Error(`FluentSSH server did not become ready within ${BOOT_TIMEOUT_MS}ms:\n${output}`);

  const api = new ApiClient(baseUrl);
  const bootstrap = await api.get<{ info: { eventToken: string } }>('/api/bootstrap');
  assert.equal(bootstrap.status, 200, 'bootstrap should succeed');
  // The very first unauthenticated call receives the Set-Cookie but cannot echo
  // it back yet; a second call resolves the stable local WS token from the cookie.
  if (!bootstrap.data.info.eventToken) {
    const again = await api.get<{ info: { eventToken: string } }>('/api/bootstrap');
    api.eventToken = again.data.info.eventToken;
  } else {
    api.eventToken = bootstrap.data.info.eventToken;
  }
  assert.ok(api.eventToken.length > 0, 'bootstrap should expose the local WS token');

  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      child.kill();
    } catch {
      // ignore
    }
    await Promise.race([exited, delay(4000)]);
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  return { child, api, baseUrl, logs: () => output, stop };
}

/* ------------------------------------------------------------------ */
/* WebSocket helpers                                                   */
/* ------------------------------------------------------------------ */

type WsMessage = TerminalServerMessage | ServerEvent;

class SocketClient<M extends WsMessage = WsMessage> {
  protected readonly ws: WebSocket;
  readonly messages: M[] = [];
  private waiters: Array<{ predicate: (message: M) => boolean; resolve: (message: M) => void; timer: NodeJS.Timeout }> =
    [];

  protected constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      let message: M;
      try {
        message = JSON.parse(data.toString()) as M;
      } catch {
        return;
      }
      this.messages.push(message);
      for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = this.waiters[index];
        if (!waiter.predicate(message)) continue;
        this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
  }

  static async open<M extends WsMessage = WsMessage>(url: string): Promise<SocketClient<M>> {
    const ws = new WebSocket(url);
    const client = new SocketClient<M>(ws);
    await client.waitOpen();
    return client;
  }

  protected async waitOpen(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', (error) => reject(error));
      this.ws.once('unexpected-response', (_req, res) =>
        reject(new Error(`WS upgrade failed: HTTP ${res.statusCode}`))
      );
    });
  }

  waitFor<T extends M>(predicate: (message: M) => message is T, timeoutMs?: number, label?: string): Promise<T>;
  waitFor(predicate: (message: M) => boolean, timeoutMs?: number, label?: string): Promise<M>;
  waitFor(predicate: (message: M) => boolean, timeoutMs = 10_000, label = 'ws message'): Promise<M> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<M>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`timed out waiting for ${label}; got ${JSON.stringify(this.messages.slice(-6))}`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  send(payload: unknown) {
    this.ws.send(JSON.stringify(payload));
  }

  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.ws.once('close', () => resolve()));
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    await Promise.race([closed, delay(2000)]);
  }
}

class TerminalSocket extends SocketClient<TerminalServerMessage> {
  static async openTerminal(baseUrl: string, sessionId: string, token: string): Promise<TerminalSocket> {
    const url = `${baseUrl.replace(/^http/, 'ws')}/ws/terminal/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;
    const client = new TerminalSocket(new WebSocket(url));
    await client.waitOpen();
    return client;
  }

  outputText(): string {
    return this.messages
      .filter((message): message is Extract<TerminalServerMessage, { data: string }> => message.type === 'output' || message.type === 'backlog')
      .map((message) => Buffer.from(message.data, 'base64').toString('utf8'))
      .join('');
  }

  liveOutputText(): string {
    return this.messages
      .filter((message): message is Extract<TerminalServerMessage, { data: string }> => message.type === 'output')
      .map((message) => Buffer.from(message.data, 'base64').toString('utf8'))
      .join('');
  }

  sendInput(text: string) {
    this.send({ type: 'input', data: Buffer.from(text, 'utf8').toString('base64') });
  }
}

class EventSocket extends SocketClient<ServerEvent> {
  static async openEvents(baseUrl: string, token: string): Promise<EventSocket> {
    const url = `${baseUrl.replace(/^http/, 'ws')}/ws/events?token=${encodeURIComponent(token)}`;
    const client = new EventSocket(new WebSocket(url));
    await client.waitOpen();
    return client;
  }
}

/* ------------------------------------------------------------------ */
/* Domain helpers                                                      */
/* ------------------------------------------------------------------ */

async function waitForSession(
  api: ApiClient,
  sessionId: string,
  predicate: (session: SessionInfo) => boolean,
  timeoutMs = 15_000
): Promise<SessionInfo> {
  const deadline = Date.now() + timeoutMs;
  let last: SessionInfo | null = null;
  while (Date.now() < deadline) {
    const response = await api.get<{ session: SessionInfo }>(`/api/sessions/${sessionId}`);
    if (response.status === 200) {
      last = response.data.session;
      if (predicate(last)) return last;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for session ${sessionId}; last=${JSON.stringify(last)}`);
}

function assertSessionShape(session: SessionInfo, kind: 'terminal' | 'sftp') {
  for (const key of [
    'id',
    'kind',
    'hostId',
    'hostName',
    'hostname',
    'port',
    'username',
    'title',
    'state',
    'createdAt',
    'connectedAt',
    'closedAt',
    'lastError',
    'errorCode',
    'errorDetails',
    'cols',
    'rows',
    'term',
    'stats',
    'hostKeyFingerprint'
  ] as const) {
    assert.ok(key in session, `SessionInfo missing key: ${key}`);
  }
  assert.equal(session.kind, kind);
  assert.ok(['connecting', 'awaiting-auth', 'connected', 'disconnected', 'closed', 'error'].includes(session.state));
}

function assertKeyMetaShape(key: SshKeyMeta) {
  const keys = Object.keys(key).sort();
  assert.deepEqual(
    keys,
    [
      'algorithm',
      'bits',
      'comment',
      'createdAt',
      'fingerprint',
      'hasPassphrase',
      'id',
      'isGenerated',
      'name',
      'publicKey'
    ].sort(),
    `unexpected SshKeyMeta keys: ${keys.join(',')}`
  );
  assert.ok(!('secrets' in key), 'key metadata must not expose secrets');
  assert.ok(!('privateKey' in key), 'key metadata must not expose the private key');
  assert.match(key.fingerprint, /^SHA256:[A-Za-z0-9+/]+$/);
}

async function createHost(api: ApiClient, input: Record<string, unknown>): Promise<HostProfile> {
  const response = await api.post<{ host: HostProfile }>('/api/hosts', input);
  assert.equal(response.status, 201, `create host failed: ${JSON.stringify(response.data)}`);
  return response.data.host;
}

/* ------------------------------------------------------------------ */
/* Main test run                                                       */
/* ------------------------------------------------------------------ */

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentssh-ssh-core-'));
  let mock: MockSshServer | null = null;
  let mock2: MockSshServer | null = null;
  let running: RunningServer | null = null;
  const extraSockets: Array<{ close: () => Promise<void> }> = [];

  console.log(`\nFluentSSH SSH core API tests\n  data dir: ${dataDir}\n`);

  try {
    mock = await startMockSshServer();
    mock2 = await startMockSshServer();
    running = await startFluentSshServer(dataDir);
    const { api, baseUrl } = running;
    const token = api.eventToken;

    await step('GET /api/health and /api/bootstrap establish the local cookie', async () => {
      const health = await api.get<{ ok: boolean; name: string }>('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.data.ok, true);
      assert.equal(health.data.name, 'FluentSSH');
      assert.match(api.cookie, /^fluentssh_sid=/);
    });

    let passwordHost: HostProfile;
    await step('create password host via POST /api/hosts', async () => {
      passwordHost = await createHost(api, {
        name: 'Mock Password',
        hostname: '127.0.0.1',
        port: mock!.port,
        username: 'demo',
        authType: 'password',
        password: 'demo123'
      });
      assert.equal(passwordHost.hasPassword, true);
      assert.equal(passwordHost.port, mock!.port);
      assert.ok(!('secrets' in (passwordHost as unknown as Record<string, unknown>)));
    });

    let terminalSession: SessionInfo;
    await step('unknown host key: session enters error with HOST_KEY_UNKNOWN details', async () => {
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: passwordHost.id,
        cols: 120,
        rows: 30
      });
      assert.equal(created.status, 202, JSON.stringify(created.data));
      terminalSession = created.data.session;
      assertSessionShape(terminalSession, 'terminal');
      assert.equal(terminalSession.state, 'connecting');
      assert.equal(terminalSession.cols, 120);
      assert.equal(terminalSession.rows, 30);

      const errored = await waitForSession(api, terminalSession.id, (session) => session.state === 'error');
      assert.equal(errored.errorCode, 'HOST_KEY_UNKNOWN');
      assert.ok(errored.lastError && errored.lastError.length > 0);
      assert.ok(errored.errorDetails);
      assert.equal(errored.errorDetails!.fingerprint, mock!.fingerprint);
      assert.equal(errored.errorDetails!.hostname, '127.0.0.1');
      assert.equal(errored.errorDetails!.port, mock!.port);
      assert.equal(errored.errorDetails!.keyType, mock!.keyType);

      const list = await api.get<{ sessions: SessionInfo[] }>('/api/sessions?kind=terminal');
      assert.ok(list.data.sessions.some((session) => session.id === terminalSession.id));
    });

    let trustedKnownHostId = '';
    await step('trust host key and export a valid known_hosts line', async () => {
      const empty = await api.get<{ knownHosts: unknown[] }>('/api/known-hosts');
      assert.equal(empty.status, 200);
      assert.equal(empty.data.knownHosts.length, 0);

      const trust = await api.post<{ knownHost: Record<string, unknown> }>('/api/known-hosts/trust', {
        hostname: '127.0.0.1',
        port: mock!.port,
        keyType: mock!.keyType,
        fingerprint: mock!.fingerprint
      });
      assert.equal(trust.status, 201, JSON.stringify(trust.data));
      const knownHost = trust.data.knownHost;
      assert.deepEqual(Object.keys(knownHost).sort(), [
        'addedAt',
        'fingerprint',
        'hostname',
        'id',
        'keyType',
        'lastSeenAt',
        'port',
        'source'
      ]);
      assert.equal(knownHost.fingerprint, mock!.fingerprint);
      assert.equal(knownHost.source, 'trusted');
      trustedKnownHostId = String(knownHost.id);

      const exported = await api.get<{ content: string }>('/api/known-hosts/export');
      assert.equal(exported.status, 200);
      const expectedBlob = mock!.publicKey.split(/\s+/)[1];
      assert.ok(
        exported.data.content.includes(`${mock!.keyType} ${expectedBlob}`),
        `export missing host key line:\n${exported.data.content}`
      );
      assert.ok(!exported.data.content.includes('|1|'), 'export must not emit hashed entries');
    });

    await step('reconnect the errored session keeps the same id and connects', async () => {
      const reconnect = await api.post<{ session: SessionInfo }>(`/api/sessions/${terminalSession.id}/reconnect`);
      assert.equal(reconnect.status, 202);
      assert.equal(reconnect.data.session.id, terminalSession.id);
      const connected = await waitForSession(api, terminalSession.id, (session) => session.state === 'connected');
      assert.ok(connected.connectedAt);
      assert.equal(connected.errorCode, null);
      assert.equal(connected.errorDetails, null);
      assert.equal(connected.hostKeyFingerprint, mock!.fingerprint);
    });

    let terminalSocket: TerminalSocket;
    await step('terminal WebSocket: backlog, title, state, input/output, ping/pong, resize', async () => {
      terminalSocket = await TerminalSocket.openTerminal(baseUrl, terminalSession.id, token);
      extraSockets.push(terminalSocket);
      await terminalSocket.waitFor((message) => message.type === 'backlog', 5000, 'backlog');
      await terminalSocket.waitFor((message) => message.type === 'title', 5000, 'title');
      const state = await terminalSocket.waitFor(
        (message) => message.type === 'state' && message.state === 'connected',
        5000,
        'connected state'
      );
      assert.equal(state.type, 'state');

      terminalSocket.sendInput('echo hello-fluentssh\r');
      const output = await terminalSocket.waitFor(
        (message) => message.type === 'output' && Buffer.from(message.data, 'base64').toString('utf8').includes('hello-fluentssh'),
        8000,
        'echo output'
      );
      assert.equal(output.type, 'output');

      terminalSocket.send({ type: 'resize', cols: 100, rows: 40 });
      terminalSocket.send({ type: 'ping' });
      await terminalSocket.waitFor((message) => message.type === 'pong', 5000, 'pong');

      // Multiple sockets fan out output, and a late attach replays backlog.
      const secondSocket = await TerminalSocket.openTerminal(baseUrl, terminalSession.id, token);
      extraSockets.push(secondSocket);
      const backlog = await secondSocket.waitFor((message) => message.type === 'backlog', 5000, 'second backlog');
      assert.equal(backlog.type, 'backlog');
      assert.ok(Buffer.from((backlog as { data: string }).data, 'base64').toString('utf8').includes('hello-fluentssh'));
      secondSocket.sendInput('echo fanout-check\r');
      await secondSocket.waitFor(
        (message) => message.type === 'output' && Buffer.from(message.data, 'base64').toString('utf8').includes('fanout-check'),
        8000,
        'second socket output'
      );
      await terminalSocket.waitFor(
        (message) => message.type === 'output' && Buffer.from(message.data, 'base64').toString('utf8').includes('fanout-check'),
        8000,
        'first socket fanout'
      );

      // Closing a socket must not close the SSH session.
      await terminalSocket.close();
      await delay(300);
      const still = await waitForSession(api, terminalSession.id, (session) => session.state === 'connected', 5000);
      assert.equal(still.state, 'connected');
    });

    await step('session stats and resize are persisted', async () => {
      const response = await api.get<{ session: SessionInfo }>(`/api/sessions/${terminalSession.id}`);
      assert.equal(response.status, 200);
      const session = response.data.session;
      assert.ok(session.stats.bytesIn > 0, 'bytesIn should grow from shell output');
      assert.ok(session.stats.bytesOut > 0, 'bytesOut should grow from user input');
      assert.ok(session.stats.connectedAt);
      assert.equal(session.cols, 100);
      assert.equal(session.rows, 40);

      const hostResponse = await api.get<{ host: HostProfile }>(`/api/hosts/${passwordHost.id}`);
      assert.equal(hostResponse.status, 200);
      assert.ok(hostResponse.data.host.connectCount >= 1, 'markHostConnected should bump connectCount');
      assert.ok(hostResponse.data.host.lastConnectedAt);
    });

    await step('shell exit emits exit + closed state and closes the SSH session', async () => {
      const events = await EventSocket.openEvents(baseUrl, token);
      extraSockets.push(events);
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: passwordHost.id
      });
      const sessionId = created.data.session.id;
      await waitForSession(api, sessionId, (session) => session.state === 'connected');
      const ws = await TerminalSocket.openTerminal(baseUrl, sessionId, token);
      extraSockets.push(ws);
      await ws.waitFor((message) => message.type === 'state' && message.state === 'connected', 8000);
      ws.sendInput('exit\r');
      const exitMessage = await ws.waitFor((message) => message.type === 'exit', 8000, 'exit message');
      assert.equal(exitMessage.type, 'exit');
      const closedState = await ws.waitFor(
        (message) => message.type === 'state' && message.state === 'closed',
        8000,
        'closed state'
      );
      assert.equal(closedState.type, 'state');
      const closed = await waitForSession(api, sessionId, (session) => session.state === 'closed', 8000);
      assert.equal(closed.state, 'closed');
      assert.ok(closed.closedAt);
      await events.waitFor(
        (event) => event.type === 'session.closed' && event.sessionId === sessionId,
        8000,
        'session.closed after shell exit'
      );
      assert.equal((await api.del(`/api/sessions/${sessionId}`)).status, 204);
      await ws.close();
    });

    await step('terminal initialCommand is typed into the shell after connect', async () => {
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: passwordHost.id,
        initialCommand: 'echo initial-command-ok'
      });
      const sessionId = created.data.session.id;
      const ws = await TerminalSocket.openTerminal(baseUrl, sessionId, token);
      extraSockets.push(ws);
      await ws.waitFor(
        (message) =>
          message.type === 'output' && Buffer.from(message.data, 'base64').toString('utf8').includes('initial-command-ok'),
        10_000,
        'initial command output'
      );
      assert.equal((await api.del(`/api/sessions/${sessionId}`)).status, 204);
      await ws.close();
    });

    await step('exec: echo succeeds and is recorded in history + audit', async () => {
      const exec = await api.post<{ result: Record<string, unknown> }>('/api/exec', {
        hostId: passwordHost.id,
        command: 'echo exec-hello'
      });
      assert.equal(exec.status, 200, JSON.stringify(exec.data));
      const result = exec.data.result as {
        stdout: string;
        stderr: string;
        exitCode: number | null;
        truncated: boolean;
        hostLabel: string;
        durationMs: number;
        command: string;
      };
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('exec-hello'));
      assert.equal(result.hostLabel, 'Mock Password');
      assert.equal(result.truncated, false);
      assert.ok(result.durationMs >= 0);

      const failing = await api.post<{ result: { exitCode: number | null } }>('/api/exec', {
        hostId: passwordHost.id,
        command: 'false'
      });
      assert.equal(failing.status, 200);
      assert.equal(failing.data.result.exitCode, 1);

      const history = await api.get<{ history: Array<Record<string, unknown>> }>('/api/commands/history?limit=10');
      assert.equal(history.status, 200);
      assert.ok(history.data.history.length >= 2);
      assert.equal(history.data.history[0].command, 'false');
      assert.ok(history.data.history[0].durationMs !== undefined);
      assert.ok('hostId' in history.data.history[0]);
      assert.ok('id' in history.data.history[0]);

      const audit = await api.get<{ events: Array<{ category: string; message: string }> }>(
        '/api/audit?category=command&limit=50'
      );
      assert.ok(audit.data.events.length >= 2, 'command audit events should be recorded');
    });

    await step('exec: host-key error surfaces 409 then retry succeeds after trust', async () => {
      const host = await createHost(api, {
        name: 'Mock Exec2',
        hostname: '127.0.0.1',
        port: mock2!.port,
        username: 'demo',
        authType: 'password',
        password: 'demo123'
      });
      const denied = await api.post('/api/exec', { hostId: host.id, command: 'echo hi' });
      assert.equal(denied.status, 409, JSON.stringify(denied.data));
      assert.equal(errorCode(denied), 'HOST_KEY_UNKNOWN');
      const trust = await api.post('/api/known-hosts/trust', {
        hostname: '127.0.0.1',
        port: mock2!.port,
        keyType: mock2!.keyType,
        fingerprint: mock2!.fingerprint
      });
      assert.equal(trust.status, 201);
      const retried = await api.post<{ result: { exitCode: number | null; stdout: string } }>('/api/exec', {
        hostId: host.id,
        command: 'echo retry-ok'
      });
      assert.equal(retried.status, 200, JSON.stringify(retried.data));
      assert.equal(retried.data.result.exitCode, 0);
      assert.ok(retried.data.result.stdout.includes('retry-ok'));
    });

    await step('exec: timeout (10min cap) returns null exit code and a Chinese timeout notice', async () => {
      const started = Date.now();
      const timedOut = await api.post<{ result: { exitCode: number | null; stderr: string; durationMs: number } }>(
        '/api/exec',
        { hostId: passwordHost.id, command: 'sleep-forever', timeoutMs: 1000 }
      );
      assert.equal(timedOut.status, 200, JSON.stringify(timedOut.data));
      assert.equal(timedOut.data.result.exitCode, null);
      assert.ok(timedOut.data.result.stderr.includes('超时'), timedOut.data.result.stderr);
      assert.ok(Date.now() - started >= 900, 'timeout should be enforced');
    });

    await step('exec: stdout larger than 1 MiB is truncated', async () => {
      const big = await api.post<{ result: { stdout: string; truncated: boolean; exitCode: number | null } }>(
        '/api/exec',
        { hostId: passwordHost.id, command: 'big-output' }
      );
      assert.equal(big.status, 200);
      assert.equal(big.data.result.truncated, true);
      assert.equal(Buffer.byteLength(big.data.result.stdout, 'utf8'), 1024 * 1024);
    });

    await step('exec: keyboard-interactive host prompts through the broker and runs', async () => {
      const kbiHost = await createHost(api, {
        name: 'Mock KBI Exec',
        hostname: '127.0.0.1',
        port: mock!.port,
        username: 'demo',
        authType: 'keyboard-interactive'
      });
      const pending = api.post<{ result: { stdout: string; exitCode: number | null } }>('/api/exec', {
        hostId: kbiHost.id,
        command: 'echo kbi-exec-ok'
      });
      let prompt: AuthPrompt | null = null;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const prompts = await api.get<{ prompts: AuthPrompt[] }>('/api/auth/prompts');
        prompt = prompts.data.prompts.find((item) => item.operation === 'exec') ?? null;
        if (prompt) break;
        await delay(100);
      }
      assert.ok(prompt, 'exec should emit an auth.prompt with operation exec');
      assert.equal(prompt!.sessionId, null);
      const responded = await api.post(`/api/auth/prompts/${prompt!.requestId}/respond`, {
        responses: ['demo123', '123456']
      });
      assert.equal(responded.status, 200);
      const result = await pending;
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.ok(result.data.result.stdout.includes('kbi-exec-ok'));
      assert.equal(result.data.result.exitCode, 0);
    });

    await step('exec: inline connection target works without a saved host', async () => {
      const inline = await api.post<{ result: { stdout: string; hostLabel: string; exitCode: number | null } }>(
        '/api/exec',
        {
          inline: {
            hostname: '127.0.0.1',
            port: mock!.port,
            username: 'demo',
            authType: 'password',
            password: 'demo123',
            name: 'Inline Exec Host'
          },
          command: 'echo inline-exec-ok'
        }
      );
      assert.equal(inline.status, 200, JSON.stringify(inline.data));
      assert.equal(inline.data.result.exitCode, 0);
      assert.ok(inline.data.result.stdout.includes('inline-exec-ok'));
      assert.equal(inline.data.result.hostLabel, 'Inline Exec Host');
    });

    await step('DELETE /api/commands/history clears history', async () => {
      const cleared = await api.del('/api/commands/history');
      assert.equal(cleared.status, 204);
      const history = await api.get<{ history: unknown[] }>('/api/commands/history');
      assert.equal(history.data.history.length, 0);
    });

    let edKey: SshKeyMeta;
    await step('generate ed25519 / rsa / ecdsa keys with correct metadata', async () => {
      const ed = await api.post<{ key: SshKeyMeta }>('/api/keys/generate', { name: 'ed-key' });
      assert.equal(ed.status, 201, JSON.stringify(ed.data));
      edKey = ed.data.key;
      assertKeyMetaShape(edKey);
      assert.equal(edKey.algorithm, 'ed25519');
      assert.equal(edKey.bits, 256);
      assert.equal(edKey.hasPassphrase, false);
      assert.equal(edKey.isGenerated, true);
      assert.ok(edKey.publicKey.startsWith('ssh-ed25519 '));

      const rsa = await api.post<{ key: SshKeyMeta }>('/api/keys/generate', {
        name: 'rsa-key',
        algorithm: 'rsa',
        bits: 2048
      });
      assert.equal(rsa.status, 201);
      assert.equal(rsa.data.key.algorithm, 'rsa');
      assert.equal(rsa.data.key.bits, 2048);
      assert.ok(rsa.data.key.publicKey.startsWith('ssh-rsa '));

      const ecdsa = await api.post<{ key: SshKeyMeta }>('/api/keys/generate', {
        name: 'ecdsa-key',
        algorithm: 'ecdsa',
        bits: 384
      });
      assert.equal(ecdsa.status, 201);
      assert.equal(ecdsa.data.key.algorithm, 'ecdsa');
      assert.equal(ecdsa.data.key.bits, 384);
      assert.ok(ecdsa.data.key.publicKey.startsWith('ecdsa-sha2-nistp384 '));

      const withPassphrase = await api.post<{ key: SshKeyMeta }>('/api/keys/generate', {
        name: 'pass-key',
        passphrase: 'secret-pass'
      });
      assert.equal(withPassphrase.status, 201);
      assert.equal(withPassphrase.data.key.hasPassphrase, true);

      const list = await api.get<{ keys: SshKeyMeta[] }>('/api/keys');
      assert.ok(list.data.keys.length >= 4);
      for (const key of list.data.keys) assertKeyMetaShape(key);
    });

    await step('import plain and passphrase-protected private keys', async () => {
      const generated = sshpk.generatePrivateKey('ed25519');
      generated.comment = 'imported@fluentssh';
      const opensshPrivate = generated.toString('openssh');
      const imported = await api.post<{ key: SshKeyMeta }>('/api/keys/import', {
        name: 'imported-ed',
        privateKey: opensshPrivate
      });
      assert.equal(imported.status, 201, JSON.stringify(imported.data));
      assertKeyMetaShape(imported.data.key);
      assert.equal(imported.data.key.algorithm, 'ed25519');
      assert.equal(imported.data.key.isGenerated, false);
      assert.equal(imported.data.key.hasPassphrase, false);
      assert.equal(imported.data.key.fingerprint, generated.fingerprint('sha256').toString());

      const encrypted = sshpk.generatePrivateKey('ed25519').toString('openssh', { passphrase: 'abc123' });
      const missingPassphrase = await api.post('/api/keys/import', {
        name: 'needs-pass',
        privateKey: encrypted
      });
      assert.equal(missingPassphrase.status, 400, JSON.stringify(missingPassphrase.data));
      assert.equal(errorCode(missingPassphrase), 'VALIDATION');

      const wrongPassphrase = await api.post('/api/keys/import', {
        name: 'needs-pass',
        privateKey: encrypted,
        passphrase: 'wrong-pass'
      });
      assert.equal(wrongPassphrase.status, 400);

      const importedEncrypted = await api.post<{ key: SshKeyMeta }>('/api/keys/import', {
        name: 'needs-pass',
        privateKey: encrypted,
        passphrase: 'abc123'
      });
      assert.equal(importedEncrypted.status, 201, JSON.stringify(importedEncrypted.data));
      assert.equal(importedEncrypted.data.key.hasPassphrase, true);
    });

    await step('PATCH rename key and DELETE conflict when a host references it', async () => {
      const renamed = await api.patch<{ key: SshKeyMeta }>(`/api/keys/${edKey.id}`, { name: 'ed-key-renamed' });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.data.key.name, 'ed-key-renamed');

      const keyHost = await createHost(api, {
        name: 'Mock Key Host',
        hostname: '127.0.0.1',
        port: mock!.port,
        username: 'demo',
        authType: 'key',
        keyId: edKey.id
      });
      assert.equal(keyHost.authType, 'key');
      assert.equal(keyHost.keyId, edKey.id);

      const conflict = await api.del(`/api/keys/${edKey.id}`);
      assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
      assert.equal(errorCode(conflict), 'CONFLICT');

      // An unreferenced key can be deleted.
      const unused = await api.post<{ key: SshKeyMeta }>('/api/keys/generate', { name: 'unused-key' });
      const deleted = await api.del(`/api/keys/${unused.data.key.id}`);
      assert.equal(deleted.status, 204);
      const list = await api.get<{ keys: SshKeyMeta[] }>('/api/keys');
      assert.ok(!list.data.keys.some((key) => key.id === unused.data.key.id));
    });

    let publicKeyHost: HostProfile;
    await step('public key auth session connects using a generated key', async () => {
      mock!.addAuthorizedKey(edKey.publicKey);
      publicKeyHost = await createHost(api, {
        name: 'Mock Key Host',
        hostname: '127.0.0.1',
        port: mock!.port,
        username: 'demo',
        authType: 'key',
        keyId: edKey.id
      });
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: publicKeyHost.id
      });
      assert.equal(created.status, 202);
      const connected = await waitForSession(api, created.data.session.id, (session) => session.state === 'connected');
      assert.equal(connected.state, 'connected');
      const closed = await api.del(`/api/sessions/${connected.id}`);
      assert.equal(closed.status, 204);
    });

    await step('passphrase-protected generated key authenticates (vault + ssh2 round trip)', async () => {
      const protectedKey = await api.post<{ key: SshKeyMeta }>('/api/keys/generate', {
        name: 'connect-protected',
        passphrase: 'connect-passphrase'
      });
      assert.equal(protectedKey.status, 201);
      assert.equal(protectedKey.data.key.hasPassphrase, true);
      mock!.addAuthorizedKey(protectedKey.data.key.publicKey);
      const host = await createHost(api, {
        name: 'Mock Protected Key',
        hostname: '127.0.0.1',
        port: mock!.port,
        username: 'demo',
        authType: 'key',
        keyId: protectedKey.data.key.id
      });
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', { hostId: host.id });
      assert.equal(created.status, 202);
      const connected = await waitForSession(api, created.data.session.id, (session) => session.state === 'connected');
      assert.equal(connected.state, 'connected');
      await api.del(`/api/sessions/${connected.id}`);
    });

    await step('inline terminal session (quick connect) connects without a saved host', async () => {
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        inline: {
          hostname: '127.0.0.1',
          port: mock!.port,
          username: 'demo',
          authType: 'password',
          password: 'demo123',
          name: 'Inline Quick Connect'
        },
        cols: 90,
        rows: 25
      });
      assert.equal(created.status, 202, JSON.stringify(created.data));
      assert.equal(created.data.session.hostId, null);
      assert.equal(created.data.session.hostName, 'Inline Quick Connect');
      const connected = await waitForSession(api, created.data.session.id, (session) => session.state === 'connected');
      assert.equal(connected.state, 'connected');
      assert.equal(connected.cols, 90);
      assert.equal(connected.rows, 25);
      assert.equal((await api.del(`/api/sessions/${created.data.session.id}`)).status, 204);
    });

    await step('keyboard-interactive auth: awaiting-auth, auth.prompt, respond, connected', async () => {
      const events = await EventSocket.openEvents(baseUrl, token);
      extraSockets.push(events);
      const kbiHost = await createHost(api, {
        name: 'Mock KBI',
        hostname: '127.0.0.1',
        port: mock!.port,
        username: 'demo',
        authType: 'keyboard-interactive'
      });
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', { hostId: kbiHost.id });
      assert.equal(created.status, 202, JSON.stringify(created.data));
      const sessionId = created.data.session.id;

      const awaiting = await waitForSession(api, sessionId, (session) => session.state === 'awaiting-auth');
      assert.equal(awaiting.state, 'awaiting-auth');

      const promptEvent = await events.waitFor(
        (event): event is Extract<ServerEvent, { type: 'auth.prompt' }> =>
          event.type === 'auth.prompt' && event.prompt.sessionId === sessionId,
        10_000,
        'auth.prompt event'
      );
      const prompt = promptEvent.prompt;
      assert.equal(prompt.operation, 'session');
      assert.equal(prompt.prompts.length, 2);
      assert.equal(prompt.prompts[0].echo, false);
      assert.equal(prompt.prompts[1].echo, true);

      const pending = await api.get<{ prompts: AuthPrompt[] }>('/api/auth/prompts');
      assert.ok(pending.data.prompts.some((item) => item.requestId === prompt.requestId));

      const responded = await api.post<{ ok: boolean }>(`/api/auth/prompts/${prompt.requestId}/respond`, {
        responses: ['demo123', '123456']
      });
      assert.equal(responded.status, 200);
      assert.equal(responded.data.ok, true);

      const connected = await waitForSession(api, sessionId, (session) => session.state === 'connected');
      assert.equal(connected.state, 'connected');
      await events.waitFor(
        (event) => event.type === 'auth.prompt.closed' && event.requestId === prompt.requestId,
        10_000,
        'auth.prompt.closed event'
      );
      assert.equal((await api.del(`/api/sessions/${sessionId}`)).status, 204);
    });

    await step('host-key MISMATCH is reported with expectedFingerprint and can be re-trusted', async () => {
      const host = await createHost(api, {
        name: 'Mock Mismatch',
        hostname: '127.0.0.1',
        port: mock2!.port,
        username: 'demo',
        authType: 'password',
        password: 'demo123'
      });
      // Replace the trusted key with a bogus fingerprint for the same host/key type.
      const current = await api.get<{ knownHosts: Array<{ id: string; hostname: string; port: number }> }>(
        '/api/known-hosts'
      );
      for (const entry of current.data.knownHosts) {
        if (entry.hostname === '127.0.0.1' && entry.port === mock2!.port) {
          await api.del(`/api/known-hosts/${entry.id}`);
        }
      }
      const bogus = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const trusted = await api.post('/api/known-hosts/trust', {
        hostname: '127.0.0.1',
        port: mock2!.port,
        keyType: mock2!.keyType,
        fingerprint: bogus
      });
      assert.equal(trusted.status, 201);

      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', { hostId: host.id });
      const errored = await waitForSession(api, created.data.session.id, (session) => session.state === 'error');
      assert.equal(errored.errorCode, 'HOST_KEY_MISMATCH');
      assert.equal(errored.errorDetails!.expectedFingerprint, bogus);
      assert.equal(errored.errorDetails!.fingerprint, mock2!.fingerprint);

      // Trust the real key, reconnect, and clean up.
      await api.post('/api/known-hosts/trust', {
        hostname: '127.0.0.1',
        port: mock2!.port,
        keyType: mock2!.keyType,
        fingerprint: mock2!.fingerprint
      });
      const reconnected = await api.post<{ session: SessionInfo }>(`/api/sessions/${created.data.session.id}/reconnect`);
      assert.equal(reconnected.status, 202);
      const connected = await waitForSession(api, created.data.session.id, (session) => session.state === 'connected');
      assert.equal(connected.state, 'connected');
      await api.del(`/api/sessions/${connected.id}`);
    });

    await step('known_hosts import skips hashed/invalid lines and export round-trips', async () => {
      const blob = mock2!.publicKey.split(/\s+/)[1];
      const importing = [
        `127.0.0.1 ${mock2!.publicKey}`,
        `[example.test]:2222 ${mock2!.publicKey}`,
        `|1|hashedhostname|hashvalue ${mock2!.publicKey}`,
        'this-is-not-a-known-hosts-line',
        '# a comment'
      ].join('\n');
      const imported = await api.post<{ imported: number; skipped: number }>('/api/known-hosts/import', {
        content: importing
      });
      assert.equal(imported.status, 200, JSON.stringify(imported.data));
      assert.ok(imported.data.imported >= 2, `expected >=2 imported, got ${JSON.stringify(imported.data)}`);
      assert.ok(imported.data.skipped >= 2, `expected >=2 skipped, got ${JSON.stringify(imported.data)}`);

      const exported = await api.get<{ content: string }>('/api/known-hosts/export');
      const content = exported.data.content;
      assert.ok(content.includes(`[example.test]:2222 ${mock2!.keyType} ${blob}`), 'export should keep bracketed port entries');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/\s+/);
        assert.equal(parts.length, 3, `malformed exported known_hosts line: ${trimmed}`);
        assert.match(parts[2], /^[A-Za-z0-9+/]+=*$/, `exported blob is not base64: ${trimmed}`);
      }
      assert.ok(!content.includes('|1|'), 'export must not include hashed entries');

      const list = await api.get<{ knownHosts: Array<Record<string, unknown>> }>('/api/known-hosts');
      for (const entry of list.data.knownHosts) {
        assert.deepEqual(Object.keys(entry).sort(), [
          'addedAt',
          'fingerprint',
          'hostname',
          'id',
          'keyType',
          'lastSeenAt',
          'port',
          'source'
        ]);
      }
      const example = list.data.knownHosts.find((entry) => entry.hostname === 'example.test');
      assert.ok(example);
      assert.equal(example.port, 2222);
      assert.equal(example.source, 'import');
      const removed = await api.del(`/api/known-hosts/${String(example.id)}`);
      assert.equal(removed.status, 204);
      const after = await api.get<{ knownHosts: Array<{ hostname: string }> }>('/api/known-hosts');
      assert.ok(!after.data.knownHosts.some((entry) => entry.hostname === 'example.test'));

      // Cleaning up an id that does not exist yields 404.
      const missing = await api.del(`/api/known-hosts/${trustedKnownHostId}-missing`);
      assert.equal(missing.status, 404);
    });

    await step('session disconnect keeps entry, reconnect reuses id, DELETE removes it', async () => {
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: passwordHost.id
      });
      const sessionId = created.data.session.id;
      await waitForSession(api, sessionId, (session) => session.state === 'connected');

      const disconnected = await api.post<{ session: SessionInfo }>(`/api/sessions/${sessionId}/disconnect`);
      assert.equal(disconnected.status, 200);
      assert.equal(disconnected.data.session.state, 'closed');
      assert.ok(disconnected.data.session.closedAt);

      const stillListed = await api.get<{ sessions: SessionInfo[] }>('/api/sessions');
      assert.ok(stillListed.data.sessions.some((session) => session.id === sessionId), 'closed session stays re-connectable');

      const reconnect = await api.post<{ session: SessionInfo }>(`/api/sessions/${sessionId}/reconnect`);
      assert.equal(reconnect.status, 202);
      const connected = await waitForSession(api, sessionId, (session) => session.state === 'connected');
      assert.equal(connected.state, 'connected');

      const deleted = await api.del(`/api/sessions/${sessionId}`);
      assert.equal(deleted.status, 204);
      const gone = await api.get(`/api/sessions/${sessionId}`);
      assert.equal(gone.status, 404);
      assert.equal(errorCode(gone), 'NOT_FOUND');
    });

    await step('session recording list/download/delete', async () => {
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: passwordHost.id
      });
      const sessionId = created.data.session.id;
      await waitForSession(api, sessionId, (session) => session.state === 'connected');
      const ws = await TerminalSocket.openTerminal(baseUrl, sessionId, token);
      extraSockets.push(ws);
      await ws.waitFor((message) => message.type === 'state' && message.state === 'connected');
      ws.sendInput('echo recorded-output-42\r');
      await ws.waitFor(
        (message) =>
          message.type === 'output' && Buffer.from(message.data, 'base64').toString('utf8').includes('recorded-output-42'),
        8000
      );
      await delay(150);
      await api.del(`/api/sessions/${sessionId}`);
      await ws.close();
      await delay(200);

      const logs = await api.get<{ logs: Array<{ sessionId: string; hostLabel: string; kind: string; size: number; path: string }> }>(
        '/api/logs'
      );
      assert.equal(logs.status, 200);
      const meta = logs.data.logs.find((entry) => entry.sessionId === sessionId);
      assert.ok(meta, `missing session log meta for ${sessionId}`);
      assert.equal(meta!.kind, 'terminal');
      assert.ok(meta!.size > 0, 'recorded log should have a non-zero size');

      const download = await api.get(`/api/logs/${sessionId}`);
      assert.equal(download.status, 200);
      assert.match(String(download.headers.get('content-type')), /text\/plain/);
      assert.ok(String(download.data).includes('recorded-output-42'));

      const removed = await api.del(`/api/logs/${sessionId}`);
      assert.equal(removed.status, 204);
      const missing = await api.get(`/api/logs/${sessionId}`);
      assert.equal(missing.status, 404);
    });

    await step('event WS emits session.updated / session.closed / audit events', async () => {
      const events = await EventSocket.openEvents(baseUrl, token);
      extraSockets.push(events);
      await events.waitFor((event) => event.type === 'hello', 5000, 'hello');
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        hostId: passwordHost.id
      });
      const sessionId = created.data.session.id;
      await events.waitFor(
        (event) => event.type === 'session.updated' && event.session.id === sessionId && event.session.state === 'connected',
        10_000,
        'session.updated connected'
      );
      await api.del(`/api/sessions/${sessionId}`);
      await events.waitFor(
        (event) => event.type === 'session.closed' && event.sessionId === sessionId,
        10_000,
        'session.closed'
      );
      await events.waitFor((event) => event.type === 'audit', 10_000, 'audit event');
    });

    await step('rejections: unknown session 404, invalid terminal id 404, validation 400', async () => {
      const unknown = await api.get('/api/sessions/does-not-exist');
      assert.equal(unknown.status, 404);
      assert.equal(errorCode(unknown), 'NOT_FOUND');
      const invalidKind = await api.get('/api/sessions?kind=bogus');
      assert.equal(invalidKind.status, 400);
      assert.equal(errorCode(invalidKind), 'VALIDATION');
      const badExec = await api.post('/api/exec', { hostId: passwordHost.id, command: '' });
      assert.equal(badExec.status, 400);
      const unknownReconnect = await api.post('/api/sessions/does-not-exist/reconnect');
      assert.equal(unknownReconnect.status, 404);
      const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws/terminal/does-not-exist`);
      const outcome = await new Promise<string>((resolve) => {
        ws.once('unexpected-response', (_req, res) => resolve(`http-${res.statusCode}`));
        ws.once('error', () => resolve('error'));
        setTimeout(() => resolve('timeout'), 4000);
      });
      assert.notEqual(outcome, 'timeout', 'unknown terminal session upgrade should be rejected');
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    });

    await step('reconnect while connecting is rejected with 409 CONFLICT', async () => {
      const created = await api.post<{ session: SessionInfo }>('/api/sessions/terminal', {
        inline: {
          hostname: '203.0.113.1',
          port: 65000,
          username: 'demo',
          authType: 'password',
          password: 'unused',
          name: 'Blackhole',
          connectTimeout: 5000
        }
      });
      assert.equal(created.status, 202);
      const sessionId = created.data.session.id;
      const again = await api.post(`/api/sessions/${sessionId}/reconnect`);
      assert.equal(again.status, 409, JSON.stringify(again.data));
      assert.equal(errorCode(again), 'CONFLICT');
      assert.equal((await api.del(`/api/sessions/${sessionId}`)).status, 204);
    });

    const failed = results.filter((entry) => !entry.ok);
    const total = results.length;
    console.log(`\n${total - failed.length}/${total} steps passed`);
    if (failed.length > 0) {
      for (const entry of failed) console.error(`FAILED: ${entry.name}\n${entry.detail}`);
      process.exitCode = 1;
    } else {
      console.log('All SSH core backend checks passed.\n');
    }
  } finally {
    for (const socket of extraSockets) {
      try {
        await socket.close();
      } catch {
        // ignore
      }
    }
    if (running) {
      if (results.some((entry) => !entry.ok)) console.error(`\n--- server output ---\n${running.logs()}\n---------------------`);
      await running.stop();
    }
    await mock?.stop();
    await mock2?.stop();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((error) => {
  console.error('\nSSH core backend tests failed:', error);
  process.exitCode = 1;
});
