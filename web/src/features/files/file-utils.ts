/**
 * Pure helpers for the SFTP file manager: entry typing, sorting, path
 * handling and permission utilities. No React here.
 */
import type { SftpEntry, SftpListResult } from '@shared/types';
import { formatMode, joinPath, parentPath } from '../../lib/format';

export type SortKey = 'name' | 'size' | 'mtime' | 'mode' | 'type';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' };

export type FileKind =
  | 'directory'
  | 'symlink'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'pdf'
  | 'document'
  | 'text'
  | 'other';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tif', 'tiff', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus', 'mid']);
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'lz4', 'jar', 'war', 'deb', 'rpm', 'iso']);
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'py', 'rb', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp',
  'java', 'kt', 'kts', 'cs', 'php', 'lua', 'pl', 'r', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'vue',
  'svelte', 'xml', 'dockerfile', 'makefile', 'mk', 'gradle', 'proto', 'graphql', 'gql', 'env'
]);
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'rst', 'adoc', 'nfo', 'readme', 'license', 'gitignore']);
const DOC_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key']);

export function entryExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isDirectory(entry: Pick<SftpEntry, 'type'>): boolean {
  return entry.type === 'directory';
}

/** Symlinks are treated like their target for navigation when the backend knows it. */
export function isNavigable(entry: SftpEntry): boolean {
  return entry.type === 'directory';
}

export function fileKind(entry: Pick<SftpEntry, 'name' | 'type' | 'isSymlink'>): FileKind {
  if (entry.type === 'directory') return 'directory';
  if (entry.type === 'symlink' || entry.isSymlink) return 'symlink';
  const ext = entryExtension(entry.name);
  const lower = entry.name.toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  if (ext === 'pdf') return 'pdf';
  if (CODE_EXT.has(ext) || /^(dockerfile|makefile|cmakelists\.txt)$/.test(lower)) return 'code';
  if (TEXT_EXT.has(ext) || lower === 'readme' || lower === 'license' || ext === '') return 'text';
  if (DOC_EXT.has(ext)) return 'document';
  return 'other';
}

export function isHiddenName(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..';
}

export function normalizeRemotePath(path: string): string {
  let value = (path ?? '').trim();
  if (!value) return '/';
  // `~` and relative segments are resolved by the backend on list; normalize
  // the common cases locally so breadcrumbs stay meaningful.
  if (value === '~') return '~';
  if (value.startsWith('~/')) value = `~${value.slice(1)}`;
  if (!value.startsWith('/') && !value.startsWith('~')) value = `/${value}`;
  const parts: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const prefix = value.startsWith('~') ? '~' : '';
  if (!prefix) return `/${parts.join('/')}`;
  return parts.length ? `~/${parts.join('/')}` : '~';
}

/** Directory portion of an absolute remote file path. */
export function remoteParent(filePath: string): string {
  if (filePath === '/' || filePath === '~') return '/';
  const trimmed = filePath.replace(/\/+$/, '');
  if (trimmed === '~') return '/';
  return parentPath(trimmed);
}

export function remoteName(filePath: string): string {
  const trimmed = filePath.replace(/\/+$/, '');
  if (!trimmed) return '/';
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1) || '/';
}

/** Breadcrumb segments with the path prefix each one navigates to. */
export interface Crumb {
  label: string;
  path: string;
}

export function buildCrumbs(path: string): Crumb[] {
  if (!path) return [];
  const crumbs: Crumb[] = [];
  if (path === '~') return [{ label: '~', path: '~' }];
  if (path.startsWith('~/')) {
    crumbs.push({ label: '~', path: '~' });
    const rest = path.slice(2).split('/').filter(Boolean);
    let current = '~';
    for (const segment of rest) {
      current = `${current}/${segment}`;
      crumbs.push({ label: segment, path: current });
    }
    return crumbs;
  }
  crumbs.push({ label: '/', path: '/' });
  let current = '';
  for (const segment of path.split('/').filter(Boolean)) {
    current = `${current}/${segment}`;
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

export function formatEntryTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const year = date.getFullYear();
  if (!sameYear) return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Octal permission digits (no file-type bits) — e.g. "755". */
export function octalPermissions(mode: number | null | undefined): string {
  const value = Number.isFinite(mode) ? (mode as number) & 0o777 : 0;
  return value.toString(8).padStart(3, '0');
}

export function formatPermissionBits(mode: number | null | undefined): string {
  if (!Number.isFinite(mode)) return '---------';
  return formatMode((mode as number) & 0o777);
}

export function permissionSummary(entry: Pick<SftpEntry, 'mode' | 'permissions'>): string {
  const bits = entry.permissions && entry.permissions.length >= 9
    ? entry.permissions.slice(entry.permissions.length - 9)
    : formatPermissionBits(entry.mode);
  return `${octalPermissions(entry.mode)} ${bits}`;
}

/**
 * Parse a user-entered octal mode. Accepts `755`, `0755`, `0o755` and
 * returns the numeric permission bits (e.g. 493 for `0755`).
 */
export function parseOctalMode(input: string): number | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith('0o')) text = text.slice(2);
  else if (text.startsWith('0') && text.length > 1) text = text.slice(1);
  if (!/^[0-7]{1,4}$/.test(text)) return null;
  const value = Number.parseInt(text, 8);
  if (!Number.isFinite(value) || value < 0 || value > 0o7777) return null;
  return value;
}

