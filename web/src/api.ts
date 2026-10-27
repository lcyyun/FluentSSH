import type {
  AppInfo,
  AppSettings,
  AuditEvent,
  AuthPrompt,
  CommandHistoryEntry,
  CreateSftpSessionInput,
  CreateTerminalSessionInput,
  ExecInput,
  ExecResult,
  HostGroup,
  HostInput,
  HostProfile,
  InlineConnection,
  KeyGenerateInput,
  KeyImportInput,
  KnownHost,
  SessionInfo,
  SftpEntry,
  SftpListResult,
  SftpReadResult,
  SftpSearchResult,
  Snippet,
  SnippetInput,
  SshConfigImportResult,
  SshKeyMeta,
  TunnelInfo,
  TunnelInput,
  VaultStatus
} from '@shared/types';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE = '/api';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin'
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })?.error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `请求失败（HTTP ${response.status}）`,
      error?.details ?? null
    );
  }
  return payload as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface BootstrapPayload {
  info: AppInfo;
  vault: VaultStatus;
  settings: AppSettings;
}

export const api = {
  bootstrap: () => request<BootstrapPayload>('/bootstrap'),

  vault: {
    status: () => request<{ status: VaultStatus }>('/vault'),
    unlock: (password: string) =>
      request<{ status: VaultStatus }>('/vault/unlock', { method: 'POST', body: JSON.stringify({ password }) }),
    lock: () => request<{ status: VaultStatus }>('/vault/lock', { method: 'POST' }),
    protect: (password: string) =>
      request<{ status: VaultStatus }>('/vault/protect', { method: 'POST', body: JSON.stringify({ password }) }),
    unprotect: (password: string) =>
      request<{ status: VaultStatus }>('/vault/unprotect', { method: 'POST', body: JSON.stringify({ password }) }),
    touch: () => request<{ status: VaultStatus }>('/vault/touch', { method: 'POST' })
  },

  settings: {
    get: () => request<{ settings: AppSettings }>('/settings'),
    patch: (patch: Record<string, unknown>) =>
      request<{ settings: AppSettings }>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    reset: () => request<{ settings: AppSettings }>('/settings', { method: 'POST' })
  },

  hosts: {
    list: () => request<{ hosts: HostProfile[] }>('/hosts'),
    get: (id: string) => request<{ host: HostProfile }>(`/hosts/${id}`),
    create: (input: HostInput) => request<{ host: HostProfile }>('/hosts', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<HostInput>) =>
      request<{ host: HostProfile }>(`/hosts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/hosts/${id}`, { method: 'DELETE' }),
    duplicate: (id: string) => request<{ host: HostProfile }>(`/hosts/${id}/duplicate`, { method: 'POST' }),
    exportConfig: (ids?: string[]) => request<{ content: string }>(`/hosts/export${qs({ ids: ids?.join(',') })}`),
    exportHostConfig: (id: string) => request<{ content: string }>(`/hosts/${id}/ssh-config`),
    importSshConfig: (content: string, groupName?: string) =>
      request<{ result: SshConfigImportResult }>('/hosts/import/ssh-config', {
        method: 'POST',
        body: JSON.stringify({ content, groupName })
      })
  },

  groups: {
    list: () => request<{ groups: HostGroup[] }>('/groups'),
    create: (input: { name: string; color?: string; parentId?: string | null }) =>
      request<{ group: HostGroup }>('/groups', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: { name?: string; color?: string; parentId?: string | null }) =>
      request<{ group: HostGroup }>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/groups/${id}`, { method: 'DELETE' })
  },

  keys: {
    list: () => request<{ keys: SshKeyMeta[] }>('/keys'),
    generate: (input: KeyGenerateInput) =>
      request<{ key: SshKeyMeta }>('/keys/generate', { method: 'POST', body: JSON.stringify(input) }),
    import: (input: KeyImportInput) =>
      request<{ key: SshKeyMeta }>('/keys/import', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: { name?: string; comment?: string }) =>
      request<{ key: SshKeyMeta }>(`/keys/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/keys/${id}`, { method: 'DELETE' })
  },

  knownHosts: {
    list: () => request<{ knownHosts: KnownHost[] }>('/known-hosts'),
    trust: (input: { hostname: string; port: number; keyType: string; fingerprint: string }) =>
      request<{ knownHost: KnownHost }>('/known-hosts/trust', { method: 'POST', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/known-hosts/${id}`, { method: 'DELETE' }),
    import: (content: string) =>
      request<{ imported: number; skipped: number }>('/known-hosts/import', {
        method: 'POST',
        body: JSON.stringify({ content })
      }),
    export: () => request<{ content: string }>('/known-hosts/export')
  },

  sessions: {
    list: (kind?: 'terminal' | 'sftp') => request<{ sessions: SessionInfo[] }>(`/sessions${qs({ kind })}`),
    get: (id: string) => request<{ session: SessionInfo }>(`/sessions/${id}`),
    createTerminal: (input: CreateTerminalSessionInput) =>
      request<{ session: SessionInfo }>('/sessions/terminal', { method: 'POST', body: JSON.stringify(input) }),
    createSftp: (input: CreateSftpSessionInput) =>
      request<{ session: SessionInfo }>('/sessions/sftp', { method: 'POST', body: JSON.stringify(input) }),
    reconnect: (id: string) => request<{ session: SessionInfo }>(`/sessions/${id}/reconnect`, { method: 'POST' }),
    disconnect: (id: string) => request<{ session: SessionInfo }>(`/sessions/${id}/disconnect`, { method: 'POST' }),
    remove: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' })
  },

  authPrompts: {
    list: () => request<{ prompts: AuthPrompt[] }>('/auth/prompts'),
    respond: (requestId: string, responses: string[]) =>
      request<{ ok: true }>(`/auth/prompts/${requestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ responses })
      }),
    cancel: (requestId: string) =>
      request<{ ok: true }>(`/auth/prompts/${requestId}/cancel`, { method: 'POST' })
  },

  exec: {
    run: (input: ExecInput) => request<{ result: ExecResult }>('/exec', { method: 'POST', body: JSON.stringify(input) })
  },

  commands: {
    history: (limit = 200) => request<{ history: CommandHistoryEntry[] }>(`/commands/history${qs({ limit })}`),
    clearHistory: () => request<void>('/commands/history', { method: 'DELETE' })
  },

  snippets: {
    list: () => request<{ snippets: Snippet[] }>('/snippets'),
    create: (input: SnippetInput) =>
      request<{ snippet: Snippet }>('/snippets', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<SnippetInput>) =>
      request<{ snippet: Snippet }>(`/snippets/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/snippets/${id}`, { method: 'DELETE' })
  },

  sftp: {
    home: (sessionId: string) => request<{ path: string }>(`/sftp/home${qs({ sessionId })}`),
    list: (sessionId: string, path: string) =>
      request<SftpListResult>(`/sftp/list${qs({ sessionId, path })}`),
    stat: (sessionId: string, path: string) =>
      request<{ entry: SftpEntry }>(`/sftp/stat${qs({ sessionId, path })}`),
    search: (sessionId: string, path: string, query: string, limit = 500) =>
      request<SftpSearchResult>(`/sftp/search${qs({ sessionId, path, query, limit })}`),
    mkdir: (sessionId: string, path: string, mode?: number) =>
      request<{ path: string }>('/sftp/mkdir', { method: 'POST', body: JSON.stringify({ sessionId, path, mode }) }),
    rename: (sessionId: string, from: string, to: string) =>
      request<{ path: string }>('/sftp/rename', { method: 'POST', body: JSON.stringify({ sessionId, from, to }) }),
    remove: (sessionId: string, paths: string[], recursive = false) =>
      request<{ deleted: number }>('/sftp/delete', {
        method: 'POST',
        body: JSON.stringify({ sessionId, paths, recursive })
      }),
    chmod: (sessionId: string, path: string, mode: string | number) =>
      request<{ entry: SftpEntry }>('/sftp/chmod', { method: 'POST', body: JSON.stringify({ sessionId, path, mode }) }),
    symlink: (sessionId: string, target: string, path: string) =>
      request<{ path: string }>('/sftp/symlink', { method: 'POST', body: JSON.stringify({ sessionId, target, path }) }),
    read: (sessionId: string, path: string, maxBytes = 2_097_152) =>
      request<SftpReadResult>(`/sftp/read${qs({ sessionId, path, maxBytes })}`),
    write: (sessionId: string, path: string, content: string, encoding: 'utf8' | 'base64' = 'utf8') =>
      request<{ ok: true; size: number }>('/sftp/write', {
        method: 'PUT',
        body: JSON.stringify({ sessionId, path, content, encoding })
      }),
    downloadUrl: (sessionId: string, path: string) => `${BASE}/sftp/download${qs({ sessionId, path })}`
  },

  tunnels: {
    list: () => request<{ tunnels: TunnelInfo[] }>('/tunnels'),
    create: (input: TunnelInput) =>
      request<{ tunnel: TunnelInfo }>('/tunnels', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<TunnelInput>) =>
      request<{ tunnel: TunnelInfo }>(`/tunnels/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<void>(`/tunnels/${id}?stop=1`, { method: 'DELETE' }),
    start: (id: string) => request<{ tunnel: TunnelInfo }>(`/tunnels/${id}/start`, { method: 'POST' }),
    stop: (id: string) => request<{ tunnel: TunnelInfo }>(`/tunnels/${id}/stop`, { method: 'POST' })
  },

  audit: {
    list: (limit = 300, category?: string) =>
      request<{ events: AuditEvent[] }>(`/audit${qs({ limit, category })}`),
    clear: () => request<void>('/audit', { method: 'DELETE' })
  },

  logs: {
    list: () => request<{ logs: { sessionId: string; hostLabel: string; kind: string; startedAt: number; size: number }[] }>('/logs'),
    downloadUrl: (sessionId: string) => `${BASE}/logs/${sessionId}`,
    remove: (sessionId: string) => request<void>(`/logs/${sessionId}`, { method: 'DELETE' })
  }
};

