import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import ssh2 from 'ssh2';
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import type { AuthType, HostTerminalPrefs, InlineConnection, KnownHost } from '../../../shared/types.js';
import { getStore } from '../core/store.js';
import type { StoredHost } from '../core/store-types.js';
import { getVault } from '../core/vault.js';
import { promptBroker } from '../core/prompts.js';
import { ApiError } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { getSettings } from './settings-access.js';

const { Client } = ssh2;

export type ConnectionOperation =
  | { kind: 'session'; sessionId: string | null }
  | { kind: 'exec' }
  | { kind: 'tunnel'; tunnelId?: string };

export interface ResolvedConnection {
  hostId: string | null;
  label: string;
  hostname: string;
  port: number;
  username: string;
  authType: AuthType;
  password: string | null;
  passphrase: string | null;
  privateKey: string | null;
  proxyJumpId: string | null;
  keepaliveInterval: number;
  connectTimeout: number;
  compression: boolean;
  legacyAlgorithms: boolean;
  terminal: HostTerminalPrefs;
  startupCommand: string;
  env: Record<string, string>;
  defaultPath: string;
}

export interface OpenConnection {
  client: ssh2.Client;
  hostLabel: string;
  hostId: string | null;
  hostname: string;
  port: number;
  username: string;
  fingerprint: string;
  hostKeyType: string;
  connectedAt: number;
  /** Close this connection and any jump-host chain behind it. */
  close: () => void;
  /** True once the caller has closed the connection intentionally. */
  closed: boolean;
}

export interface HostKeyDetails {
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  expectedFingerprint?: string;
  knownHostId?: string;
}

interface PendingHostKey {
  details: HostKeyDetails;
  unknown: boolean;
  mismatch: boolean;
}

/* ------------------------------------------------------------------ */
/* Host key helpers                                                    */
/* ------------------------------------------------------------------ */

function readSshString(buffer: Buffer, offset: number): { value: string; next: number } {
  if (offset + 4 > buffer.length) return { value: '', next: buffer.length };
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  return { value: buffer.subarray(start, end).toString('ascii'), next: end };
}

export function fingerprintOfHostKey(rawKey: Buffer): { fingerprint: string; keyType: string } {
  const keyType = readSshString(rawKey, 0).value || 'unknown';
  const digest = crypto.createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
  return { fingerprint: `SHA256:${digest}`, keyType };
}

/* ------------------------------------------------------------------ */
/* Recent host key material (ssh-core adjunct, additive)               */
/*                                                                     */
/* KnownHost only persists fingerprint + keyType, but known_hosts      */
/* export needs the raw RFC4253 public key blob. We remember the last  */
/* observed blobs in a small in-memory FIFO so the trust flow can      */
/* persist/export a real known_hosts line. Never stores private data.  */
/* ------------------------------------------------------------------ */

const RECENT_HOST_KEYS_LIMIT = 200;
const recentHostKeys = new Map<string, string>();

function rememberHostKey(hostname: string, port: number, fingerprint: string, rawKey: Buffer) {
  const cacheKey = `${hostname}:${port}:${fingerprint}`;
  recentHostKeys.delete(cacheKey);
  recentHostKeys.set(cacheKey, rawKey.toString('base64'));
  while (recentHostKeys.size > RECENT_HOST_KEYS_LIMIT) {
    const oldest = recentHostKeys.keys().next().value;
    if (oldest === undefined) break;
    recentHostKeys.delete(oldest);
  }
}

/**
 * Base64 RFC4253 host key blob recently observed during a handshake, used by
 * the known-hosts service to persist/export real known_hosts entries.
 */
export function getRememberedHostKey(hostname: string, port: number, fingerprint: string): string | null {
  return recentHostKeys.get(`${hostname}:${port}:${fingerprint}`) ?? null;
}

