import type { HostProfile, TunnelInfo, TunnelStatus, TunnelType } from '@shared/types';
import { ApiRequestError } from '../../api';
import type { StatusTone } from '../../components/StatusPill';

/** Human labels for the three forwarding modes. */
export const TUNNEL_TYPE_LABELS: Record<TunnelType, string> = {
  local: '本地转发',
  remote: '远程转发',
  dynamic: 'SOCKS5 动态'
};

export const TUNNEL_TYPE_SHORT: Record<TunnelType, string> = {
  local: '本地',
  remote: '远程',
  dynamic: 'SOCKS5'
};

export const TUNNEL_TYPE_HINTS: Record<TunnelType, string> = {
  local: '在本机监听端口，经 SSH 主机转发到内网目标。',
  remote: '在远端主机监听端口，把流量转发回本机目标。',
  dynamic: '在本机启动 SOCKS5 代理，按需经 SSH 主机动态转发。'
};

export const TUNNEL_STATUS_META: Record<TunnelStatus, { label: string; tone: StatusTone }> = {
  stopped: { label: '已停止', tone: 'neutral' },
  starting: { label: '启动中', tone: 'warning' },
  active: { label: '运行中', tone: 'success' },
  error: { label: '运行异常', tone: 'danger' }
};

export function tunnelTypeTone(type: TunnelType): StatusTone {
  if (type === 'local') return 'info';
  if (type === 'remote') return 'brand';
  return 'neutral';
}

export function tunnelRoute(tunnel: Pick<TunnelInfo, 'type' | 'bindHost' | 'bindPort' | 'targetHost' | 'targetPort'>): {
  from: string;
  to: string | null;
  label: string;
} {
  const from = `${tunnel.bindHost}:${tunnel.bindPort}`;
  if (tunnel.type === 'dynamic') {
    return { from, to: null, label: `${from} → SOCKS5` };
  }
  const to = `${tunnel.targetHost}:${tunnel.targetPort}`;
  if (tunnel.type === 'remote') {
    return { from, to, label: `远端 ${from} ← 本机 ${to}` };
  }
  return { from, to, label: `本机 ${from} → ${to}` };
}

/** Equivalent OpenSSH command, handy for copy/paste or docs. */
export function tunnelSshCommand(tunnel: TunnelInfo, host: HostProfile | undefined): string {
  const target = host ? `${host.username}@${host.hostname}` : tunnel.hostName;
  const portFlag = host && host.port !== 22 ? ` -p ${host.port}` : '';
  const bind = `${tunnel.bindHost}:${tunnel.bindPort}`;
  if (tunnel.type === 'dynamic') {
    return `ssh -N -D ${bind}${portFlag} ${target}`;
  }
  const forward = `${bind}:${tunnel.targetHost}:${tunnel.targetPort}`;
  const flag = tunnel.type === 'remote' ? '-R' : '-L';
  return `ssh -N ${flag} ${forward}${portFlag} ${target}`;
}

/** Reading order summary used by toasts / previews. */
export function tunnelSummary(tunnel: TunnelInfo): string {
  if (tunnel.type === 'dynamic') {
    return `SOCKS5 · ${tunnel.bindHost}:${tunnel.bindPort} · 经 ${tunnel.hostName}`;
  }
  if (tunnel.type === 'remote') {
    return `远端 ${tunnel.bindHost}:${tunnel.bindPort} → 本机 ${tunnel.targetHost}:${tunnel.targetPort} · 经 ${tunnel.hostName}`;
  }
  return `本机 ${tunnel.bindHost}:${tunnel.bindPort} → ${tunnel.targetHost}:${tunnel.targetPort} · 经 ${tunnel.hostName}`;
}

const HOST_KEY_CODES = new Set(['HOST_KEY_UNKNOWN', 'HOST_KEY_MISMATCH']);

function readableHostKeyDetails(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const fingerprint = typeof details?.fingerprint === 'string' ? details.fingerprint.trim() : '';
  if (!fingerprint) return null;
  return details as Record<string, unknown>;
}

/**
 * Extract structured host-key challenge details from a failed start request.
 * The connection layer returns them in `ApiError.details`; the UI can only
 * show the trust dialog when a fingerprint is present.
 */
export function hostKeyDetailsFromError(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (!HOST_KEY_CODES.has(error.code)) return null;
  return readableHostKeyDetails(error.details);
}

/**
 * Same challenge details, read from an errored TunnelInfo. The backend exposes
 * optional errorCode/errorDetails (e.g. for autoStart failures that only arrive
 * through tunnel.updated); they are only meaningful while status === 'error'.
 */
export function hostKeyDetailsFromTunnel(tunnel: TunnelInfo): Record<string, unknown> | null {
  if (!tunnel.errorCode || !HOST_KEY_CODES.has(tunnel.errorCode)) return null;
  return readableHostKeyDetails(tunnel.errorDetails);
}

export function tunnelErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
