import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import ssh2 from 'ssh2';
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';
import type { SftpEntry, SftpListResult, SftpReadResult, SftpSearchResult, SessionInfo } from '../../../shared/types.js';
import { ApiError, badRequest, conflict, notFound } from '../core/errors.js';
import { audit } from '../core/audit.js';
import { requireSftpChannel } from './session-access.js';

/**
 * SFTP service: every operation runs over the SFTP channel that belongs to a
 * connected `kind:'sftp'` session (one SSH connection per SFTP session, managed
 * by the SSH core workstream). This module never opens its own connections.
 */

const STATUS_CODE = ssh2.utils.sftp.STATUS_CODE;

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;

const DEFAULT_READ_MAX_BYTES = 2 * 1024 * 1024;
const HARD_READ_MAX_BYTES = 8 * 1024 * 1024;
const SEARCH_DEFAULT_LIMIT = 500;
const SEARCH_MAX_LIMIT = 2000;
const SEARCH_MAX_DEPTH = 12;
const SEARCH_MAX_SCANNED = 20_000;
const DELETE_MAX_DEPTH = 32;
const READ_CHUNK_SIZE = 256 * 1024;

/* ------------------------------------------------------------------ */
/* ssh2 callback helpers                                               */
/* ------------------------------------------------------------------ */

function callValue<T>(executor: (callback: (error: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    executor((error, value) => (error ? reject(error) : resolve(value)));
  });
}

function callDone(executor: (callback: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    executor((error) => (error ? reject(error) : resolve()));
  });
}

function sftpStatusOf(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}

function isEofError(error: unknown): boolean {
  return sftpStatusOf(error) === STATUS_CODE.EOF;
}