export function findKnownHost(hostname: string, port: number, fingerprint: string): KnownHost | null {
  const store = getStore();
  const matches = store.data.knownHosts.filter((entry) => entry.hostname === hostname && entry.port === port);
  return matches.find((entry) => entry.fingerprint === fingerprint) ?? null;
}

export function getHostKeyDecision(hostname: string, port: number, fingerprint: string): HostKeyDetails {
  const store = getStore();
  const entries = store.data.knownHosts.filter((entry) => entry.hostname === hostname && entry.port === port);
  const matching = entries.find((entry) => entry.fingerprint === fingerprint);
  if (matching) {
    matching.lastSeenAt = Date.now();
    store.flush();
    return {
      hostname,
      port,
      keyType: matching.keyType,
      fingerprint,
      expectedFingerprint: matching.fingerprint,
      knownHostId: matching.id
    };
  }
  return {
    hostname,
    port,
    keyType: '',
    fingerprint,
    expectedFingerprint: entries[0]?.fingerprint,
    knownHostId: entries[0]?.id
  };
}

/* ------------------------------------------------------------------ */
/* Host resolution                                                     */
/* ------------------------------------------------------------------ */

export function getStoredHost(hostId: string): StoredHost {
  const host = getStore().data.hosts.find((item) => item.id === hostId);
  if (!host) throw new ApiError(404, 'NOT_FOUND', '保存的主机不存在，可能已被删除。');
  return host;
}

function decryptSecret(box: { iv: string; tag: string; data: string; v: 1 } | undefined): string | null {
  if (!box) return null;
  return getVault().decrypt(box);
}

export function resolveConnection(input: { hostId?: string | null; inline?: InlineConnection | null }): ResolvedConnection {
  const settings = getSettings();
  if (input.hostId) {
    const host = getStoredHost(input.hostId);
    const needsPassword = host.authType === 'password';
    const needsPassphrase = host.authType === 'key';
    if (!getVault().isUnlocked() && ((needsPassword && host.secrets.password) || (needsPassphrase && host.secrets.passphrase))) {
      // Secret material exists but the vault is locked.
      getVault().requireKey();
    }
    return {
      hostId: host.id,
      label: host.name || `${host.username}@${host.hostname}`,
      hostname: host.hostname,
      port: host.port,
      username: host.username,
      authType: host.authType,
      password: decryptSecret(host.secrets.password),
      passphrase: decryptSecret(host.secrets.passphrase),
      privateKey: null,
      proxyJumpId: host.proxyJumpId,
      keepaliveInterval: host.keepaliveInterval || settings.connections.keepaliveInterval,
      connectTimeout: host.connectTimeout || settings.connections.connectTimeout,
      compression: host.compression,
      legacyAlgorithms: host.legacyAlgorithms,
      terminal: host.terminal ?? {},
      startupCommand: host.startupCommand ?? '',
      env: host.env ?? {},
      defaultPath: host.defaultPath ?? ''
    };
  }

  if (!input.inline) throw new ApiError(400, 'VALIDATION', '需要提供 hostId 或 inline 连接信息。');
  const inline = input.inline;
  const authType = inline.authType ?? (inline.password ? 'password' : inline.keyId ? 'key' : 'agent');
  return {
    hostId: null,
    label: inline.name || `${inline.username}@${inline.hostname}`,
    hostname: inline.hostname,
    port: inline.port ?? settings.connections.defaultPort,
    username: inline.username || settings.connections.defaultUsername,
    authType,
    password: inline.password ?? null,
    passphrase: inline.passphrase ?? null,
    privateKey: null,
    proxyJumpId: inline.proxyJumpId ?? null,
    keepaliveInterval: inline.keepaliveInterval ?? settings.connections.keepaliveInterval,
    connectTimeout: inline.connectTimeout ?? settings.connections.connectTimeout,
    compression: false,
    legacyAlgorithms: false,
    terminal: {},
    startupCommand: '',
    env: {},
    defaultPath: ''
  };
}