/** Raw-body upload with progress + abort support. */
export function uploadSftpFile(options: {
  sessionId: string;
  dir: string;
  file: File;
  overwrite?: boolean;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ path: string; size: number }> {
  const { sessionId, dir, file, overwrite, onProgress, signal } = options;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${BASE}/sftp/upload${qs({
      sessionId,
      path: dir,
      name: file.name,
      overwrite: overwrite ? 1 : undefined
    })}`;
    xhr.open('PUT', url);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { path: string; size: number });
        } catch {
          reject(new ApiRequestError(500, 'BAD_RESPONSE', '上传响应无法解析。'));
        }
      } else {
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } };
          reject(
            new ApiRequestError(xhr.status, parsed.error?.code ?? 'UPLOAD_FAILED', parsed.error?.message ?? '上传失败。')
          );
        } catch {
          reject(new ApiRequestError(xhr.status, 'UPLOAD_FAILED', '上传失败。'));
        }
      }
    };
    xhr.onerror = () => reject(new ApiRequestError(0, 'NETWORK', '上传时网络中断。'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Streaming download with progress; saves through a Blob URL. */
export async function downloadSftpFile(options: {
  sessionId: string;
  path: string;
  fileName: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(api.sftp.downloadUrl(options.sessionId, options.path), {
    credentials: 'same-origin',
    signal: options.signal
  });
  if (!response.ok) {
    let message = '下载失败。';
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // ignore
    }
    throw new ApiRequestError(response.status, 'DOWNLOAD_FAILED', message);
  }
  const total = Number(response.headers.get('Content-Length') ?? 0);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        options.onProgress?.(loaded, total || loaded);
      }
    }
  }
  const blob = new Blob(chunks as BlobPart[]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export type { InlineConnection };