function sftpApiError(error: unknown, action: string, details: Record<string, unknown> = {}): ApiError {
  if (error instanceof ApiError) return error;
  const status = sftpStatusOf(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (status === STATUS_CODE.NO_SUCH_FILE) {
    return new ApiError(404, 'NOT_FOUND', `${action}：远程文件或目录不存在。`, { ...details, remoteError: rawMessage, remoteStatus: status });
  }
  if (status === STATUS_CODE.PERMISSION_DENIED) {
    return new ApiError(403, 'SFTP_ERROR', `${action}：远程服务器拒绝访问（权限不足）。`, {
      ...details,
      remoteError: rawMessage,
      remoteStatus: status
    });
  }
  return new ApiError(502, 'SFTP_ERROR', `${action}失败：${rawMessage || '远程服务器返回错误。'}`, {
    ...details,
    remoteError: rawMessage,
    remoteStatus: status
  });
}

async function withChannel<T>(sessionId: string | undefined | null, action: string, fn: (context: { channel: SFTPWrapper; session: SessionInfo }) => Promise<T>): Promise<T> {
  const context = await requireSftpChannel(sessionId);
  try {
    return await fn(context);
  } catch (error) {
    throw sftpApiError(error, action, { sessionId: context.session.id });
  }
}

/* ------------------------------------------------------------------ */
/* Path / attribute helpers                                            */
/* ------------------------------------------------------------------ */

function cleanPath(input: string | undefined | null, fallback = '.'): string {
  const value = typeof input === 'string' ? input.trim() : '';
  return value.length > 0 ? value : fallback;
}

function joinRemotePath(directory: string, name: string): string {
  const base = directory.replace(/\/+$/, '');
  if (!base) return `/${name}`;
  return `${base}/${name}`;
}

function parentOf(remotePath: string): string {
  const parent = path.posix.dirname(remotePath);
  return parent === '' ? '.' : parent;
}

function baseNameOf(remotePath: string): string {
  const name = path.posix.basename(remotePath.replace(/\/+$/, ''));
  return name || 'download';
}

function entryTypeOf(attrs: Stats): SftpEntry['type'] {
  if (typeof attrs.isSymbolicLink === 'function' && attrs.isSymbolicLink()) return 'symlink';
  if (typeof attrs.isDirectory === 'function' && attrs.isDirectory()) return 'directory';
  if (typeof attrs.isFile === 'function' && attrs.isFile()) return 'file';
  const kind = attrs.mode & S_IFMT;
  if (kind === S_IFDIR) return 'directory';
  if (kind === S_IFLNK) return 'symlink';
  if (kind === S_IFREG) return 'file';
  return 'other';
}

function modeToPermissions(mode: number): string {
  const kind = mode & S_IFMT;
  const typeChar = kind === S_IFDIR ? 'd' : kind === S_IFLNK ? 'l' : kind === S_IFREG ? '-' : '?';
  const bits = ['r', 'w', 'x'];
  let result = typeChar;
  for (let index = 0; index < 9; index += 1) {
    const mask = 0o400 >> index;
    result += mode & mask ? bits[index % 3] : '-';
  }
  return result;
}

function toSftpEntry(remotePath: string, name: string, attrs: Stats, linkTarget: string | null): SftpEntry {
  return {
    name,
    path: remotePath,
    type: entryTypeOf(attrs),
    size: attrs.size ?? 0,
    mode: attrs.mode ?? 0,
    permissions: modeToPermissions(attrs.mode ?? 0),
    uid: attrs.uid ?? 0,
    gid: attrs.gid ?? 0,
    atime: attrs.atime ? attrs.atime * 1000 : 0,
    mtime: attrs.mtime ? attrs.mtime * 1000 : 0,
    isSymlink: entryTypeOf(attrs) === 'symlink',
    linkTarget
  };
}

async function unwrapLink(channel: SFTPWrapper, remotePath: string, attrs: Stats, name: string): Promise<SftpEntry> {
  let linkTarget: string | null = null;
  if (entryTypeOf(attrs) === 'symlink') {
    try {
      linkTarget = await callValue<string>((callback) => channel.readlink(remotePath, callback));
    } catch {
      linkTarget = null;
    }
  }
  return toSftpEntry(remotePath, name, attrs, linkTarget);
}

async function realpathSafe(channel: SFTPWrapper, remotePath: string): Promise<string> {
  try {
    return await callValue<string>((callback) => channel.realpath(cleanPath(remotePath), callback));
  } catch {
    return cleanPath(remotePath);
  }
}

function parseMode(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || input > 0o7777) throw badRequest('mode 必须是 0-07777 之间的八进制权限值。');
    return Math.trunc(input);
  }
  const value = input.trim();
  if (!value) throw badRequest('mode 不能为空，例如 "755"。');
  let parsed: number;
  if (/^0o[0-7]+$/i.test(value)) parsed = Number.parseInt(value.slice(2), 8);
  else if (/^0[0-7]+$/.test(value)) parsed = Number.parseInt(value, 8);
  else if (/^[0-7]{1,4}$/.test(value)) parsed = Number.parseInt(value, 8);
  else throw badRequest('mode 必须是八进制字符串（如 "755"）或数字（如 0o755）。');
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0o7777) throw badRequest('mode 超出范围（最大 07777）。');
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Low-level file IO helpers                                           */
/* ------------------------------------------------------------------ */

async function openRead(channel: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return callValue<Buffer>((callback) => channel.open(remotePath, 'r', callback));
}

async function closeHandle(channel: SFTPWrapper, handle: Buffer): Promise<void> {
  await callDone((callback) => channel.close(handle, callback));
}

