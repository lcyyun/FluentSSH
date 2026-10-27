import type { KeyAlgorithm, KnownHost } from '@shared/types';
import { ApiRequestError } from '../../api';
import type { StatusTone } from '../../components/StatusPill';

export const KEY_ALGORITHM_LABELS: Record<KeyAlgorithm, string> = {
  ed25519: 'ED25519',
  rsa: 'RSA',
  ecdsa: 'ECDSA'
};

export const KEY_ALGORITHM_OPTIONS: Array<{ value: KeyAlgorithm; label: string; desc: string }> = [
  { value: 'ed25519', label: 'ED25519', desc: '推荐 · 现代、紧凑、快速' },
  { value: 'rsa', label: 'RSA', desc: '兼容旧服务器' },
  { value: 'ecdsa', label: 'ECDSA', desc: 'NIST 曲线' }
];

export function keyBitsOptions(algorithm: KeyAlgorithm): number[] {
  if (algorithm === 'rsa') return [2048, 3072, 4096];
  if (algorithm === 'ecdsa') return [256, 384, 521];
  return [256];
}

export const KNOWN_HOST_SOURCE_LABELS: Record<KnownHost['source'], string> = {
  manual: '手动添加',
  trusted: '已信任',
  import: '批量导入'
};

export function knownHostSourceTone(source: KnownHost['source']): StatusTone {
  if (source === 'trusted') return 'success';
  if (source === 'manual') return 'info';
  return 'neutral';
}

/** Common OpenSSH key types offered in the trust dialog. */
export const COMMON_KEY_TYPES = [
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521'
];

export function sourceLabel(source: string): string {
  return KNOWN_HOST_SOURCE_LABELS[source as KnownHost['source']] ?? source;
}

/** Turn an API failure into a helpful, localized message. */
export function friendlyApiError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'VAULT_LOCKED' || error.status === 423) {
      return '保险库已锁定，请先解锁保险库后再操作。';
    }
    if (error.status === 501) {
      return '该接口尚未就绪（后端仍在实现中），请稍后重试。';
    }
    if (error.status === 401) {
      return '本地会话已失效，请刷新页面重试。';
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isKeyInUseError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 409 || error.code === 'CONFLICT');
}

/** Host names returned by the backend when a key deletion is blocked (409 details.hosts). */
export function keyInUseHostNames(error: unknown): string[] {
  if (!(error instanceof ApiRequestError)) return [];
  const hosts = error.details?.hosts;
  if (!Array.isArray(hosts)) return [];
  const names: string[] = [];
  for (const entry of hosts) {
    if (entry && typeof entry === 'object' && 'name' in entry) {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) names.push(name.trim());
    } else if (typeof entry === 'string' && entry.trim()) {
      names.push(entry.trim());
    }
  }
  return names;
}

export function fingerprintPreview(fingerprint: string, length = 34): string {
  const text = fingerprint.trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length)}…`;
}