/** Load the private key material for a host/key pair. */
export function resolvePrivateKey(resolved: ResolvedConnection, keyId: string | null): {
  privateKey: string | null;
  passphrase: string | null;
} {
  if (resolved.privateKey) return { privateKey: resolved.privateKey, passphrase: resolved.passphrase };
  if (resolved.hostId) {
    const host = getStoredHost(resolved.hostId);
    if (host.authType === 'key' && host.keyId) {
      const key = getStore().data.keys.find((item) => item.id === host.keyId);
      if (!key) throw new ApiError(400, 'VALIDATION', '主机引用的密钥不存在。');
      return {
        privateKey: getVault().decrypt(key.secrets.privateKey),
        passphrase: getVault().decrypt(key.secrets.passphrase) ?? resolved.passphrase
      };
    }
  }
  if (keyId) {
    const key = getStore().data.keys.find((item) => item.id === keyId);
    if (!key) throw new ApiError(400, 'VALIDATION', '密钥不存在。');
    return {
      privateKey: getVault().decrypt(key.secrets.privateKey),
      passphrase: getVault().decrypt(key.secrets.passphrase) ?? resolved.passphrase
    };
  }
  return { privateKey: null, passphrase: resolved.passphrase };
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

function baseConnectConfig(resolved: ResolvedConnection): ConnectConfig {
  const config: ConnectConfig = {
    host: resolved.hostname,
    port: resolved.port,
    username: resolved.username,
    readyTimeout: resolved.connectTimeout,
    keepaliveInterval: resolved.keepaliveInterval,
    keepaliveCountMax: 3
  };
  if (resolved.legacyAlgorithms) {
    config.algorithms = {
      kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1',
        'diffie-hellman-group1-sha1'
      ],
      cipher: [
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
        'aes128-cbc',
        'aes192-cbc',
        'aes256-cbc',
        '3des-cbc'
      ],
      hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'],
      serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']
    };
  }
  return config;
}

function connectClient(
  config: ConnectConfig,
  onKeyboard: (
    name: string,
    instructions: string,
    prompts: { prompt: string; echo?: boolean }[],
    finish: (responses: string[]) => void,
    fail: () => void
  ) => void
): Promise<ssh2.Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    client.once('ready', () => {
      settled = true;
      resolve(client);
    });
    // Keep a persistent listener: errors after `ready` are handled by session
    // owners, but must never become uncaught exceptions in the server process.
    client.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
      onKeyboard(
        name,
        instructions,
        prompts,
        finish,
        () => {
          if (!settled) {
            settled = true;
            reject(new Error('Keyboard-interactive authentication was cancelled'));
          }
        }
      );
    });
    try {
      client.connect(config);
    } catch (error) {
      reject(error);
    }
  });
}

async function connectThroughJumpHost(
  resolved: ResolvedConnection,
  operation: ConnectionOperation,
  depth = 0
): Promise<{ chain: OpenConnection[] }> {
  if (!resolved.proxyJumpId) return { chain: [] };
  if (depth > 3) throw new ApiError(400, 'VALIDATION', '跳板机链路过深（最多 4 层）。');
  const jumpStored = getStoredHost(resolved.proxyJumpId);
  const jumpResolved = resolveConnection({ hostId: jumpStored.id });
  const jumpConnection = await openConnectionInternal(jumpResolved, operation, depth + 1);
  return { chain: [jumpConnection] };
}