async function readRange(channel: SFTPWrapper, remotePath: string, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await openRead(channel, remotePath);
  const chunks: Buffer[] = [];
  let position = start;
  let remaining = length;
  try {
    while (remaining > 0) {
      const chunkSize = Math.min(remaining, READ_CHUNK_SIZE);
      const buffer = Buffer.alloc(chunkSize);
      let bytesRead = 0;
      try {
        bytesRead = await new Promise<number>((resolve, reject) => {
          channel.read(handle, buffer, 0, chunkSize, position, (error, read, _buffer, _position) => {
            if (error) {
              if (isEofError(error)) resolve(0);
              else reject(error);
              return;
            }
            resolve(read);
          });
        });
      } catch (error) {
        if (isEofError(error)) break;
        throw error;
      }
      if (bytesRead <= 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      position += bytesRead;
      remaining -= bytesRead;
    }
  } finally {
    await closeHandle(channel, handle).catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

async function atomicWriteBuffer(channel: SFTPWrapper, remotePath: string, data: Buffer): Promise<void> {
  const directory = parentOf(remotePath);
  const temporary = joinRemotePath(directory, `.fluentssh-${randomUUID()}.tmp`);
  try {
    await writeBuffer(channel, temporary, data);
    await callDone((callback) => channel.rename(temporary, remotePath, callback));
  } catch (error) {
    await callDone((callback) => channel.unlink(temporary, callback)).catch(() => undefined);
    throw error;
  }
}

async function writeBuffer(channel: SFTPWrapper, remotePath: string, data: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = channel.createWriteStream(remotePath, { flags: 'w' });
    stream.once('error', reject);
    stream.once('close', () => resolve());
    stream.end(data);
  });
}

async function removeRecursive(channel: SFTPWrapper, remotePath: string, depth = 0): Promise<void> {
  if (depth > DELETE_MAX_DEPTH) throw new ApiError(400, 'VALIDATION', '目录层级过深，已中止递归删除。');
  const attrs = await callValue<Stats>((callback) => channel.lstat(remotePath, callback));
  if (entryTypeOf(attrs) === 'directory') {
    const entries = await callValue<FileEntryWithStats[]>((callback) => channel.readdir(remotePath, callback));
    for (const entry of entries) {
      await removeRecursive(channel, joinRemotePath(remotePath, entry.filename), depth + 1);
    }
    await callDone((callback) => channel.rmdir(remotePath, callback));
    return;
  }
  await callDone((callback) => channel.unlink(remotePath, callback));
}

/* ------------------------------------------------------------------ */
/* Audit helpers                                                       */
/* ------------------------------------------------------------------ */

function auditSftp(session: SessionInfo, message: string, details: Record<string, unknown>, level: 'info' | 'warn' = 'info') {
  audit('sftp', level, message, { hostId: session.hostId, hostLabel: session.hostName, details: { sessionId: session.id, ...details } });
}

/* ------------------------------------------------------------------ */
/* Read operations                                                     */
/* ------------------------------------------------------------------ */

export async function getHomePath(sessionId: string | undefined | null): Promise<string> {
  return withChannel(sessionId, '读取主目录', async ({ channel }) => realpathSafe(channel, '.'));
}

export async function listDirectory(sessionId: string | undefined | null, requestedPath: string | undefined | null): Promise<SftpListResult> {
  return withChannel(sessionId, '读取目录', async ({ channel }) => {
    const target = await realpathSafe(channel, cleanPath(requestedPath));
    const rawEntries = await callValue<FileEntryWithStats[]>((callback) => channel.readdir(target, callback));
    const entries: SftpEntry[] = [];
    for (const item of rawEntries) {
      if (item.filename === '.' || item.filename === '..') continue;
      entries.push(await unwrapLink(channel, joinRemotePath(target, item.filename), item.attrs, item.filename));
    }
    entries.sort((left, right) => {
      const leftDir = left.type === 'directory' ? 0 : 1;
      const rightDir = right.type === 'directory' ? 0 : 1;
      if (leftDir !== rightDir) return leftDir - rightDir;
      return left.name.localeCompare(right.name, 'zh-Hans-CN');
    });
    return { path: target, entries, total: entries.length };
  });
}

export async function statEntry(sessionId: string | undefined | null, requestedPath: string | undefined | null): Promise<SftpEntry> {
  const target = cleanPath(requestedPath);
  if (target === '.' || target === '') throw badRequest('需要提供文件路径。');
  return withChannel(sessionId, '读取文件属性', async ({ channel }) => {
    const attrs = await callValue<Stats>((callback) => channel.lstat(target, callback));
    return unwrapLink(channel, target, attrs, baseNameOf(target));
  });
}

export async function searchFiles(
  sessionId: string | undefined | null,
  requestedPath: string | undefined | null,
  query: string | undefined | null,
  limit?: number
): Promise<SftpSearchResult> {
  const keyword = cleanPath(query, '');
  if (!keyword) throw badRequest('搜索关键词不能为空。');
  const maxResults = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Math.trunc(limit ?? SEARCH_DEFAULT_LIMIT) || SEARCH_DEFAULT_LIMIT));
  const lowered = keyword.toLowerCase();
  return withChannel(sessionId, '搜索文件', async ({ channel }) => {
    const base = await realpathSafe(channel, cleanPath(requestedPath));
    const entries: SftpEntry[] = [];
    let scanned = 0;
    let truncated = false;
    const queue: Array<{ directory: string; depth: number }> = [{ directory: base, depth: 0 }];
    while (queue.length > 0) {
      if (entries.length >= maxResults || scanned >= SEARCH_MAX_SCANNED) {
        truncated = true;
        break;
      }
      const current = queue.shift() as { directory: string; depth: number };
      let children: FileEntryWithStats[];
      try {
        children = await callValue<FileEntryWithStats[]>((callback) => channel.readdir(current.directory, callback));
      } catch (error) {
        if (sftpStatusOf(error) === STATUS_CODE.PERMISSION_DENIED) continue;
        throw error;
      }
      for (const child of children) {
        scanned += 1;
        if (scanned > SEARCH_MAX_SCANNED) {
          truncated = true;
          break;
        }
        const childPath = joinRemotePath(current.directory, child.filename);
        const type = entryTypeOf(child.attrs);
        const matches = child.filename.toLowerCase().includes(lowered);
        if (matches) {
          entries.push(await unwrapLink(channel, childPath, child.attrs, child.filename));
          if (entries.length >= maxResults) {
            truncated = true;
            break;
          }
        }
        if (type === 'directory' && current.depth + 1 <= SEARCH_MAX_DEPTH) {
          queue.push({ directory: childPath, depth: current.depth + 1 });
        }
      }
    }
    return { entries, scanned, truncated };
  });
}