export function octalToInput(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

/** Human readable rwx string including setuid/setgid/sticky hints. */
export function describePermissions(mode: number): string {
  const bits = formatMode(mode & 0o777);
  const special: string[] = [];
  if (mode & 0o4000) special.push('setuid');
  if (mode & 0o2000) special.push('setgid');
  if (mode & 0o1000) special.push('sticky');
  return special.length ? `${bits}（${special.join(', ')}）` : bits;
}

export function compareEntries(a: SftpEntry, b: SftpEntry, sort: SortState): number {
  const aDir = isDirectory(a);
  const bDir = isDirectory(b);
  if (aDir !== bDir) return aDir ? -1 : 1;
  const factor = sort.direction === 'asc' ? 1 : -1;
  let result = 0;
  switch (sort.key) {
    case 'size':
      result = (a.size ?? 0) - (b.size ?? 0);
      break;
    case 'mtime':
      result = (a.mtime ?? 0) - (b.mtime ?? 0);
      break;
    case 'mode':
      result = (a.mode ?? 0) - (b.mode ?? 0);
      break;
    case 'type':
      result = a.type.localeCompare(b.type);
      break;
    case 'name':
    default:
      result = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
      break;
  }
  if (result === 0) {
    result = a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  }
  return result * factor;
}

export function sortEntries(entries: SftpEntry[], sort: SortState): SftpEntry[] {
  return [...entries].sort((a, b) => compareEntries(a, b, sort));
}

export function filterEntries(entries: SftpEntry[], query: string): SftpEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}

export function filterHidden(entries: SftpEntry[], showHidden: boolean): SftpEntry[] {
  if (showHidden) return entries;
  return entries.filter((entry) => !isHiddenName(entry.name));
}

export function countHidden(entries: SftpEntry[]): number {
  return entries.reduce((count, entry) => (isHiddenName(entry.name) ? count + 1 : count), 0);
}

/** Unique name helper used by rename prompts and collision resolution. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** Path for an entry, falling back to joining the current dir with its name. */
export function entryPath(dir: string, entry: Pick<SftpEntry, 'name' | 'path'>): string {
  return entry.path || joinPath(dir, entry.name);
}

export function summarizeSelection(entries: SftpEntry[]): string {
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0].name;
  if (entries.length <= 3) return entries.map((entry) => entry.name).join('、');
  return `${entries.slice(0, 2).map((entry) => entry.name).join('、')} 等 ${entries.length} 项`;
}

export function describeEntryType(entry: Pick<SftpEntry, 'type' | 'isSymlink'>): string {
  if (entry.type === 'directory') return '文件夹';
  if (entry.type === 'symlink' || entry.isSymlink) return '符号链接';
  if (entry.type === 'file') return '文件';
  return '其他';
}

export function searchSummary(result: { entries: SftpEntry[]; scanned: number; truncated: boolean }, query: string): string {
  const suffix = result.truncated ? '，结果已截断' : '';
  return `在子目录中搜索“${query}” · ${result.entries.length} 个结果（已扫描 ${result.scanned} 项${suffix}）`;
}

/** Content-size guard for the built-in editor. */
export const EDITOR_MAX_BYTES = 2 * 1024 * 1024;

export function isEditableReadResult(result: { binary: boolean; truncated: boolean; size: number }): boolean {
  return !result.binary && !result.truncated && result.size <= EDITOR_MAX_BYTES;
}

export function listResultNames(result: SftpListResult | null | undefined): string[] {
  return result?.entries.map((entry) => entry.name) ?? [];
}

export function itemCountLabel(count: number): string {
  return `${count} 项`;
}

export function errorCodeOf(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export function isNotFound(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (code === 'NOT_FOUND') return true;
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : null;
  return status === 404;
}

export function isConflict(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (code === 'CONFLICT') return true;
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : null;
  return status === 409 && code === null;
}

export function isSessionNotConnected(error: unknown): boolean {
  return errorCodeOf(error) === 'SESSION_NOT_CONNECTED';
}
