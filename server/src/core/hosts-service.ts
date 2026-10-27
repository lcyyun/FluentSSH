import crypto from 'node:crypto';
import type { HostInput, HostProfile, HostGroup, SshConfigImportResult } from '../../../shared/types.js';
import { HOST_COLORS } from '../../../shared/types.js';
import { getStore } from './store.js';
import type { StoredHost } from './store-types.js';
import { getVault } from './vault.js';
import { ApiError } from './errors.js';
import { audit } from './audit.js';

const DEFAULT_TERMINAL = {};

export function toHostProfile(host: StoredHost): HostProfile {
  const { secrets, ...rest } = host;
  return {
    ...rest,
    hasPassword: Boolean(secrets?.password),
    hasPassphrase: Boolean(secrets?.passphrase)
  };
}

export function findHost(hostId: string): StoredHost | undefined {
  return getStore().data.hosts.find((host) => host.id === hostId);
}

export function getHostOrThrow(hostId: string): StoredHost {
  const host = findHost(hostId);
  if (!host) throw new ApiError(404, 'NOT_FOUND', '主机不存在。');
  return host;
}

function defaultColor(): string {
  return HOST_COLORS[Math.floor(Math.random() * HOST_COLORS.length)];
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function createHost(input: HostInput): HostProfile {
  const vault = getVault();
  const now = Date.now();
  const host: StoredHost = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    hostname: input.hostname.trim(),
    port: input.port ?? 22,
    username: input.username.trim(),
    groupId: input.groupId ?? null,
    tags: normalizeTags(input.tags),
    favorite: input.favorite ?? false,
    color: input.color ?? defaultColor(),
    authType: input.authType ?? 'password',
    keyId: input.keyId ?? null,
    proxyJumpId: input.proxyJumpId ?? null,
    terminal: input.terminal ?? DEFAULT_TERMINAL,
    startupCommand: input.startupCommand ?? '',
    env: input.env ?? {},
    keepaliveInterval: input.keepaliveInterval ?? 20_000,
    connectTimeout: input.connectTimeout ?? 20_000,
    compression: input.compression ?? false,
    legacyAlgorithms: input.legacyAlgorithms ?? false,
    defaultPath: input.defaultPath ?? '',
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: null,
    connectCount: 0,
    secrets: {}
  };
  if (input.password) host.secrets.password = vault.encrypt(input.password);
  if (input.passphrase) host.secrets.passphrase = vault.encrypt(input.passphrase);
  getStore().mutate((data) => {
    data.hosts.push(host);
  });
  audit('system', 'info', `创建主机 ${host.name}`, { hostId: host.id, hostLabel: host.name });
  return toHostProfile(host);
}

export function updateHost(hostId: string, input: Partial<HostInput>): HostProfile {
  const vault = getVault();
  const host = getHostOrThrow(hostId);
  if (input.name !== undefined) host.name = input.name.trim();
  if (input.hostname !== undefined) host.hostname = input.hostname.trim();
  if (input.port !== undefined) host.port = input.port;
  if (input.username !== undefined) host.username = input.username.trim();
  if (input.groupId !== undefined) host.groupId = input.groupId;
  if (input.tags !== undefined) host.tags = normalizeTags(input.tags);
  if (input.favorite !== undefined) host.favorite = input.favorite;
  if (input.color !== undefined) host.color = input.color;
  if (input.authType !== undefined) host.authType = input.authType;
  if (input.keyId !== undefined) host.keyId = input.keyId;
  if (input.proxyJumpId !== undefined) {
    if (input.proxyJumpId === host.id) throw new ApiError(400, 'VALIDATION', '主机不能以其自身作为跳板机。');
    host.proxyJumpId = input.proxyJumpId;
  }
  if (input.terminal !== undefined) host.terminal = input.terminal;
  if (input.startupCommand !== undefined) host.startupCommand = input.startupCommand;
  if (input.env !== undefined) host.env = input.env;
  if (input.keepaliveInterval !== undefined) host.keepaliveInterval = input.keepaliveInterval;
  if (input.connectTimeout !== undefined) host.connectTimeout = input.connectTimeout;
  if (input.compression !== undefined) host.compression = input.compression;
  if (input.legacyAlgorithms !== undefined) host.legacyAlgorithms = input.legacyAlgorithms;
  if (input.defaultPath !== undefined) host.defaultPath = input.defaultPath;
  if (input.notes !== undefined) host.notes = input.notes;
  if (input.password !== undefined) {
    host.secrets.password = input.password ? vault.encrypt(input.password) : undefined;
  }
  if (input.passphrase !== undefined) {
    host.secrets.passphrase = input.passphrase ? vault.encrypt(input.passphrase) : undefined;
  }
  host.updatedAt = Date.now();
  getStore().flush();
  return toHostProfile(host);
}

export function deleteHost(hostId: string) {
  const host = getHostOrThrow(hostId);
  const store = getStore();
  store.mutate((data) => {
    data.hosts = data.hosts.filter((item) => item.id !== hostId);
    data.hosts.forEach((item) => {
      if (item.proxyJumpId === hostId) item.proxyJumpId = null;
    });
  });
  audit('system', 'warn', `删除主机 ${host.name}`, { hostId, hostLabel: host.name });
}

