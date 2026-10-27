import type { HostProfile, InlineConnection, SessionInfo } from '@shared/types';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';
import { useServerEvent } from '../../events';
import { tabFromHost, tabFromSession, useWorkspaceStore, type WorkspaceTab } from './store';

export interface OpenSessionOptions {
  hostId?: string;
  inline?: InlineConnection;
  host?: HostProfile;
  initialCommand?: string;
  initialPath?: string;
  title?: string;
}

function pendingTabFor(options: OpenSessionOptions, kind: 'terminal' | 'sftp') {
  if (options.host) return tabFromHost(options.host, kind === 'sftp' ? 'files' : 'terminal');
  const label = options.title ?? options.inline?.name ?? `${options.inline?.username ?? ''}@${options.inline?.hostname ?? ''}`;
  return {
    id: `pending-${kind}-${crypto.randomUUID()}`,
    sessionId: '',
    kind: (kind === 'sftp' ? 'files' : 'terminal') as 'files' | 'terminal',
    hostId: options.hostId ?? null,
    hostName: label || '新会话',
    hostname: options.inline?.hostname ?? '',
    username: options.inline?.username ?? '',
    port: options.inline?.port ?? 22,
    title: kind === 'sftp' ? `${label} · 文件` : label,
    state: 'connecting' as const,
    createdAt: Date.now(),
    error: null,
    errorCode: null,
    errorDetails: null,
    initialPath: options.initialPath
  };
}

/**
 * The session events stream is asynchronous and can beat the HTTP response;
 * when a tab for the session already exists keep the fresher event state and
 * only fill in presentation extras instead of overwriting it.
 */
function adoptCreatedSession(
  session: SessionInfo,
  extras: { title?: string; initialPath?: string }
): void {
  const store = useWorkspaceStore.getState();
  const existing = store.tabs.find((tab) => tab.sessionId === session.id || tab.id === session.id);
  if (existing) {
    const patch: Partial<WorkspaceTab> = {};
    if (extras.initialPath && !existing.initialPath) patch.initialPath = extras.initialPath;
    if (extras.title && extras.title !== existing.title) patch.title = extras.title;
    if (Object.keys(patch).length > 0) store.patchTab(existing.id, patch);
    store.setActive(existing.id);
    return;
  }
  store.addTab(tabFromSession(session, extras));
}

export async function openTerminal(options: OpenSessionOptions): Promise<SessionInfo | null> {
  const app = useAppStore.getState();
  const pending = pendingTabFor(options, 'terminal');
  useWorkspaceStore.getState().addTab(pending);
  app.setView('workspace');
  try {
    const { session } = await api.sessions.createTerminal({
      hostId: options.hostId,
      inline: options.inline,
      title: options.title,
      initialCommand: options.initialCommand
    });
    useWorkspaceStore.getState().removeTab(pending.id);
    adoptCreatedSession(session, { title: options.title });
    return session;
  } catch (error) {
    useWorkspaceStore.getState().removeTab(pending.id);
    app.notify('error', '无法打开终端', errorMessage(error));
    return null;
  }
}

export async function openSftp(options: OpenSessionOptions): Promise<SessionInfo | null> {
  const app = useAppStore.getState();
  const pending = pendingTabFor(options, 'sftp');
  useWorkspaceStore.getState().addTab(pending);
  app.setView('workspace');
  try {
    const { session } = await api.sessions.createSftp({
      hostId: options.hostId,
      inline: options.inline,
      initialPath: options.initialPath
    });
    useWorkspaceStore.getState().removeTab(pending.id);
    adoptCreatedSession(session, { initialPath: options.initialPath, title: options.title });
    return session;
  } catch (error) {
    useWorkspaceStore.getState().removeTab(pending.id);
    app.notify('error', '无法打开文件管理', errorMessage(error));
    return null;
  }
}

export async function reconnectTab(tabId: string) {
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab?.sessionId) return;
  try {
    useWorkspaceStore.getState().patchTab(tabId, {
      state: 'connecting',
      error: null,
      errorCode: null,
      errorDetails: null
    });
    // Fire-and-forget: progress arrives through /ws/events plus the terminal
    // WebSocket state messages. The 202 snapshot is already stale by design.
    await api.sessions.reconnect(tab.sessionId);
  } catch (error) {
    useWorkspaceStore.getState().patchTab(tabId, {
      state: 'error',
      error: errorMessage(error)
    });
    const code = (error as { code?: string }).code;
    if (code === 'HOST_KEY_UNKNOWN' || code === 'HOST_KEY_MISMATCH') {
      useAppStore.getState().openHostKeyChallenge({
        details: {
          ...((error as { details?: Record<string, unknown> }).details ?? {}),
          hostLabel: tab.hostName
        },
        retry: () => reconnectTab(tabId)
      });
    } else {
      useAppStore.getState().notify('error', '重新连接失败', errorMessage(error));
    }
  }
}

