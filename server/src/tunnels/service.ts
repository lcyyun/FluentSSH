import net from 'node:net';
import type { AddressInfo, Server as NetServer, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ClientChannel, TcpConnectionDetails } from 'ssh2';
import type { TunnelConfig, TunnelInfo, TunnelInput, TunnelStatus } from '../../../shared/types.js';
import { getStore } from '../core/store.js';
import { eventHub } from '../core/events.js';
import { audit } from '../core/audit.js';
import { ApiError, badRequest, conflict, notFound } from '../core/errors.js';
import { getVault } from '../core/vault.js';
import { openConnection, resolveConnection } from '../ssh/connection.js';
import type { OpenConnection } from '../ssh/connection.js';

/**
 * Port-forwarding service.
 *
 * Configs are persisted in `store.data.tunnelConfigs`; live state (SSH client,
 * listening sockets, counters) is in-memory. One ssh2 Client per running tunnel,
 * as per the architecture contract. Errors (host key / auth / bind failures) are
 * published as `tunnel.updated` and surfaced through `TunnelInfo.error`.
 */

const DEFAULT_BIND_HOST = '127.0.0.1';
const COUNTER_PUBLISH_INTERVAL_MS = 1000;

interface TunnelRuntime {
  config: TunnelConfig;
  status: TunnelStatus;
  error: string | null;
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  connections: number;
  bytesIn: number;
  bytesOut: number;
  startedAt: number | null;
  hostName: string;
  /** In-flight start guard. */
  pending: boolean;
  /** True while a teardown triggered by us is running (suppresses connection-loss handlers). */
  closing: boolean;
  connection: OpenConnection | null;
  localServer: NetServer | null;
  localSockets: Set<Socket>;
  remoteForward: { bindHost: string; bindPort: number } | null;
  remoteConnectionListener: ((details: TcpConnectionDetails, accept: () => ClientChannel, reject: () => void) => void) | null;
  statsDirty: boolean;
}

const runtimes = new Map<string, TunnelRuntime>();
let initialized = false;
let statsTimer: NodeJS.Timeout | null = null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function findStoredConfig(id: string): TunnelConfig | undefined {
  return getStore().data.tunnelConfigs.find((config) => config.id === id);
}

function hostNameOf(hostId: string): string {
  const host = getStore().data.hosts.find((item) => item.id === hostId);
  if (!host) return '未知主机';
  return host.name || `${host.username}@${host.hostname}`;
}

function emptyRuntime(config: TunnelConfig): TunnelRuntime {
  return {
    config,
    status: 'stopped',
    error: null,
    errorCode: null,
    errorDetails: null,
    connections: 0,
    bytesIn: 0,
    bytesOut: 0,
    startedAt: null,
    hostName: hostNameOf(config.hostId),
    pending: false,
    closing: false,
    connection: null,
    localServer: null,
    localSockets: new Set(),
    remoteForward: null,
    remoteConnectionListener: null,
    statsDirty: false
  };
}

function toInfo(runtime: TunnelRuntime): TunnelInfo {
  return {
    ...runtime.config,
    hostName: runtime.hostName || hostNameOf(runtime.config.hostId),
    status: runtime.status,
    error: runtime.error,
    errorCode: runtime.errorCode,
    errorDetails: runtime.errorDetails,
    connections: runtime.connections,
    bytesIn: runtime.bytesIn,
    bytesOut: runtime.bytesOut,
    startedAt: runtime.startedAt
  };
}

function publish(runtime: TunnelRuntime) {
  try {
    eventHub.publish({ type: 'tunnel.updated', tunnel: toInfo(runtime) });
  } catch (error) {
    console.error('[tunnels] failed to publish state', error);
  }
}

function ensureStatsTimer() {
  if (statsTimer) return;
  statsTimer = setInterval(() => {
    let dirty = false;
    for (const runtime of runtimes.values()) {
      if (!runtime.statsDirty) continue;
      runtime.statsDirty = false;
      dirty = true;
      publish(runtime);
    }
    if (!dirty) {
      clearInterval(statsTimer as NodeJS.Timeout);
      statsTimer = null;
    }
  }, COUNTER_PUBLISH_INTERVAL_MS);
  statsTimer.unref?.();
}

