import crypto from 'node:crypto';
import type { KnownHost, TrustHostKeyInput } from '../../../shared/types.js';
import { audit } from '../core/audit.js';
import { ApiError } from '../core/errors.js';
import { getStore } from '../core/store.js';
import { getRememberedHostKey } from './connection.js';

/**
 * Known-hosts management (`/api/known-hosts`).
 *
 * Entries only ever store public material. The raw RFC4253 public key blob is
 * persisted as an internal extra property so `GET /api/known-hosts/export` can
 * emit valid non-hashed known_hosts lines; it is stripped from every API list
 * response so the public `KnownHost` shape stays exact.
 */

interface StoredKnownHost extends KnownHost {
  /** Base64 RFC4253 public key blob (internal, never returned by the API). */
  publicKey?: string;
}

function asStored(entry: KnownHost): StoredKnownHost {
  return entry as StoredKnownHost;
}

/** Strip internal fields so API responses match the `KnownHost` contract exactly. */
function toKnownHostPublic(entry: KnownHost): KnownHost {
  return {
    id: entry.id,
    hostname: entry.hostname,
    port: entry.port,
    keyType: entry.keyType,
    fingerprint: entry.fingerprint,
    addedAt: entry.addedAt,
    lastSeenAt: entry.lastSeenAt,
    source: entry.source
  };
}