export async function readFileForEditor(
  sessionId: string | undefined | null,
  requestedPath: string | undefined | null,
  maxBytes?: number
): Promise<SftpReadResult> {
  const target = cleanPath(requestedPath);
  if (target === '.' || target === '') throw badRequest('需要提供文件路径。');
  const requestedMax = Math.trunc(maxBytes ?? DEFAULT_READ_MAX_BYTES) || DEFAULT_READ_MAX_BYTES;
  const effectiveMax = Math.max(1, Math.min(HARD_READ_MAX_BYTES, requestedMax));
  return withChannel(sessionId, '读取文件内容', async ({ channel, session }) => {
    const attrs = await callValue<Stats>((callback) => channel.stat(target, callback));
    if (entryTypeOf(attrs) === 'directory') throw badRequest('不能读取目录内容，请使用文件列表接口。');
    const size = attrs.size ?? 0;
    const readLength = Math.min(size, effectiveMax);
    const buffer = await readRange(channel, target, 0, readLength);
    const binary = isBinaryBuffer(buffer);
    const truncated = size > buffer.length;
    auditSftp(session, `读取文件：${target}`, { path: target, size, readBytes: buffer.length, binary });
    return {
      path: target,
      content: binary ? buffer.toString('base64') : buffer.toString('utf8'),
      encoding: binary ? 'base64' : 'utf8',
      size,
      truncated,
      binary
    };
  });
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
  } catch {
    return true;
  }
  // Count control characters that are unusual in text files.
  let control = 0;
  for (const byte of sample) {
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.1;
}

export interface DownloadHandle {
  stream: Readable;
  size: number;
  name: string;
}

