import crypto from 'node:crypto';
import path from 'node:path';
import type { EventEmitter } from 'node:events';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import type {
  CreateSftpSessionInput,
  CreateTerminalSessionInput,
  SessionInfo,
  SessionKind,
  SessionLogMeta,
  SessionState,
  TerminalServerMessage
} from '../../../shared/types.js';
import { config } from '../config.js';
import { audit } from '../core/audit.js';
import { ApiError } from '../core/errors.js';
import { eventHub } from '../core/events.js';
import { promptBroker } from '../core/prompts.js';
import { getSessionLogStore } from '../core/session-logs.js';
import { markHostConnected } from '../core/hosts-service.js';
import {
  openConnection,
  openSftp,
  openShell,
  resolveConnection,
  type OpenConnection,
  type ResolvedConnection
} from './connection.js';
import { getSettings } from './settings-access.js';

/**
 * SSH session lifecycle manager.
 *
 * One ssh2 `Client` is owned per terminal/SFTP session. Creation is
 * asynchronous: `createTerminalSession`/`createSftpSession` return an
 * in-memory `SessionInfo` in state `connecting` immediately and the handshake
 * continues in the background, with progress announced through the event hub
 * (`session.updated`) and the terminal WebSocket (`state` messages).
 *
 * Terminal output is retained in a bounded ring buffer (last 256 KB) so a
 * browser refresh can replay the screen; sessions survive browser disconnects.
 */

const BACKLOG_LIMIT_BYTES = 256 * 1024;
const PENDING_INPUT_LIMIT_BYTES = 64 * 1024;

export type SessionClosedListener = (sessionId: string, session: SessionInfo) => void;

export interface TerminalSessionHandle {
  readonly sessionId: string;
  getInfo(): SessionInfo;
  /** Concatenated replay buffer (up to the last 256 KB of output). */
  getBacklog(): Buffer;
  /** Feed raw keystrokes. Returns false when the session cannot accept input. */
  write(data: Buffer): boolean;
  resize(cols: number, rows: number): void;
  onOutput(listener: (chunk: Buffer) => void): () => void;
  onMessage(listener: (message: TerminalServerMessage) => void): () => void;
}

interface SessionRuntime {
  info: SessionInfo;
  resolved: ResolvedConnection;
  input: CreateTerminalSessionInput | CreateSftpSessionInput;
  connection: OpenConnection | null;
  shell: ClientChannel | null;
  exit: { code: number | null; signal: string | null } | null;
  sftp: SFTPWrapper | null;
  sftpPromise: Promise<SFTPWrapper> | null;
  backlog: Buffer[];
  backlogBytes: number;
  pendingInput: Buffer[];
  pendingInputBytes: number;
  outputListeners: Set<(chunk: Buffer) => void>;
  messageListeners: Set<(message: TerminalServerMessage) => void>;
  /** True while we are intentionally tearing the transport down. */
  closing: boolean;
  /** True once the session was deleted (never reconnectable). */
  removed: boolean;
  closeNotified: boolean;
  connectAttempt: number;
  connectStartedAt: number;
  logRecording: boolean;
  logBytes: number;
}