async function openConnectionInternal(
  resolved: ResolvedConnection,
  operation: ConnectionOperation,
  depth = 0
): Promise<OpenConnection & { chain: OpenConnection[] }> {
  const settings = getSettings();
  const pending: PendingHostKey = {
    unknown: false,
    mismatch: false,
    details: { hostname: resolved.hostname, port: resolved.port, keyType: '', fingerprint: '' }
  };

  let sock: Readable | undefined;
  const jump = await connectThroughJumpHost(resolved, operation, depth);
  const chain = jump.chain;
  if (chain.length > 0) {
    const jumpClient = chain[0].client;
    sock = await new Promise<Readable>((resolve, reject) => {
      jumpClient.forwardOut(
        '127.0.0.1',
        0,
        resolved.hostname,
        resolved.port,
        (error, stream) => {
          if (error) reject(error);
          else resolve(stream);
        }
      );
    });
  }

  const config = baseConnectConfig(resolved);
  if (sock) config.sock = sock;

  config.hostVerifier = (rawKey: Buffer) => {
    const { fingerprint, keyType } = fingerprintOfHostKey(rawKey);
    // ssh-core adjunct: retain the public blob so the trust flow can persist
    // and export a valid known_hosts line (additive, behavior-neutral).
    rememberHostKey(resolved.hostname, resolved.port, fingerprint, rawKey);
    const entries = getStore().data.knownHosts.filter(
      (entry) => entry.hostname === resolved.hostname && entry.port === resolved.port
    );
    const matching = entries.find((entry) => entry.fingerprint === fingerprint);
    if (matching) {
      matching.lastSeenAt = Date.now();
      getStore().flush();
      pending.details = {
        hostname: resolved.hostname,
        port: resolved.port,
        keyType: matching.keyType || keyType,
        fingerprint,
        knownHostId: matching.id
      };
      return true;
    }
    if (entries.length > 0) {
      pending.mismatch = true;
      pending.details = {
        hostname: resolved.hostname,
        port: resolved.port,
        keyType,
        fingerprint,
        expectedFingerprint: entries[0].fingerprint,
        knownHostId: entries[0].id
      };
      return false;
    }
    if (!settings.security.strictHostKeys) {
      // Permissive mode remembers the key after the fact.
      const now = Date.now();
      const known: KnownHost = {
        id: crypto.randomUUID(),
        hostname: resolved.hostname,
        port: resolved.port,
        keyType,
        fingerprint,
        addedAt: now,
        lastSeenAt: now,
        source: 'trusted'
      };
      getStore().mutate((data) => {
        data.knownHosts.push(known);
      });
      audit('security', 'warn', `宽松模式自动信任主机密钥 ${resolved.hostname}:${resolved.port}`, {
        hostId: resolved.hostId,
        hostLabel: resolved.label,
        details: { fingerprint, keyType }
      });
      pending.details = {
        hostname: resolved.hostname,
        port: resolved.port,
        keyType,
        fingerprint,
        knownHostId: known.id
      };
      return true;
    }
    pending.unknown = true;
    pending.details = {
      hostname: resolved.hostname,
      port: resolved.port,
      keyType,
      fingerprint
    };
    return false;
  };

  const keyMaterial = resolvePrivateKey(resolved, resolved.hostId ? getStoredHost(resolved.hostId).keyId : null);
  const agentPath = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined);

  if (resolved.authType === 'password') {
    if (!resolved.password) {
      throw new ApiError(401, 'AUTH_FAILED', '该主机未保存密码。请编辑主机填写密码，或改用密钥认证。', {
        authType: resolved.authType
      });
    }
    config.password = resolved.password;
  } else if (resolved.authType === 'key') {
    if (!keyMaterial.privateKey) {
      throw new ApiError(401, 'AUTH_FAILED', '该主机未选择私钥。请编辑主机选择密钥，或改用其他认证方式。', {
        authType: resolved.authType
      });
    }
    config.privateKey = keyMaterial.privateKey;
    if (keyMaterial.passphrase) config.passphrase = keyMaterial.passphrase;
  } else if (resolved.authType === 'agent') {
    if (!agentPath) {
      throw new ApiError(401, 'AUTH_FAILED', '未检测到可用的 SSH Agent（Pageant 或 SSH_AUTH_SOCK）。', {
        authType: resolved.authType
      });
    }
    config.agent = agentPath;
  } else if (!resolved.password) {
    // keyboard-interactive hosts can legitimately have no stored password.
    config.tryKeyboard = true;
  }

  config.tryKeyboard = true;

  try {
    const client = await connectClient(config, (name, instructions, prompts, finish, fail) => {
      // A single hidden prompt with a saved password is almost always a
      // password-over-keyboard-interactive server: answer it silently.
      if (prompts.length === 1 && prompts[0] && !prompts[0].echo && resolved.password) {
        finish([resolved.password]);
        return;
      }
      promptBroker
        .request({
          operation: operation.kind,
          sessionId: operation.kind === 'session' ? operation.sessionId : null,
          hostLabel: resolved.label,
          name: name || 'keyboard-interactive',
          instructions: instructions || `${resolved.username}@${resolved.hostname} 请求验证信息`,
          prompts: prompts.map((prompt) => ({ prompt: prompt.prompt, echo: prompt.echo === true })),
          timeoutMs: 120_000
        })
        .wait.then((responses) => {
          if (!responses) return fail();
          finish(responses);
        })
        .catch(() => fail());
    });
    const info = pending.details;
    return {
      client,
      hostLabel: resolved.label,
      hostId: resolved.hostId,
      hostname: resolved.hostname,
      port: resolved.port,
      username: resolved.username,
      fingerprint: info.fingerprint,
      hostKeyType: info.keyType,
      connectedAt: Date.now(),
      chain,
      closed: false,
      close: () => {
        try {
          client.end();
        } catch {
          // ignore
        }
        for (const entry of chain) entry.close();
      }
    };
  } catch (error) {
    for (const entry of chain) entry.close();
    if (pending.mismatch) {
      throw new ApiError(409, 'HOST_KEY_MISMATCH', `主机密钥与已信任的密钥不一致 (${resolved.hostname}:${resolved.port})`, {
        ...pending.details
      });
    }
    if (pending.unknown) {
      throw new ApiError(409, 'HOST_KEY_UNKNOWN', `首次连接 ${resolved.hostname}:${resolved.port}，需要确认主机密钥。`, {
        ...pending.details
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/authentication/i.test(message)) {
      throw new ApiError(401, 'AUTH_FAILED', `认证失败：${message}`, {
        // Include a couple of fields for the UI without leaking secrets.
        authType: resolved.authType,
        hostname: resolved.hostname,
        port: resolved.port,
        username: resolved.username
      });
    }
    if (/timed? ?out|timeout/i.test(message)) {
      throw new ApiError(504, 'CONNECTION_FAILED', `连接超时：${resolved.hostname}:${resolved.port}`, { hostname: resolved.hostname, port: resolved.port });
    }
    throw new ApiError(502, 'CONNECTION_FAILED', `无法连接到 ${resolved.hostname}:${resolved.port} — ${message}`, {
      hostname: resolved.hostname,
      port: resolved.port
    });
  }
}

export async function openConnection(
  resolved: ResolvedConnection,
  operation: ConnectionOperation
): Promise<OpenConnection> {
  const opened = await openConnectionInternal(resolved, operation);
  const { chain: _chain, ...rest } = opened;
  const connection: OpenConnection = rest;
  const originalClose = connection.close;
  connection.close = () => {
    if (connection.closed) return;
    connection.closed = true;
    originalClose();
  };
  return connection;
}

export async function openHostConnection(hostId: string, operation: ConnectionOperation): Promise<OpenConnection> {
  return openConnection(resolveConnection({ hostId }), operation);
}

export async function openSftp(connection: OpenConnection): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    connection.client.sftp((error, sftp) => {
      if (error) reject(error);
      else resolve(sftp);
    });
  });
}

/** Helper for services opening a shell/exec channel. */
export function openShell(
  connection: OpenConnection,
  options: { cols: number; rows: number; term: string; env?: Record<string, string> }
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    connection.client.shell(
      {
        cols: options.cols,
        rows: options.rows,
        term: options.term
      },
      { env: options.env as NodeJS.ProcessEnv | undefined },
      (error, channel) => {
        if (error) reject(error);
        else resolve(channel);
      }
    );
  });
}