function markTraffic(runtime: TunnelRuntime) {
  runtime.statsDirty = true;
  ensureStatsTimer();
}

function runtimeOf(id: string): TunnelRuntime {
  ensureTunnelService();
  const runtime = runtimes.get(id);
  if (!runtime) throw notFound('隧道不存在，可能已被删除。');
  return runtime;
}

function requireRuntimeStopped(runtime: TunnelRuntime) {
  if (runtime.pending || runtime.status === 'starting') {
    throw conflict('隧道正在启动中，请稍后再试。');
  }
  if (runtime.status === 'active') {
    throw conflict('隧道正在运行，请先停止后再修改。');
  }
}

function normalizeHost(host: string | undefined, fallback: string): string {
  const value = (host ?? '').trim();
  return value.length > 0 ? value : fallback;
}

function normalizePort(port: number | undefined, fallback: number): number {
  if (port === undefined || port === null || Number.isNaN(port)) return fallback;
  const value = Math.trunc(port);
  if (value < 0 || value > 65535) throw badRequest('端口必须在 0-65535 之间。');
  return value;
}

function normalizeConfig(input: TunnelInput, id: string, existing?: TunnelConfig): TunnelConfig {
  const now = Date.now();
  const name = input.name.trim();
  if (!name) throw badRequest('隧道名称不能为空。');
  const host = getStore().data.hosts.find((item) => item.id === input.hostId);
  if (!host) throw notFound('隧道绑定的主机不存在，可能已被删除。');
  if (input.type !== 'local' && input.type !== 'remote' && input.type !== 'dynamic') {
    throw badRequest('隧道类型必须是 local、remote 或 dynamic。');
  }
  const typeUnchanged = existing?.type === input.type;
  const bindHost = normalizeHost(input.bindHost, existing?.bindHost ?? DEFAULT_BIND_HOST);
  const bindPort = normalizePort(input.bindPort, existing?.bindPort ?? 0);
  // `dynamic` (SOCKS5) tunnels have no target: the client asks the proxy for one
  // per connection. `targetHost`/`targetPort` are ignored and stored empty so the
  // API stays uniform with `TunnelConfig`.
  let targetHost = '';
  let targetPort = 0;
  if (input.type === 'local' || input.type === 'remote') {
    targetHost = normalizeHost(input.targetHost, typeUnchanged ? (existing?.targetHost ?? '') : '');
    targetPort = normalizePort(input.targetPort, typeUnchanged ? (existing?.targetPort ?? 0) : 0);
    if (!targetHost) throw badRequest('本地/远程转发需要填写目标主机。');
    if (targetPort < 1 || targetPort > 65535) throw badRequest('目标端口必须在 1-65535 之间。');
  }
  if (bindHost.length > 255 || targetHost.length > 255) throw badRequest('主机地址过长。');
  return {
    id,
    name,
    hostId: input.hostId,
    type: input.type,
    bindHost,
    bindPort,
    targetHost,
    targetPort,
    autoStart: Boolean(input.autoStart),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function describeError(error: unknown): { message: string; errorCode: string | null; errorDetails: Record<string, unknown> | null } {
  if (error instanceof ApiError) {
    let message = error.message;
    const details = error.details ?? null;
    if (error.code === 'HOST_KEY_UNKNOWN') {
      message = `主机密钥未知，请先信任主机指纹 ${String(details?.fingerprint ?? '')} (${String(details?.hostname ?? '')}:${String(details?.port ?? '')})`;
    } else if (error.code === 'HOST_KEY_MISMATCH') {
      message = `主机密钥不匹配，当前指纹 ${String(details?.fingerprint ?? '')}，已信任 ${String(details?.expectedFingerprint ?? '')}`;
    } else if (error.code === 'VAULT_LOCKED') {
      message = '保险库已锁定，无法读取主机凭据。请解锁后重试。';
    }
    return { message, errorCode: error.code, errorDetails: details };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    errorCode: 'TUNNEL_ERROR',
    errorDetails: null
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function persistConfig(config: TunnelConfig) {
  getStore().mutate((data) => {
    const index = data.tunnelConfigs.findIndex((item) => item.id === config.id);
    if (index >= 0) data.tunnelConfigs[index] = config;
    else data.tunnelConfigs.push(config);
  });
}

function removeConfig(id: string) {
  getStore().mutate((data) => {
    data.tunnelConfigs = data.tunnelConfigs.filter((item) => item.id !== id);
  });
}

/** Persist the actual port picked when `bindPort` was 0. */
function rememberBoundPort(runtime: TunnelRuntime, port: number) {
  if (!port || port === runtime.config.bindPort) return;
  const updated: TunnelConfig = { ...runtime.config, bindPort: port, updatedAt: Date.now() };
  runtime.config = updated;
  persistConfig(updated);
}

/* ------------------------------------------------------------------ */
/* Forwarding helpers                                                  */
/* ------------------------------------------------------------------ */

function countSocket(runtime: TunnelRuntime, socket: Socket) {
  runtime.localSockets.add(socket);
  runtime.connections += 1;
  runtime.statsDirty = true;
}

function releaseSocket(runtime: TunnelRuntime, socket: Socket) {
  if (runtime.localSockets.delete(socket)) {
    runtime.connections = Math.max(0, runtime.connections - 1);
    runtime.statsDirty = true;
  }
}

interface ForwardHooks {
  onFailure: (error: Error) => void;
  onSuccess?: () => void;
  /** Bytes already read from the socket before the channel was ready. */
  initialData?: Buffer;
}

function forwardThroughConnection(
  runtime: TunnelRuntime,
  socket: Socket,
  destHost: string,
  destPort: number,
  hooks: ForwardHooks
) {
  const connection = runtime.connection;
  if (!connection || connection.closed) {
    hooks.onFailure(new Error('SSH 连接已关闭'));
    return;
  }
  connection.client.forwardOut(
    socket.remoteAddress ?? '127.0.0.1',
    socket.remotePort ?? 0,
    destHost,
    destPort,
    (error, channel) => {
      if (error) {
        hooks.onFailure(error);
        return;
      }
      countSocket(runtime, socket);
      channel.on('data', (chunk: Buffer) => {
        runtime.bytesIn += chunk.length;
        markTraffic(runtime);
      });
      socket.on('data', (chunk: Buffer) => {
        runtime.bytesOut += chunk.length;
        markTraffic(runtime);
      });
      hooks.onSuccess?.();
      if (hooks.initialData && hooks.initialData.length > 0) channel.write(hooks.initialData);
      socket.pipe(channel).pipe(socket);
      const teardown = () => {
        releaseSocket(runtime, socket);
        socket.destroy();
        try {
          channel.destroy();
        } catch {
          // ignore
        }
      };
      socket.on('close', teardown);
      socket.on('error', teardown);
      channel.on('close', teardown);
      channel.on('error', teardown);
    }
  );
}

/* ------------------------------------------------------------------ */
/* Local forwarding                                                    */
/* ------------------------------------------------------------------ */

async function bindLocalTunnel(runtime: TunnelRuntime): Promise<void> {
  const { bindHost, bindPort, targetHost, targetPort } = runtime.config;
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => socket.destroy());
      forwardThroughConnection(runtime, socket, targetHost, targetPort, {
        onFailure: (error) => {
          audit('tunnel', 'warn', `隧道 ${runtime.config.name} 转发连接失败：${error.message}`, {
            hostId: runtime.config.hostId,
            hostLabel: runtime.hostName,
            details: { target: `${targetHost}:${targetPort}` }
          });
          socket.destroy();
        }
      });
    });
    runtime.localServer = server;
    server.once('error', reject);
    server.listen(bindPort, bindHost, () => {
      server.off('error', reject);
      server.on('error', (error) => {
        runtime.error = `本地监听失败：${error.message}`;
        runtime.errorCode = 'TUNNEL_ERROR';
        runtime.status = 'error';
        publish(runtime);
      });
      const address = server.address() as AddressInfo | null;
      rememberBoundPort(runtime, address?.port ?? bindPort);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Dynamic (SOCKS5) forwarding                                         */
/* ------------------------------------------------------------------ */

const SOCKS_VERSION = 0x05;
const SOCKS_CMD_CONNECT = 0x01;
const SOCKS_ATYP_IPV4 = 0x01;
const SOCKS_ATYP_DOMAIN = 0x03;
const SOCKS_ATYP_IPV6 = 0x04;

function socksReply(code: number, socket: Socket) {
  const reply = Buffer.from([SOCKS_VERSION, code, 0x00, SOCKS_ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
  try {
    socket.write(reply);
  } catch {
    // ignore
  }
}

function ipv6ToString(buffer: Buffer): string {
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) groups.push(buffer.readUInt16BE(index).toString(16));
  return groups.join(':');
}

function handleSocksClient(runtime: TunnelRuntime, socket: Socket) {
  let buffer = Buffer.alloc(0);
  let phase: 'greeting' | 'request' | 'connected' = 'greeting';
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (phase === 'greeting') {
      if (buffer.length < 2) return;
      const version = buffer[0];
      const methodCount = buffer[1];
      if (version !== SOCKS_VERSION) {
        socket.destroy();
        return;
      }
      if (buffer.length < 2 + methodCount) return;
      // Only "no authentication" is offered.
      socket.write(Buffer.from([SOCKS_VERSION, 0x00]));
      buffer = buffer.subarray(2 + methodCount);
      phase = 'request';
    }
    if (phase === 'request') {
      if (buffer.length < 4) return;
      const version = buffer[0];
      const command = buffer[1];
      const addressType = buffer[3];
      if (version !== SOCKS_VERSION) {
        socket.destroy();
        return;
      }
      if (command !== SOCKS_CMD_CONNECT) {
        socksReply(0x07, socket);
        socket.end();
        return;
      }
      let offset = 4;
      let destHost = '';
      if (addressType === SOCKS_ATYP_IPV4) {
        if (buffer.length < offset + 4 + 2) return;
        destHost = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
        offset += 4;
      } else if (addressType === SOCKS_ATYP_DOMAIN) {
        if (buffer.length < offset + 1) return;
        const length = buffer[offset];
        if (buffer.length < offset + 1 + length + 2) return;
        destHost = buffer.subarray(offset + 1, offset + 1 + length).toString('utf8');
        offset += 1 + length;
      } else if (addressType === SOCKS_ATYP_IPV6) {
        if (buffer.length < offset + 16 + 2) return;
        destHost = ipv6ToString(buffer.subarray(offset, offset + 16));
        offset += 16;
      } else {
        socksReply(0x08, socket);
        socket.end();
        return;
      }
      const destPort = buffer.readUInt16BE(offset);
      offset += 2;
      const leftover = buffer.subarray(offset);
      buffer = Buffer.alloc(0);
      phase = 'connected';
      socket.off('data', onData);
      forwardThroughConnection(runtime, socket, destHost, destPort, {
        initialData: leftover,
        onSuccess: () => socksReply(0x00, socket),
        onFailure: (error) => {
          audit('tunnel', 'warn', `隧道 ${runtime.config.name} SOCKS5 连接失败：${error.message}`, {
            hostId: runtime.config.hostId,
            hostLabel: runtime.hostName,
            details: { target: `${destHost}:${destPort}` }
          });
          socksReply(0x05, socket);
          socket.end();
        }
      });
    }
  };
  socket.on('data', onData);
  socket.on('error', () => socket.destroy());
}

async function bindDynamicTunnel(runtime: TunnelRuntime): Promise<void> {
  const { bindHost, bindPort } = runtime.config;
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => socket.destroy());
      handleSocksClient(runtime, socket);
    });
    runtime.localServer = server;
    server.once('error', reject);
    server.listen(bindPort, bindHost, () => {
      server.off('error', reject);
      server.on('error', (error) => {
        runtime.error = `本地监听失败：${error.message}`;
        runtime.errorCode = 'TUNNEL_ERROR';
        runtime.status = 'error';
        publish(runtime);
      });
      const address = server.address() as AddressInfo | null;
      rememberBoundPort(runtime, address?.port ?? bindPort);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Remote forwarding                                                   */
/* ------------------------------------------------------------------ */

async function bindRemoteTunnel(runtime: TunnelRuntime): Promise<void> {
  const connection = runtime.connection;
  if (!connection) throw new Error('SSH 连接已关闭');
  const { bindHost, bindPort, targetHost, targetPort } = runtime.config;

  const onTcpConnection = (_details: TcpConnectionDetails, accept: () => ClientChannel, reject: () => void) => {
    let channel: ClientChannel;
    try {
      channel = accept();
    } catch {
      return;
    }
    const target = net.connect({ host: targetHost, port: targetPort });
    target.once('connect', () => {
      countSocket(runtime, target);
      channel.on('data', (chunk: Buffer) => {
        runtime.bytesIn += chunk.length;
        markTraffic(runtime);
      });
      target.on('data', (chunk: Buffer) => {
        runtime.bytesOut += chunk.length;
        markTraffic(runtime);
      });
      target.pipe(channel).pipe(target);
      const teardown = () => {
        releaseSocket(runtime, target);
        target.destroy();
        try {
          channel.destroy();
        } catch {
          // ignore
        }
      };
      target.on('close', teardown);
      target.on('error', teardown);
      channel.on('close', teardown);
      channel.on('error', teardown);
    });
    target.once('error', (error) => {
      audit('tunnel', 'warn', `隧道 ${runtime.config.name} 远端连接本地目标失败：${error.message}`, {
        hostId: runtime.config.hostId,
        hostLabel: runtime.hostName,
        details: { target: `${targetHost}:${targetPort}` }
      });
      try {
        channel.destroy();
      } catch {
        // ignore
      }
      reject();
    });
  };

  runtime.remoteConnectionListener = onTcpConnection;
  connection.client.on('tcp connection', onTcpConnection);

  await new Promise<void>((resolve, reject) => {
    connection.client.forwardIn(bindHost, bindPort, (error, assignedPort) => {
      if (error) {
        reject(error);
        return;
      }
      const actualPort = Number(assignedPort) > 0 ? Number(assignedPort) : bindPort;
      runtime.remoteForward = { bindHost, bindPort: actualPort };
      rememberBoundPort(runtime, actualPort);
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Teardown                                                            */
/* ------------------------------------------------------------------ */

async function teardownRuntime(runtime: TunnelRuntime): Promise<void> {
  runtime.closing = true;
  try {
    if (runtime.localServer) {
      const server = runtime.localServer;
      runtime.localServer = null;
      for (const socket of runtime.localSockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      runtime.localSockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Keep-alive sockets were destroyed above; never hang on close.
        setTimeout(resolve, 300).unref?.();
      });
    }
    runtime.connections = 0;
    if (runtime.connection) {
      const connection = runtime.connection;
      runtime.connection = null;
      if (runtime.remoteForward) {
        const forward = runtime.remoteForward;
        runtime.remoteForward = null;
        if (runtime.remoteConnectionListener) {
          connection.client.off('tcp connection', runtime.remoteConnectionListener);
          runtime.remoteConnectionListener = null;
        }
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          try {
            connection.client.unforwardIn(forward.bindHost, forward.bindPort, done);
          } catch {
            done();
          }
          setTimeout(done, 500).unref?.();
        });
      }
      if (runtime.remoteConnectionListener) {
        connection.client.off('tcp connection', runtime.remoteConnectionListener);
        runtime.remoteConnectionListener = null;
      }
      connection.close();
    } else if (runtime.remoteConnectionListener) {
      runtime.remoteConnectionListener = null;
    }
  } finally {
    runtime.closing = false;
  }
}

function handleConnectionLoss(runtime: TunnelRuntime, reason: string) {
  if (runtime.closing) return;
  void (async () => {
    await teardownRuntime(runtime);
    if (runtime.status === 'stopped') return;
    runtime.status = 'error';
    runtime.error = `SSH 连接已断开：${reason}`;
    runtime.errorCode = 'CONNECTION_FAILED';
    runtime.startedAt = null;
    publish(runtime);
    audit('tunnel', 'error', `隧道 ${runtime.config.name} 连接中断`, {
      hostId: runtime.config.hostId,
      hostLabel: runtime.hostName,
      details: { reason }
    });
  })();
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Load persisted configs into memory and start autoStart tunnels. Idempotent. */
export function initTunnels(): void {
  ensureTunnelService();
}

export function ensureTunnelService(): void {
  if (initialized) return;
  initialized = true;
  for (const config of getStore().data.tunnelConfigs) {
    runtimes.set(config.id, emptyRuntime({ ...config }));
  }
  scheduleAutoStart();
}

function scheduleAutoStart() {
  const candidates = [...runtimes.values()].filter((runtime) => runtime.config.autoStart);
  if (candidates.length === 0) return;
  setTimeout(() => {
    void (async () => {
      if (!getVault().isUnlocked()) {
        audit('tunnel', 'info', '保险库已锁定，跳过自动启动隧道。', { details: { count: candidates.length } });
        return;
      }
      for (const runtime of candidates) {
        try {
          await startTunnel(runtime.config.id);
        } catch (error) {
          const described = describeError(error);
          audit('tunnel', 'warn', `自动启动隧道 ${runtime.config.name} 失败：${described.message}`, {
            hostId: runtime.config.hostId,
            hostLabel: runtime.hostName,
            details: described.errorDetails ?? undefined
          });
        }
      }
    })();
  }, 50).unref?.();
}

export function listTunnelInfos(): TunnelInfo[] {
  ensureTunnelService();
  // Keep the in-memory map in sync with the persisted configs.
  for (const config of getStore().data.tunnelConfigs) {
    if (!runtimes.has(config.id)) runtimes.set(config.id, emptyRuntime({ ...config }));
  }
  for (const id of [...runtimes.keys()]) {
    if (!findStoredConfig(id)) runtimes.delete(id);
  }
  return [...runtimes.values()].map(toInfo);
}

export function createTunnel(input: TunnelInput): TunnelInfo {
  ensureTunnelService();
  const config = normalizeConfig(input, randomUUID());
  persistConfig(config);
  const runtime = emptyRuntime(config);
  runtimes.set(config.id, runtime);
  audit('tunnel', 'info', `已创建隧道：${config.name}`, {
    hostId: config.hostId,
    hostLabel: runtime.hostName,
    details: { type: config.type, bindHost: config.bindHost, bindPort: config.bindPort }
  });
  return toInfo(runtime);
}

export function updateTunnel(id: string, patch: Partial<TunnelInput>): TunnelInfo {
  const runtime = runtimeOf(id);
  requireRuntimeStopped(runtime);
  if (patch.hostId) {
    const host = getStore().data.hosts.find((item) => item.id === patch.hostId);
    if (!host) throw notFound('隧道绑定的主机不存在，可能已被删除。');
  }
  const merged: TunnelInput = {
    name: patch.name ?? runtime.config.name,
    hostId: patch.hostId ?? runtime.config.hostId,
    type: patch.type ?? runtime.config.type,
    bindHost: patch.bindHost ?? runtime.config.bindHost,
    bindPort: patch.bindPort ?? runtime.config.bindPort,
    targetHost: patch.targetHost ?? runtime.config.targetHost,
    targetPort: patch.targetPort ?? runtime.config.targetPort,
    autoStart: patch.autoStart ?? runtime.config.autoStart
  };
  const config = normalizeConfig(merged, id, runtime.config);
  runtime.config = config;
  runtime.hostName = hostNameOf(config.hostId);
  persistConfig(config);
  publish(runtime);
  audit('tunnel', 'info', `已更新隧道：${config.name}`, {
    hostId: config.hostId,
    hostLabel: runtime.hostName,
    details: { type: config.type, bindHost: config.bindHost, bindPort: config.bindPort }
  });
  return toInfo(runtime);
}

export async function deleteTunnel(id: string, options: { stop?: boolean } = {}): Promise<void> {
  const runtime = runtimeOf(id);
  if (runtime.status === 'active' || runtime.status === 'starting' || runtime.pending) {
    if (!options.stop) throw conflict('隧道正在运行，请先停止隧道或使用 stop=1 删除。');
    await stopTunnel(id);
  }
  removeConfig(id);
  runtimes.delete(id);
  audit('tunnel', 'info', `已删除隧道：${runtime.config.name}`, {
    hostId: runtime.config.hostId,
    hostLabel: runtime.hostName
  });
}

export async function startTunnel(id: string): Promise<TunnelInfo> {
  const runtime = runtimeOf(id);
  if (runtime.status === 'active' && runtime.connection && !runtime.connection.closed) return toInfo(runtime);
  if (runtime.pending) throw conflict('隧道正在启动中，请稍后再试。');
  runtime.pending = true;
  runtime.status = 'starting';
  runtime.error = null;
  runtime.errorCode = null;
  runtime.errorDetails = null;
  publish(runtime);

  try {
    if (!getStore().data.hosts.some((host) => host.id === runtime.config.hostId)) {
      throw notFound('隧道绑定的主机不存在，可能已被删除。');
    }
    const resolved = resolveConnection({ hostId: runtime.config.hostId });
    runtime.hostName = resolved.label;
    const connection = await openConnection(resolved, { kind: 'tunnel', tunnelId: id });
    runtime.connection = connection;
    connection.client.on('close', () => handleConnectionLoss(runtime, '连接已关闭'));
    connection.client.on('error', (error: Error) => handleConnectionLoss(runtime, error.message));

    if (runtime.config.type === 'local') await bindLocalTunnel(runtime);
    else if (runtime.config.type === 'remote') await bindRemoteTunnel(runtime);
    else await bindDynamicTunnel(runtime);

    runtime.status = 'active';
    runtime.startedAt = Date.now();
    runtime.connections = 0;
    runtime.bytesIn = 0;
    runtime.bytesOut = 0;
    publish(runtime);
    audit('tunnel', 'info', `隧道已启动：${runtime.config.name}`, {
      hostId: runtime.config.hostId,
      hostLabel: runtime.hostName,
      details: {
        type: runtime.config.type,
        bindHost: runtime.config.bindHost,
        bindPort: runtime.config.bindPort,
        targetHost: runtime.config.targetHost,
        targetPort: runtime.config.targetPort
      }
    });
    return toInfo(runtime);
  } catch (error) {
    const described = describeError(error);
    await teardownRuntime(runtime);
    runtime.status = 'error';
    runtime.error = described.message;
    runtime.errorCode = described.errorCode;
    runtime.errorDetails = described.errorDetails;
    runtime.startedAt = null;
    runtime.connections = 0;
    publish(runtime);
    audit('tunnel', 'error', `隧道启动失败：${runtime.config.name} — ${described.message}`, {
      hostId: runtime.config.hostId,
      hostLabel: runtime.hostName,
      details: described.errorDetails ?? undefined
    });
    throw error;
  } finally {
    runtime.pending = false;
  }
}

export async function stopTunnel(id: string): Promise<TunnelInfo> {
  const runtime = runtimeOf(id);
  if (runtime.pending) throw conflict('隧道正在启动中，请稍后再试。');
  await teardownRuntime(runtime);
  runtime.status = 'stopped';
  runtime.error = null;
  runtime.errorCode = null;
  runtime.errorDetails = null;
  runtime.startedAt = null;
  runtime.connections = 0;
  publish(runtime);
  audit('tunnel', 'info', `隧道已停止：${runtime.config.name}`, {
    hostId: runtime.config.hostId,
    hostLabel: runtime.hostName
  });
  return toInfo(runtime);
}

/** Stop every live tunnel (used by tests / graceful shutdown helpers). */
export async function stopAllTunnels(): Promise<void> {
  for (const runtime of [...runtimes.values()]) {
    if (runtime.status === 'active' || runtime.status === 'error' || runtime.connection || runtime.localServer) {
      try {
        await teardownRuntime(runtime);
        runtime.status = 'stopped';
        runtime.startedAt = null;
      } catch {
        // ignore
      }
    }
  }
}