function fingerprintOfBlob(rawKey: Buffer): string {
  const digest = crypto.createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function readSshString(buffer: Buffer, offset: number): { value: string; next: number } {
  if (offset + 4 > buffer.length) return { value: '', next: buffer.length };
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  return { value: buffer.subarray(start, start + length).toString('ascii'), next: start + length };
}

function normalizePort(value: number): number {
  const port = Math.round(Number(value));
  if (!Number.isFinite(port) || port < 1 || port > 65_535) {
    throw new ApiError(400, 'VALIDATION', '端口必须是 1-65535 之间的整数。');
  }
  return port;
}

function normalizeHostname(value: string): string {
  const hostname = (value ?? '').trim();
  if (!hostname || hostname.length > 255) {
    throw new ApiError(400, 'VALIDATION', '主机名不能为空且长度不能超过 255 个字符。');
  }
  return hostname;
}

function normalizeFingerprint(value: string): string {
  const fingerprint = (value ?? '').trim();
  if (!fingerprint) throw new ApiError(400, 'VALIDATION', '缺少主机密钥指纹。');
  return fingerprint;
}

function findEntryIndex(hostname: string, port: number, keyType: string): number {
  return getStore().data.knownHosts.findIndex(
    (entry) => entry.hostname === hostname && entry.port === port && entry.keyType === keyType
  );
}

export function listKnownHosts(): KnownHost[] {
  return getStore().data.knownHosts.map(toKnownHostPublic);
}

/** Trust a host key (called after the user confirms the host-key challenge). */
export function trustHostKey(input: TrustHostKeyInput): KnownHost {
  const hostname = normalizeHostname(input.hostname);
  const port = normalizePort(input.port);
  const keyType = (input.keyType ?? '').trim() || 'unknown';
  const fingerprint = normalizeFingerprint(input.fingerprint);
  const store = getStore();
  const now = Date.now();
  const remembered = getRememberedHostKey(hostname, port, fingerprint);

  let entry: StoredKnownHost;
  const sameTypeIndex = findEntryIndex(hostname, port, keyType);
  if (sameTypeIndex >= 0) {
    entry = asStored(store.data.knownHosts[sameTypeIndex]);
    entry.fingerprint = fingerprint;
    entry.lastSeenAt = now;
    entry.source = 'trusted';
    if (remembered) entry.publicKey = remembered;
  } else {
    entry = {
      id: crypto.randomUUID(),
      hostname,
      port,
      keyType,
      fingerprint,
      addedAt: now,
      lastSeenAt: now,
      source: 'trusted'
    };
    if (remembered) entry.publicKey = remembered;
    store.mutate((data) => {
      data.knownHosts.push(entry);
    });
  }
  store.flush();
  audit('security', 'info', `信任主机密钥 ${hostname}:${port}`, {
    details: { fingerprint, keyType, hostname, port, hasPublicKey: Boolean(entry.publicKey) }
  });
  return toKnownHostPublic(entry);
}

export function deleteKnownHost(knownHostId: string): void {
  const store = getStore();
  const entry = store.data.knownHosts.find((item) => item.id === knownHostId);
  if (!entry) throw new ApiError(404, 'NOT_FOUND', '已知主机记录不存在。');
  store.mutate((data) => {
    data.knownHosts = data.knownHosts.filter((item) => item.id !== knownHostId);
  });
  audit('security', 'warn', `移除已知主机 ${entry.hostname}:${entry.port}`, {
    details: { fingerprint: entry.fingerprint, keyType: entry.keyType }
  });
}

/* ------------------------------------------------------------------ */
/* known_hosts import / export                                         */
/* ------------------------------------------------------------------ */

interface ParsedKnownHostLine {
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  publicKey: string;
}

function parseHostField(field: string): Array<{ hostname: string; port: number }> {
  const results: Array<{ hostname: string; port: number }> = [];
  for (const part of field.split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (token.includes('*') || token.includes('?') || token.includes('!')) return [];
    if (token.startsWith('[')) {
      const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(token);
      if (!match) return [];
      const port = match[2] ? Number(match[2]) : 22;
      if (!Number.isFinite(port) || port < 1 || port > 65_535) return [];
      results.push({ hostname: match[1], port });
      continue;
    }
    if (token.includes(':')) {
      // Bare IPv6 or "host:port"; only accept an explicit numeric suffix.
      const index = token.lastIndexOf(':');
      const maybePort = token.slice(index + 1);
      const hostPart = token.slice(0, index);
      if (!/^\d+$/.test(maybePort) || !hostPart || hostPart.includes(':')) return [];
      const port = Number(maybePort);
      if (port < 1 || port > 65_535) return [];
      results.push({ hostname: hostPart, port });
      continue;
    }
    results.push({ hostname: token, port: 22 });
  }
  return results;
}

function parseKnownHostsLine(line: string): ParsedKnownHostLine[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (trimmed.startsWith('|')) return null; // hashed host entries are not supported
  if (trimmed.startsWith('@')) return null; // @cert-authority / @revoked markers

  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;
  const [hostField, keyType, base64] = parts;
  if (!/^[a-zA-Z0-9@._-]+$/.test(keyType)) return null;

  let rawKey: Buffer;
  try {
    rawKey = Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
  if (rawKey.length < 8) return null;
  const embeddedType = readSshString(rawKey, 0).value;
  if (!embeddedType || embeddedType !== keyType) return null;

  const hosts = parseHostField(hostField);
  if (hosts.length === 0) return null;
  const fingerprint = fingerprintOfBlob(rawKey);
  return hosts.map((host) => ({
    hostname: host.hostname,
    port: host.port,
    keyType,
    fingerprint,
    publicKey: rawKey.toString('base64')
  }));
}

export interface KnownHostsImportResult {
  imported: number;
  skipped: number;
}

export function importKnownHosts(content: string): KnownHostsImportResult {
  const text = (content ?? '').trim();
  if (!text) throw new ApiError(400, 'VALIDATION', 'known_hosts 内容不能为空。');
  const store = getStore();
  let imported = 0;
  let skipped = 0;
  const now = Date.now();

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('@')) {
      skipped += 1;
      continue;
    }
    const parsedEntries = parseKnownHostsLine(line);
    if (!parsedEntries) {
      skipped += 1;
      continue;
    }
    for (const parsed of parsedEntries) {
      const existingIndex = findEntryIndex(parsed.hostname, parsed.port, parsed.keyType);
      if (existingIndex >= 0) {
        const existing = asStored(store.data.knownHosts[existingIndex]);
        if (existing.fingerprint === parsed.fingerprint) {
          existing.lastSeenAt = now;
          skipped += 1;
          continue;
        }
        existing.fingerprint = parsed.fingerprint;
        existing.publicKey = parsed.publicKey;
        existing.lastSeenAt = now;
        existing.source = 'import';
        imported += 1;
        continue;
      }
      const entry: StoredKnownHost = {
        id: crypto.randomUUID(),
        hostname: parsed.hostname,
        port: parsed.port,
        keyType: parsed.keyType,
        fingerprint: parsed.fingerprint,
        addedAt: now,
        lastSeenAt: now,
        source: 'import',
        publicKey: parsed.publicKey
      };
      store.mutate((data) => {
        data.knownHosts.push(entry);
      });
      imported += 1;
    }
  }

  store.flush();
  audit('security', 'info', `导入已知主机 ${imported} 条`, {
    details: { imported, skipped }
  });
  return { imported, skipped };
}

function hostFieldFor(host: KnownHost): string {
  return host.port === 22 ? host.hostname : `[${host.hostname}]:${host.port}`;
}

export function exportKnownHosts(): string {
  const lines: string[] = ['# Exported by FluentSSH'];
  for (const rawEntry of getStore().data.knownHosts) {
    const entry = asStored(rawEntry);
    const publicKey = entry.publicKey ?? getRememberedHostKey(entry.hostname, entry.port, entry.fingerprint);
    if (!publicKey) continue; // No public material available (e.g. legacy trust entry).
    lines.push(`${hostFieldFor(entry)} ${entry.keyType} ${publicKey}`);
  }
  return `${lines.join('\n')}\n`;
}