/** Open a remote file for streaming download (route pipes it to the response). */
export async function openDownload(sessionId: string | undefined | null, requestedPath: string | undefined | null): Promise<DownloadHandle> {
  const target = cleanPath(requestedPath);
  if (target === '.' || target === '') throw badRequest('需要提供文件路径。');
  return withChannel(sessionId, '下载文件', async ({ channel, session }) => {
    const attrs = await callValue<Stats>((callback) => channel.stat(target, callback));
    if (entryTypeOf(attrs) === 'directory') throw badRequest('不能下载目录，请选择文件。');
    const stream = channel.createReadStream(target);
    const name = baseNameOf(target);
    auditSftp(session, `下载文件：${target}`, { path: target, size: attrs.size ?? 0 });
    return { stream, size: attrs.size ?? 0, name };
  });
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function makeDirectory(
  sessionId: string | undefined | null,
  requestedPath: string | undefined | null,
  mode?: string | number
): Promise<string> {
  const target = cleanPath(requestedPath);
  if (target === '.' || target === '') throw badRequest('需要提供目录路径。');
  const parsedMode = mode === undefined ? undefined : parseMode(mode);
  return withChannel(sessionId, '创建目录', async ({ channel, session }) => {
    const existing = await callValue<Stats>((callback) => channel.lstat(target, callback)).catch(() => null);
    if (existing) throw conflict('目录或文件已存在。', { path: target });
    if (parsedMode === undefined) await callDone((callback) => channel.mkdir(target, callback));
    else await callDone((callback) => channel.mkdir(target, { mode: parsedMode }, callback));
    auditSftp(session, `创建目录：${target}`, { path: target, mode: parsedMode });
    return target;
  });
}

export async function renameEntry(
  sessionId: string | undefined | null,
  from: string | undefined | null,
  to: string | undefined | null
): Promise<string> {
  const source = cleanPath(from);
  const destination = cleanPath(to);
  if (source === '.' || source === '' || destination === '.' || destination === '') {
    throw badRequest('需要提供源路径和目标路径。');
  }
  if (source === destination) return destination;
  return withChannel(sessionId, '重命名', async ({ channel, session }) => {
    const existingSource = await callValue<Stats>((callback) => channel.lstat(source, callback)).catch((error) => {
      if (sftpStatusOf(error) === STATUS_CODE.NO_SUCH_FILE) throw notFound('源文件或目录不存在。');
      throw error;
    });
    if (!existingSource) throw notFound('源文件或目录不存在。');
    const existingDestination = await callValue<Stats>((callback) => channel.lstat(destination, callback)).catch(() => null);
    if (existingDestination) throw conflict('目标路径已存在。', { path: destination });
    await callDone((callback) => channel.rename(source, destination, callback));
    auditSftp(session, `重命名：${source} → ${destination}`, { from: source, to: destination });
    return destination;
  });
}

export async function deleteEntries(
  sessionId: string | undefined | null,
  paths: string[] | undefined | null,
  recursive?: boolean
): Promise<number> {
  if (!Array.isArray(paths) || paths.length === 0) throw badRequest('需要提供要删除的路径列表。');
  const unique = [...new Set(paths.map((item) => cleanPath(item)).filter((item) => item !== '.' && item !== ''))];
  if (unique.length === 0) throw badRequest('没有可删除的路径。');
  if (unique.includes('/')) throw badRequest('不允许删除根目录。');
  return withChannel(sessionId, '删除', async ({ channel, session }) => {
    let deleted = 0;
    for (const target of unique) {
      try {
        if (recursive) {
          await removeRecursive(channel, target);
        } else {
          const attrs = await callValue<Stats>((callback) => channel.lstat(target, callback));
          if (entryTypeOf(attrs) === 'directory') await callDone((callback) => channel.rmdir(target, callback));
          else await callDone((callback) => channel.unlink(target, callback));
        }
        deleted += 1;
      } catch (error) {
        throw sftpApiError(error, '删除', { path: target, deleted });
      }
    }
    auditSftp(session, `删除 ${deleted} 项`, { paths: unique, recursive: Boolean(recursive) });
    return deleted;
  });
}

export async function chmodEntry(
  sessionId: string | undefined | null,
  requestedPath: string | undefined | null,
  mode: string | number
): Promise<SftpEntry> {
  const target = cleanPath(requestedPath);
  if (target === '.' || target === '') throw badRequest('需要提供文件路径。');
  const parsedMode = parseMode(mode);
  return withChannel(sessionId, '修改权限', async ({ channel, session }) => {
    await callDone((callback) => channel.chmod(target, parsedMode, callback));
    const attrs = await callValue<Stats>((callback) => channel.lstat(target, callback));
    auditSftp(session, `修改权限：${target} → ${parsedMode.toString(8)}`, { path: target, mode: parsedMode });
    return unwrapLink(channel, target, attrs, baseNameOf(target));
  });
}

export async function createSymlink(
  sessionId: string | undefined | null,
  target: string | undefined | null,
  linkPath: string | undefined | null
): Promise<string> {
  const linkTarget = cleanPath(target);
  const destination = cleanPath(linkPath);
  if (linkTarget === '.' || linkTarget === '' || destination === '.' || destination === '') {
    throw badRequest('需要提供符号链接目标与路径。');
  }
  return withChannel(sessionId, '创建符号链接', async ({ channel, session }) => {
    await callDone((callback) => channel.symlink(linkTarget, destination, callback));
    auditSftp(session, `创建符号链接：${destination} → ${linkTarget}`, { target: linkTarget, path: destination });
    return destination;
  });
}

export async function writeFileContent(
  sessionId: string | undefined | null,
  requestedPath: string | undefined | null,
  content: string,
  encoding: 'utf8' | 'base64' = 'utf8'
): Promise<number> {
  const target = cleanPath(requestedPath);
  if (target === '.' || target === '') throw badRequest('需要提供文件路径。');
  if (typeof content !== 'string') throw badRequest('content 必须是字符串。');
  const data = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
  return withChannel(sessionId, '写入文件', async ({ channel, session }) => {
    await atomicWriteBuffer(channel, target, data);
    auditSftp(session, `写入文件：${target}`, { path: target, size: data.length, encoding });
    return data.length;
  });
}

export interface UploadOptions {
  /** Remote directory the file is uploaded into. */
  directory: string;
  name: string;
  overwrite: boolean;
  stream: Readable;
}

export interface UploadResult {
  path: string;
  size: number;
}

function assertSafeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') throw badRequest('文件名不合法。');
  if (trimmed.includes('/') || trimmed.includes('\\')) throw badRequest('文件名不能包含路径分隔符。');
  return trimmed;
}