export function duplicateHost(hostId: string): HostProfile {
  const source = getHostOrThrow(hostId);
  const now = Date.now();
  const copy: StoredHost = {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    name: `${source.name} (副本)`,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    lastConnectedAt: null,
    connectCount: 0
  };
  getStore().mutate((data) => {
    data.hosts.push(copy);
  });
  return toHostProfile(copy);
}

export function markHostConnected(hostId: string | null) {
  if (!hostId) return;
  const host = findHost(hostId);
  if (!host) return;
  host.lastConnectedAt = Date.now();
  host.connectCount += 1;
  getStore().flush();
}

export function listGroups(): HostGroup[] {
  return getStore().data.groups;
}

export function createGroup(input: { name: string; color?: string; parentId?: string | null }): HostGroup {
  const group: HostGroup = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    color: input.color ?? HOST_COLORS[0],
    parentId: input.parentId ?? null,
    createdAt: Date.now()
  };
  getStore().mutate((data) => {
    data.groups.push(group);
  });
  return group;
}

export function updateGroup(
  groupId: string,
  input: { name?: string; color?: string; parentId?: string | null }
): HostGroup {
  const group = getStore().data.groups.find((item) => item.id === groupId);
  if (!group) throw new ApiError(404, 'NOT_FOUND', '分组不存在。');
  if (input.name !== undefined) group.name = input.name.trim();
  if (input.color !== undefined) group.color = input.color;
  if (input.parentId !== undefined) {
    if (input.parentId === groupId) throw new ApiError(400, 'VALIDATION', '分组不能作为自己的父分组。');
    group.parentId = input.parentId;
  }
  getStore().flush();
  return group;
}

export function deleteGroup(groupId: string) {
  const store = getStore();
  if (!store.data.groups.some((item) => item.id === groupId)) {
    throw new ApiError(404, 'NOT_FOUND', '分组不存在。');
  }
  store.mutate((data) => {
    data.groups = data.groups.filter((item) => item.id !== groupId);
    data.groups.forEach((item) => {
      if (item.parentId === groupId) item.parentId = null;
    });
    data.hosts.forEach((host) => {
      if (host.groupId === groupId) host.groupId = null;
    });
  });
}

/* ------------------------------------------------------------------ */
/* ssh_config import / export                                          */
/* ------------------------------------------------------------------ */

function parseSshConfig(content: string): Array<Record<string, string>> {
  const blocks: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*)\s*(?:=|\s)\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^"|"$/g, '');
    if (key === 'host') {
      current = { host: value };
      blocks.push(current);
      continue;
    }
    if (key === 'match') {
      current = null;
      continue;
    }
    if (current) current[key] = value;
  }
  return blocks.filter((block) => {
    const alias = block.host ?? '';
    return alias && !alias.includes('*') && !alias.includes('?') && !alias.includes('!');
  });
}

export function importSshConfig(content: string, groupName?: string): SshConfigImportResult {
  const blocks = parseSshConfig(content);
  if (blocks.length === 0) throw new ApiError(400, 'VALIDATION', '未在内容中找到有效的 Host 配置。');
  const group = createGroup({ name: groupName?.trim() || 'SSH Config 导入' });
  const imported: HostProfile[] = [];
  const pendingJumps: Array<{ hostId: string; alias: string }> = [];
  const aliasToId = new Map<string, string>();
  let skipped = 0;
  for (const block of blocks) {
    const alias = block.host ?? '';
    const hostname = block.hostname ?? alias;
    const username = block.user ?? '';
    if (!username) {
      skipped++;
      continue;
    }
    try {
      const host = createHost({
        name: alias,
        hostname,
        port: Number(block.port ?? 22) || 22,
        username,
        groupId: group.id,
        authType: 'agent',
        tags: ['ssh-config'],
        notes: block.identityfile ? `IdentityFile: ${block.identityfile}` : '',
        startupCommand: block.remotecommand ?? '',
        keepaliveInterval: block.serveraliveinterval ? Number(block.serveraliveinterval) * 1000 : 20_000
      });
      imported.push(host);
      aliasToId.set(alias, host.id);
      if (block.proxyjump) pendingJumps.push({ hostId: host.id, alias: block.proxyjump });
    } catch {
      skipped++;
    }
  }
  for (const jump of pendingJumps) {
    const jumpId = aliasToId.get(jump.alias);
    if (jumpId) {
      const host = findHost(jump.hostId);
      if (host) host.proxyJumpId = jumpId;
    }
  }
  getStore().flush();
  audit('system', 'info', `从 SSH Config 导入 ${imported.length} 台主机`, { details: { skipped } });
  return { imported, skipped, groupName: group.name };
}

export function exportSshConfig(hostIds?: string[]): string {
  const hosts = getStore().data.hosts.filter((host) => !hostIds || hostIds.includes(host.id));
  const lines: string[] = ['# Exported by FluentSSH', ''];
  for (const host of hosts) {
    const alias = (host.name || host.hostname).replace(/\s+/g, '-');
    lines.push(`Host ${alias}`);
    lines.push(`  HostName ${host.hostname}`);
    lines.push(`  Port ${host.port}`);
    lines.push(`  User ${host.username}`);
    if (host.proxyJumpId) {
      const jump = findHost(host.proxyJumpId);
      if (jump) lines.push(`  ProxyJump ${(jump.name || jump.hostname).replace(/\s+/g, '-')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