export async function closeTab(tabId: string) {
  const store = useWorkspaceStore.getState();
  const tab = store.tabs.find((item) => item.id === tabId);
  store.removeTab(tabId);
  if (tab?.sessionId) {
    try {
      await api.sessions.remove(tab.sessionId);
    } catch {
      // Session may already be gone.
    }
  }
}

/** True for the two host-key errors that can be resolved by trusting a key. */
export function isHostKeyErrorCode(code: string | null | undefined): boolean {
  return code === 'HOST_KEY_UNKNOWN' || code === 'HOST_KEY_MISMATCH';
}

/** Opens the global "verify host key" dialog for the error stored on a tab. */
export function requestHostKeyRetry(tabId: string) {
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab) return;
  useAppStore.getState().openHostKeyChallenge({
    details: {
      ...(tab.errorDetails ?? {}),
      hostLabel: tab.hostName
    },
    retry: () => reconnectTab(tabId)
  });
}

/** Re-opens the tab's host in a fresh session (used by tab context menu). */
export async function duplicateTab(tabId: string) {
  const tab: WorkspaceTab | undefined = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab) return null;
  if (!tab.hostId) {
    useAppStore.getState().notify('warning', '无法复制内联会话', '该标签使用临时凭据，请从主机页重新连接。');
    return null;
  }
  return tab.kind === 'files'
    ? openSftp({ hostId: tab.hostId, initialPath: tab.initialPath })
    : openTerminal({ hostId: tab.hostId });
}

/** Closes the active tab when one exists. */
export function closeActiveTab() {
  const { activeId } = useWorkspaceStore.getState();
  if (activeId) void closeTab(activeId);
}

/** Loads server-side sessions into the workspace tab strip. Safe to call repeatedly. */
export async function hydrateWorkspaceSessions() {
  try {
    const { sessions } = await api.sessions.list();
    useWorkspaceStore.getState().hydrate(sessions);
  } catch {
    // Backend may still be booting; live session events will fill the workspace in later.
  }
}

/** Resolves a host from the app store and opens a terminal/files tab for it. */
export async function openSessionForHost(hostId: string, kind: 'terminal' | 'files' = 'terminal') {
  const host = useAppStore.getState().hosts.find((item) => item.id === hostId);
  if (!host) {
    useAppStore.getState().notify('error', '主机不存在', '该主机可能已被删除。');
    return null;
  }
  return kind === 'files' ? openSftp({ hostId: host.id, host }) : openTerminal({ hostId: host.id, host });
}

/**
 * Applies server session events to the workspace and routes security prompts
 * to the global dialogs. Call once from the workspace page.
 */

/** De-duplicates the host-key dialog when several `session.updated` events arrive. */
let lastHostKeyPrompt = '';

export function useSessionEvents() {
  useServerEvent((event) => {
    const workspace = useWorkspaceStore.getState();
    const app = useAppStore.getState();
    if (event.type === 'session.updated') {
      workspace.updateFromSession(event.session);
      const session = event.session;
      if (session.state === 'error' && session.errorCode) {
        if (session.errorCode === 'HOST_KEY_UNKNOWN' || session.errorCode === 'HOST_KEY_MISMATCH') {
          const promptKey = `${session.id}:${session.errorCode}`;
          if (promptKey === lastHostKeyPrompt) return;
          lastHostKeyPrompt = promptKey;
          const tab = useWorkspaceStore.getState().tabs.find((item) => item.sessionId === session.id);
          app.openHostKeyChallenge({
            details: {
              ...(session.errorDetails ?? {}),
              hostLabel: session.hostName
            },
            retry: async () => {
              if (tab) {
                await reconnectTab(tab.id);
                return;
              }
              try {
                await api.sessions.reconnect(session.id);
              } catch (error) {
                app.notify('error', '重新连接失败', errorMessage(error));
              }
            }
          });
        } else if (session.errorCode === 'AUTH_FAILED') {
          app.notify('error', `${session.hostName} 认证失败`, session.lastError ?? undefined);
        } else if (session.errorCode === 'CONNECTION_FAILED') {
          app.notify('error', `${session.hostName} 连接失败`, session.lastError ?? undefined);
        }
      } else {
        lastHostKeyPrompt = '';
      }
    } else if (event.type === 'session.closed') {
      const tab = workspace.tabs.find((item) => item.sessionId === event.sessionId);
      if (tab) {
        workspace.patchTab(tab.id, { state: event.state, error: event.reason ?? null });
      }
    }
  });
}