const sessions = new Map<string, SessionRuntime>();
const closedListeners = new Set<SessionClosedListener>();
let eventSubscriptionsReady = false;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cloneInfo(info: SessionInfo): SessionInfo {
  return structuredClone(info);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function logPath(sessionId: string): string {
  return path.join(config.dataDir, 'logs', `${sessionId}.log`);
}

function appendBacklog(rt: SessionRuntime, chunk: Buffer) {
  if (chunk.length === 0) return;
  rt.backlog.push(chunk);
  rt.backlogBytes += chunk.length;
  while (rt.backlogBytes > BACKLOG_LIMIT_BYTES && rt.backlog.length > 1) {
    const first = rt.backlog[0];
    const excess = rt.backlogBytes - BACKLOG_LIMIT_BYTES;
    if (first.length <= excess) {
      rt.backlog.shift();
      rt.backlogBytes -= first.length;
    } else {
      rt.backlog[0] = first.subarray(excess);
      rt.backlogBytes -= excess;
    }
  }
  // A single chunk larger than the whole ring keeps only its tail.
  if (rt.backlogBytes > BACKLOG_LIMIT_BYTES && rt.backlog.length === 1) {
    rt.backlog[0] = rt.backlog[0].subarray(rt.backlogBytes - BACKLOG_LIMIT_BYTES);
    rt.backlogBytes = BACKLOG_LIMIT_BYTES;
  }
}

function broadcastOutput(rt: SessionRuntime, chunk: Buffer) {
  for (const listener of rt.outputListeners) {
    try {
      listener(chunk);
    } catch {
      // A broken WebSocket listener must never break the SSH stream.
    }
  }
}

function broadcastMessage(rt: SessionRuntime, message: TerminalServerMessage) {
  for (const listener of rt.messageListeners) {
    try {
      listener(message);
    } catch {
      // ignore
    }
  }
}

function stateMessage(rt: SessionRuntime): TerminalServerMessage {
  const message: {
    type: 'state';
    state: SessionState;
    message?: string;
    errorCode?: string;
    errorDetails?: Record<string, unknown>;
  } = { type: 'state', state: rt.info.state };
  if (rt.info.lastError) message.message = rt.info.lastError;
  if (rt.info.errorCode) message.errorCode = rt.info.errorCode;
  if (rt.info.errorDetails) message.errorDetails = rt.info.errorDetails;
  return message;
}

function publishUpdated(rt: SessionRuntime) {
  eventHub.publish({ type: 'session.updated', session: cloneInfo(rt.info) });
}

function publishClosed(rt: SessionRuntime, reason?: string) {
  eventHub.publish({
    type: 'session.closed',
    sessionId: rt.info.id,
    state: rt.info.state,
    reason
  });
}

function notifyClosed(rt: SessionRuntime) {
  if (rt.closeNotified) return;
  rt.closeNotified = true;
  const snapshot = cloneInfo(rt.info);
  for (const listener of closedListeners) {
    try {
      listener(rt.info.id, snapshot);
    } catch {
      // ignore
    }
  }
}

function setState(rt: SessionRuntime, state: SessionState) {
  rt.info.state = state;
  publishUpdated(rt);
  broadcastMessage(rt, stateMessage(rt));
  if (state === 'closed' || state === 'error' || state === 'disconnected') notifyClosed(rt);
}

function startRecording(rt: SessionRuntime) {
  if (rt.info.kind !== 'terminal' || rt.logRecording) return;
  if (!getSettings().security.recordSessions) return;
  rt.logRecording = true;
  rt.logBytes = 0;
  const meta: SessionLogMeta = {
    sessionId: rt.info.id,
    hostLabel: rt.info.hostName,
    kind: 'terminal',
    startedAt: rt.info.connectedAt ?? Date.now(),
    size: 0,
    path: logPath(rt.info.id)
  };
  getSessionLogStore().writeMeta(rt.info.id, meta);
}

function finalizeRecording(rt: SessionRuntime) {
  if (!rt.logRecording) return;
  rt.logRecording = false;
  const meta: SessionLogMeta = {
    sessionId: rt.info.id,
    hostLabel: rt.info.hostName,
    kind: 'terminal',
    startedAt: rt.info.connectedAt ?? Date.now(),
    size: rt.logBytes,
    path: logPath(rt.info.id)
  };
  getSessionLogStore().writeMeta(rt.info.id, meta);
}

function writeInput(rt: SessionRuntime, data: Buffer) {
  if (!rt.shell || rt.info.state !== 'connected') return false;
  try {
    rt.shell.write(data);
    rt.info.stats.bytesOut += data.length;
    return true;
  } catch {
    return false;
  }
}

function queuePendingInput(rt: SessionRuntime, data: Buffer) {
  if (data.length === 0) return;
  if (rt.pendingInputBytes + data.length > PENDING_INPUT_LIMIT_BYTES) return;
  rt.pendingInput.push(data);
  rt.pendingInputBytes += data.length;
}

function flushPendingInput(rt: SessionRuntime) {
  if (rt.pendingInput.length === 0) return;
  const pending = Buffer.concat(rt.pendingInput);
  rt.pendingInput = [];
  rt.pendingInputBytes = 0;
  writeInput(rt, pending);
}

function teardownTransport(rt: SessionRuntime) {
  promptBroker.cancelForSession(rt.info.id);

  const shell = rt.shell;
  rt.shell = null;
  if (shell) {
    try {
      shell.close();
    } catch {
      // ignore
    }
  }

  const sftp = rt.sftp;
  rt.sftp = null;
  rt.sftpPromise = null;
  if (sftp) {
    try {
      (sftp as unknown as { end?: () => void }).end?.();
    } catch {
      // ignore
    }
  }

  const connection = rt.connection;
  rt.connection = null;
  if (connection) {
    try {
      connection.close();
    } catch {
      // ignore
    }
  }
}

function scheduleInitialCommands(rt: SessionRuntime) {
  const input = rt.input as CreateTerminalSessionInput;
  const commands = [rt.resolved.startupCommand?.trim() ?? '', input.initialCommand?.trim() ?? ''].filter(Boolean);
  if (commands.length === 0) return;
  let delay = 120;
  for (const command of commands) {
    const timer = setTimeout(() => {
      if (rt.removed || rt.closing || !rt.shell || rt.info.state !== 'connected') return;
      writeInput(rt, Buffer.from(`${command}\r`, 'utf8'));
    }, delay);
    timer.unref?.();
    delay += 150;
  }
}

/* ------------------------------------------------------------------ */
/* Auth prompt state (keyboard-interactive)                            */
/* ------------------------------------------------------------------ */

function ensureEventSubscriptions() {
  if (eventSubscriptionsReady) return;
  eventSubscriptionsReady = true;
  eventHub.subscribe((event) => {
    if (event.type === 'auth.prompt') {
      const sessionId = event.prompt.sessionId;
      if (!sessionId) return;
      const rt = sessions.get(sessionId);
      if (!rt || rt.removed) return;
      if (rt.info.state === 'connecting') setState(rt, 'awaiting-auth');
      return;
    }
    if (event.type === 'auth.prompt.closed') {
      for (const rt of sessions.values()) {
        if (rt.info.state !== 'awaiting-auth') continue;
        const stillBlocked = promptBroker.list().some((prompt) => prompt.sessionId === rt.info.id);
        if (!stillBlocked) setState(rt, 'connecting');
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Connection lifecycle                                                */
/* ------------------------------------------------------------------ */

function wireConnection(rt: SessionRuntime, connection: OpenConnection) {
  const client = connection.client;
  client.on('error', (error) => handleConnectionLoss(rt, errorMessage(error)));
  client.on('end', () => handleConnectionLoss(rt, '连接已结束'));
  client.on('close', () => handleConnectionLoss(rt, '连接已断开'));
}

function handleConnectionLoss(rt: SessionRuntime, message: string) {
  if (rt.removed || rt.closing) return;
  if (rt.info.state !== 'connected' && rt.info.state !== 'awaiting-auth') return;
  rt.closing = true;
  finalizeRecording(rt);
  rt.info.lastError = message;
  rt.info.errorCode = null;
  rt.info.errorDetails = null;
  rt.info.closedAt = Date.now();
  rt.info.state = 'disconnected';
  publishUpdated(rt);
  broadcastMessage(rt, stateMessage(rt));
  notifyClosed(rt);
  audit('connection', 'warn', `连接已断开：${rt.resolved.label} — ${message}`, {
    hostId: rt.resolved.hostId,
    hostLabel: rt.resolved.label,
    details: { sessionId: rt.info.id }
  });
}

function wireShell(rt: SessionRuntime, shell: ClientChannel, attempt: number) {
  shell.on('data', (chunk: Buffer) => {
    if (rt.connectAttempt !== attempt) return;
    handleOutput(rt, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  try {
    shell.stderr.on('data', (chunk: Buffer) => {
      if (rt.connectAttempt !== attempt) return;
      handleOutput(rt, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
  } catch {
    // Some channel implementations do not expose a usable stderr stream.
  }

  const channelEvents = shell as unknown as EventEmitter;
  channelEvents.on('exit', (code: number | null, signal?: string) => {
    rt.exit = { code: typeof code === 'number' ? code : null, signal: typeof signal === 'string' ? signal : null };
  });
  channelEvents.on('error', (error: unknown) => {
    if (rt.connectAttempt !== attempt) return;
    if (rt.info.state === 'connected') rt.info.lastError = errorMessage(error);
    finishShell(rt, attempt);
  });
  channelEvents.on('close', () => finishShell(rt, attempt));
  channelEvents.on('end', () => finishShell(rt, attempt));
}

function handleOutput(rt: SessionRuntime, chunk: Buffer) {
  if (chunk.length === 0 || rt.removed) return;
  appendBacklog(rt, chunk);
  if (rt.logRecording) {
    getSessionLogStore().append(rt.info.id, chunk);
    rt.logBytes += chunk.length;
  }
  rt.info.stats.bytesIn += chunk.length;
  broadcastOutput(rt, chunk);
}

function finishShell(rt: SessionRuntime, attempt: number) {
  if (rt.connectAttempt !== attempt) return;
  if (rt.removed) return;
  if (rt.info.state === 'closed' || rt.info.state === 'error' || rt.info.state === 'disconnected') return;
  if (rt.closing) return;
  rt.closing = true;
  const exit = rt.exit;
  rt.info.state = 'closed';
  rt.info.closedAt = Date.now();
  rt.info.stats.connectedAt = rt.info.connectedAt;
  finalizeRecording(rt);
  teardownTransport(rt);
  publishUpdated(rt);
  publishClosed(rt, 'exit');
  broadcastMessage(rt, {
    type: 'exit',
    code: exit?.code ?? undefined,
    signal: exit?.signal ?? undefined
  });
  broadcastMessage(rt, stateMessage(rt));
  notifyClosed(rt);
}

function failSession(rt: SessionRuntime, error: unknown) {
  rt.closing = true;
  const apiError = error instanceof ApiError ? error : null;
  rt.info.state = 'error';
  rt.info.closedAt = Date.now();
  rt.info.lastError = errorMessage(error);
  rt.info.errorCode = apiError?.code ?? 'CONNECTION_FAILED';
  rt.info.errorDetails = apiError?.details ?? null;
  finalizeRecording(rt);
  teardownTransport(rt);
  publishUpdated(rt);
  broadcastMessage(rt, stateMessage(rt));
  notifyClosed(rt);
  audit('connection', 'error', `连接失败：${rt.resolved.label} — ${rt.info.lastError}`, {
    hostId: rt.resolved.hostId,
    hostLabel: rt.resolved.label,
    details: { sessionId: rt.info.id, code: rt.info.errorCode }
  });
}

async function connectSession(rt: SessionRuntime, attempt: number) {
  rt.connectStartedAt = Date.now();
  try {
    const connection = await openConnection(rt.resolved, { kind: 'session', sessionId: rt.info.id });
    if (rt.removed || rt.connectAttempt !== attempt) {
      try {
        connection.close();
      } catch {
        // ignore
      }
      return;
    }
    rt.connection = connection;
    rt.info.hostKeyFingerprint = connection.fingerprint || null;
    wireConnection(rt, connection);

    if (rt.info.kind === 'terminal') {
      const shell = await openShell(connection, {
        cols: rt.info.cols,
        rows: rt.info.rows,
        term: rt.info.term,
        env: rt.resolved.env
      });
      if (rt.removed || rt.connectAttempt !== attempt) {
        try {
          shell.close();
        } catch {
          // ignore
        }
        try {
          connection.close();
        } catch {
          // ignore
        }
        return;
      }
      rt.shell = shell;
      wireShell(rt, shell, attempt);
    } else {
      const sftp = await openSftp(connection);
      if (rt.removed || rt.connectAttempt !== attempt) {
        try {
          (sftp as unknown as { end?: () => void }).end?.();
        } catch {
          // ignore
        }
        try {
          connection.close();
        } catch {
          // ignore
        }
        return;
      }
      rt.sftp = sftp;
      rt.sftpPromise = Promise.resolve(sftp);
      sftp.on('close', () => {
        if (rt.sftp === sftp) {
          rt.sftp = null;
          rt.sftpPromise = null;
        }
      });
      sftp.on('error', () => {
        if (rt.sftp === sftp) {
          rt.sftp = null;
          rt.sftpPromise = null;
        }
      });
    }

    const connectedAt = Date.now();
    rt.info.connectedAt = connectedAt;
    rt.info.closedAt = null;
    rt.info.lastError = null;
    rt.info.errorCode = null;
    rt.info.errorDetails = null;
    rt.info.stats.connectedAt = connectedAt;
    rt.info.stats.latencyMs = connectedAt - rt.connectStartedAt;
    if (rt.info.state !== 'connected') setState(rt, 'connected');
    markHostConnected(rt.resolved.hostId);

    if (rt.info.kind === 'terminal') {
      startRecording(rt);
      flushPendingInput(rt);
      scheduleInitialCommands(rt);
    }

    audit(
      'connection',
      'info',
      `已连接 ${rt.resolved.label}（${rt.info.kind === 'terminal' ? '终端' : 'SFTP'}）`,
      {
        hostId: rt.resolved.hostId,
        hostLabel: rt.resolved.label,
        details: { sessionId: rt.info.id, kind: rt.info.kind, hostKeyFingerprint: connection.fingerprint }
      }
    );
  } catch (error) {
    if (rt.removed || rt.connectAttempt !== attempt) return;
    failSession(rt, error);
  }
}

/* ------------------------------------------------------------------ */
/* Session creation                                                    */
/* ------------------------------------------------------------------ */

function registerSession(
  kind: SessionKind,
  input: CreateTerminalSessionInput | CreateSftpSessionInput,
  resolved: ResolvedConnection
): SessionInfo {
  ensureEventSubscriptions();
  const id = crypto.randomUUID();
  const now = Date.now();
  const isTerminal = kind === 'terminal';
  const terminalInput = input as CreateTerminalSessionInput;
  const cols = isTerminal ? clampInt(terminalInput.cols, 2, 1000, 80) : 0;
  const rows = isTerminal ? clampInt(terminalInput.rows, 1, 1000, 24) : 0;
  const title = input.title?.trim() || (isTerminal ? resolved.label : `${resolved.label} · SFTP`);

  const info: SessionInfo = {
    id,
    kind,
    hostId: resolved.hostId,
    hostName: resolved.label,
    hostname: resolved.hostname,
    port: resolved.port,
    username: resolved.username,
    title,
    state: 'connecting',
    createdAt: now,
    connectedAt: null,
    closedAt: null,
    lastError: null,
    errorCode: null,
    errorDetails: null,
    cols,
    rows,
    term: isTerminal ? resolved.terminal.term || 'xterm-256color' : 'xterm-256color',
    stats: { bytesIn: 0, bytesOut: 0, connectedAt: null, latencyMs: null },
    hostKeyFingerprint: null
  };

  const rt: SessionRuntime = {
    info,
    resolved,
    input,
    connection: null,
    shell: null,
    exit: null,
    sftp: null,
    sftpPromise: null,
    backlog: [],
    backlogBytes: 0,
    pendingInput: [],
    pendingInputBytes: 0,
    outputListeners: new Set(),
    messageListeners: new Set(),
    closing: false,
    removed: false,
    closeNotified: false,
    connectAttempt: 1,
    connectStartedAt: now,
    logRecording: false,
    logBytes: 0
  };

  sessions.set(id, rt);
  publishUpdated(rt);
  void connectSession(rt, rt.connectAttempt);
  return cloneInfo(info);
}

export function createTerminalSession(input: CreateTerminalSessionInput): SessionInfo {
  const resolved = resolveConnection(input);
  return registerSession('terminal', input, resolved);
}

export function createSftpSession(input: CreateSftpSessionInput): SessionInfo {
  const resolved = resolveConnection(input);
  return registerSession('sftp', input, resolved);
}

/* ------------------------------------------------------------------ */
/* Public queries                                                      */
/* ------------------------------------------------------------------ */

export function getSessionInfo(id: string): SessionInfo | null {
  const rt = sessions.get(id);
  return rt ? cloneInfo(rt.info) : null;
}

export function listSessions(kind?: SessionKind): SessionInfo[] {
  const all = [...sessions.values()];
  const filtered = kind ? all.filter((rt) => rt.info.kind === kind) : all;
  return filtered.map((rt) => cloneInfo(rt.info));
}

export function isSessionConnected(id: string): boolean {
  const rt = sessions.get(id);
  return Boolean(rt && rt.info.state === 'connected');
}

/** Subscribe to session termination (closed/error/disconnected). */
export function onSessionClosed(listener: SessionClosedListener): () => void {
  closedListeners.add(listener);
  return () => closedListeners.delete(listener);
}

/** Subscribe to every `session.updated` transition (convenience helper). */
export function onSessionUpdated(listener: (session: SessionInfo) => void): () => void {
  return eventHub.subscribe((event) => {
    if (event.type === 'session.updated') listener(event.session);
  });
}

/* ------------------------------------------------------------------ */
/* SFTP channel                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the live SFTP channel for a connected `kind:'sftp'` session.
 * The wrapper is created once and reused; it is dropped when the underlying
 * connection goes away so callers always get a fresh channel after reconnect.
 */
export function getSftpChannel(sessionId: string): Promise<SFTPWrapper> {
  const rt = sessions.get(sessionId);
  if (!rt) {
    return Promise.reject(new ApiError(404, 'NOT_FOUND', 'SFTP 会话不存在或已被删除。'));
  }
  if (rt.info.kind !== 'sftp') {
    return Promise.reject(new ApiError(409, 'SESSION_NOT_CONNECTED', '该会话不是 SFTP 会话。'));
  }
  if (rt.removed) {
    return Promise.reject(new ApiError(404, 'NOT_FOUND', 'SFTP 会话不存在或已被删除。'));
  }
  if (rt.info.state === 'connecting' || rt.info.state === 'awaiting-auth') {
    return Promise.reject(new ApiError(409, 'SESSION_NOT_CONNECTED', 'SFTP 会话尚未连接完成，请稍候。'));
  }
  if (rt.info.state !== 'connected') {
    return Promise.reject(new ApiError(409, 'SESSION_NOT_CONNECTED', 'SFTP 会话未连接。'));
  }
  if (rt.sftp) return Promise.resolve(rt.sftp);
  if (rt.sftpPromise) return rt.sftpPromise;
  if (!rt.connection) {
    return Promise.reject(new ApiError(409, 'SESSION_NOT_CONNECTED', 'SFTP 会话未连接。'));
  }
  const promise = openSftp(rt.connection)
    .then((sftp) => {
      if (rt.sftpPromise === promise) {
        rt.sftp = sftp;
        sftp.on('close', () => {
          if (rt.sftp === sftp) {
            rt.sftp = null;
            rt.sftpPromise = null;
          }
        });
        sftp.on('error', () => {
          if (rt.sftp === sftp) {
            rt.sftp = null;
            rt.sftpPromise = null;
          }
        });
      }
      return sftp;
    })
    .catch((error: unknown) => {
      if (rt.sftpPromise === promise) rt.sftpPromise = null;
      const message = errorMessage(error);
      throw new ApiError(409, 'SESSION_NOT_CONNECTED', `无法打开 SFTP 通道：${message}`);
    });
  rt.sftpPromise = promise;
  return promise;
}

/* ------------------------------------------------------------------ */
/* Close / reconnect                                                   */
/* ------------------------------------------------------------------ */

/** Close and remove a session (DELETE semantics). */
export async function closeSession(id: string): Promise<SessionInfo | null> {
  const rt = sessions.get(id);
  if (!rt) return null;
  rt.removed = true;
  rt.closing = true;
  rt.connectAttempt += 1;
  teardownTransport(rt);
  finalizeRecording(rt);
  rt.info.state = 'closed';
  rt.info.closedAt = rt.info.closedAt ?? Date.now();
  const snapshot = cloneInfo(rt.info);
  sessions.delete(id);
  publishUpdated(rt);
  publishClosed(rt, 'deleted');
  broadcastMessage(rt, stateMessage(rt));
  notifyClosed(rt);
  audit('connection', 'info', `关闭会话 ${rt.resolved.label}`, {
    hostId: rt.resolved.hostId,
    hostLabel: rt.resolved.label,
    details: { sessionId: id, kind: rt.info.kind }
  });
  return snapshot;
}

/**
 * Drop the SSH transport but keep the session entry so it can be reconnected.
 * The public session state becomes `closed`.
 */
export function disconnectSession(id: string): SessionInfo {
  const rt = sessions.get(id);
  if (!rt) throw new ApiError(404, 'NOT_FOUND', '会话不存在或已被删除。');
  if (rt.info.state !== 'closed') {
    rt.closing = true;
    rt.connectAttempt += 1;
    teardownTransport(rt);
    finalizeRecording(rt);
    rt.info.state = 'closed';
    rt.info.closedAt = Date.now();
    publishUpdated(rt);
    publishClosed(rt, 'disconnect');
    broadcastMessage(rt, stateMessage(rt));
    notifyClosed(rt);
    audit('connection', 'info', `断开会话 ${rt.resolved.label}`, {
      hostId: rt.resolved.hostId,
      hostLabel: rt.resolved.label,
      details: { sessionId: id, kind: rt.info.kind }
    });
  }
  return cloneInfo(rt.info);
}

/**
 * Reconnect an existing session in place, keeping the same session id so the
 * frontend tab and WebSocket re-attach without churn. Returns immediately with
 * a `connecting` snapshot.
 */
export function reconnectSession(id: string): SessionInfo {
  const rt = sessions.get(id);
  if (!rt) throw new ApiError(404, 'NOT_FOUND', '会话不存在或已被删除。');
  if (rt.info.state === 'connecting' || rt.info.state === 'awaiting-auth') {
    throw new ApiError(409, 'CONFLICT', '会话正在连接中，请稍候。');
  }
  rt.closing = true;
  teardownTransport(rt);
  rt.connectAttempt += 1;
  rt.closing = false;
  rt.closeNotified = false;
  rt.exit = null;
  rt.removed = false;
  rt.backlog = [];
  rt.backlogBytes = 0;
  rt.pendingInput = [];
  rt.pendingInputBytes = 0;
  rt.info.state = 'connecting';
  rt.info.connectedAt = null;
  rt.info.closedAt = null;
  rt.info.lastError = null;
  rt.info.errorCode = null;
  rt.info.errorDetails = null;
  rt.info.hostKeyFingerprint = null;
  rt.info.stats = { bytesIn: 0, bytesOut: 0, connectedAt: null, latencyMs: null };
  publishUpdated(rt);
  broadcastMessage(rt, stateMessage(rt));
  audit('connection', 'info', `重新连接 ${rt.resolved.label}`, {
    hostId: rt.resolved.hostId,
    hostLabel: rt.resolved.label,
    details: { sessionId: id, kind: rt.info.kind }
  });
  void connectSession(rt, rt.connectAttempt);
  return cloneInfo(rt.info);
}

/* ------------------------------------------------------------------ */
/* Terminal WebSocket bridge                                           */
/* ------------------------------------------------------------------ */

export function getTerminalSession(sessionId: string): TerminalSessionHandle | null {
  const rt = sessions.get(sessionId);
  if (!rt || rt.info.kind !== 'terminal') return null;
  return {
    sessionId,
    getInfo: () => cloneInfo(rt.info),
    getBacklog: () => Buffer.concat(rt.backlog),
    write: (data: Buffer) => {
      if (rt.removed) return false;
      if (rt.shell && rt.info.state === 'connected') return writeInput(rt, data);
      if (rt.info.state === 'connecting' || rt.info.state === 'awaiting-auth') {
        queuePendingInput(rt, data);
        return true;
      }
      return false;
    },
    resize: (cols: number, rows: number) => {
      const nextCols = clampInt(cols, 2, 1000, rt.info.cols);
      const nextRows = clampInt(rows, 1, 1000, rt.info.rows);
      rt.info.cols = nextCols;
      rt.info.rows = nextRows;
      if (rt.shell) {
        try {
          rt.shell.setWindow(nextRows, nextCols, 0, 0);
        } catch {
          // ignore
        }
      }
    },
    onOutput: (listener) => {
      rt.outputListeners.add(listener);
      return () => rt.outputListeners.delete(listener);
    },
    onMessage: (listener) => {
      rt.messageListeners.add(listener);
      return () => rt.messageListeners.delete(listener);
    }
  };
}

/** Test/plugin hook: shut every session down without producing events. */
export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  for (const id of ids) {
    try {
      const rt = sessions.get(id);
      if (!rt) continue;
      rt.removed = true;
      rt.closing = true;
      rt.connectAttempt += 1;
      promptBroker.cancelForSession(id);
      teardownTransport(rt);
      finalizeRecording(rt);
      sessions.delete(id);
    } catch {
      // ignore
    }
  }
}