export async function uploadFile(sessionId: string | undefined | null, options: UploadOptions): Promise<UploadResult> {
  const directory = cleanPath(options.directory, '.');
  const name = assertSafeName(options.name);
  const destination = joinRemotePath(directory === '.' ? '.' : directory.replace(/\/+$/, ''), name);
  return withChannel(sessionId, '上传文件', async ({ channel, session }) => {
    if (!options.overwrite) {
      const existing = await callValue<Stats>((callback) => channel.lstat(destination, callback)).catch(() => null);
      if (existing) throw conflict('目标文件已存在。', { path: destination });
    }
    const temporary = joinRemotePath(parentOf(destination), `.fluentssh-upload-${randomUUID()}.tmp`);
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      }
    });
    const writeStream = channel.createWriteStream(temporary, { flags: 'w' });
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        options.stream.once('error', (error) => finish(error));
        writeStream.once('error', (error: Error) => finish(error));
        writeStream.once('close', () => finish());
        counter.once('error', (error) => finish(error));
        options.stream.pipe(counter).pipe(writeStream);
      });
      await callDone((callback) => channel.rename(temporary, destination, callback));
      auditSftp(session, `上传文件：${destination}`, { path: destination, size });
      return { path: destination, size };
    } catch (error) {
      await callDone((callback) => channel.unlink(temporary, callback)).catch(() => undefined);
      throw sftpApiError(error, '上传文件', { path: destination });
    }
  });
}
