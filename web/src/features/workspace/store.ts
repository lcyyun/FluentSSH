import { create } from 'zustand';
import type { HostProfile, SessionInfo, SessionState, SessionStats } from '@shared/types';

export type WorkspaceTabKind = 'terminal' | 'files';

export interface WorkspaceTab {
  /** Same as the backend session id. */
  id: string;
  sessionId: string;
  kind: WorkspaceTabKind;
  hostId: string | null;
  hostName: string;
  hostname: string;
  username: string;
  port: number;
  title: string;
  state: SessionState;
  createdAt: number;
  /** Timestamp the SSH handshake finished (`null` while connecting). */
  connectedAt?: number | null;
  error: string | null;
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  initialPath?: string;
  /** Latest SSH I/O counters published by the server on `session.updated`. */
  stats?: SessionStats;
  /** Server-side host key fingerprint negotiated for this session. */
  hostKeyFingerprint?: string | null;
  /** Terminal geometry (kept in sync by the terminal view / session events). */
  cols?: number;
  rows?: number;
  term?: string;
  /** Remote shell exit information once the shell has terminated. */
  exitCode?: number | null;
  exitSignal?: string | null;
  /** Latest title reported by the remote shell (OSC 0/2). */
  remoteTitle?: string | null;
  /** Timestamp of the last terminal output chunk (used for activity hints). */
  lastActivityAt?: number | null;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeId: string | null;
  setActive: (id: string | null) => void;
  addTab: (tab: WorkspaceTab) => void;
  updateFromSession: (session: SessionInfo) => void;
  patchTab: (id: string, patch: Partial<WorkspaceTab>) => void;
  removeTab: (id: string) => void;
  hydrate: (sessions: SessionInfo[]) => void;
  clear: () => void;
}

const ACTIVE_KEY = 'fluentssh.activeTab';

function readActive(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function titleFor(session: SessionInfo): string {
  return session.kind === 'sftp' ? `${session.hostName} · 文件` : session.hostName;
}

export function tabFromSession(
  session: SessionInfo,
  extras: { initialPath?: string; title?: string } = {}
): WorkspaceTab {
  return {
    id: session.id,
    sessionId: session.id,
    kind: session.kind === 'sftp' ? 'files' : 'terminal',
    hostId: session.hostId,
    hostName: session.hostName,
    hostname: session.hostname,
    username: session.username,
    port: session.port,
    title: extras.title ?? (session.kind === 'sftp' ? `${session.hostName} · 文件` : session.hostName),
    state: session.state,
    createdAt: session.createdAt,
    connectedAt: session.connectedAt,
    error: session.lastError,
    errorCode: session.errorCode,
    errorDetails: session.errorDetails,
    initialPath: extras.initialPath,
    stats: session.stats,
    hostKeyFingerprint: session.hostKeyFingerprint,
    cols: session.cols,
    rows: session.rows,
    term: session.term,
    lastActivityAt: session.connectedAt
  };
}

export function tabFromHost(host: HostProfile, kind: WorkspaceTabKind): WorkspaceTab {
  const now = Date.now();
  return {
    id: `pending-${host.id}-${now}`,
    sessionId: '',
    kind,
    hostId: host.id,
    hostName: host.name,
    hostname: host.hostname,
    username: host.username,
    port: host.port,
    title: kind === 'files' ? `${host.name} · 文件` : host.name,
    state: 'connecting',
    createdAt: now,
    error: null,
    errorCode: null,
    errorDetails: null
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeId: readActive(),

  setActive: (id) => {
    set({ activeId: id });
    try {
      if (id) sessionStorage.setItem(ACTIVE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  },

  addTab: (tab) => {
    set((state) => {
      const withoutPending = state.tabs.filter(
        (item) => !(item.kind === tab.kind && item.hostId === tab.hostId && item.state === 'connecting' && !item.sessionId)
      );
      return { tabs: [...withoutPending.filter((item) => item.id !== tab.id), tab] };
    });
    get().setActive(tab.id);
  },

  updateFromSession: (session) => {
    set((state) => {
      const existing = state.tabs.find(
        (tab) => tab.sessionId === session.id || tab.id === session.id
      );
      if (!existing) {
        // Never resurrect a session that already ended and was not open locally.
        if (session.state === 'closed') return state;
        // The async session events can beat the HTTP create response. Adopt the
        // optimistic "pending" tab instead of flashing a duplicate tab.
        const kind = session.kind === 'sftp' ? 'files' : 'terminal';
        const pending = state.tabs.find(
          (tab) =>
            !tab.sessionId &&
            tab.kind === kind &&
            (tab.hostId === session.hostId || (!tab.hostId && !session.hostId))
        );
        if (pending) {
          const adopted = tabFromSession(session, {
            title: pending.title,
            initialPath: pending.initialPath
          });
          return {
            tabs: state.tabs.map((tab) => (tab.id === pending.id ? adopted : tab)),
            activeId: state.activeId === pending.id ? session.id : state.activeId
          };
        }
        return {
          tabs: [
            ...state.tabs,
            tabFromSession(session, {
              title: session.kind === 'sftp' ? `${session.hostName} · 文件` : undefined
            })
          ]
        };
      }
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                id: session.id,
                sessionId: session.id,
                state: session.state,
                error: session.lastError,
                errorCode: session.errorCode,
                errorDetails: session.errorDetails,
                hostName: session.hostName,
                stats: session.stats,
                hostKeyFingerprint: session.hostKeyFingerprint,
                cols: session.cols,
                rows: session.rows,
                term: session.term,
                connectedAt: session.connectedAt,
                title:
                  tab.kind === 'files' ? `${session.hostName} · 文件` : tab.title || titleFor(session)
              }
            : tab
        )
      };
    });
    const state = get();
    const tab = state.tabs.find((item) => item.sessionId === session.id);
    if (tab && state.activeId !== tab.id && state.activeId?.startsWith('pending-')) {
      state.setActive(tab.id);
    }
  },

  patchTab: (id, patch) => {
    set((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }));
  },

  removeTab: (id) => {
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      let activeId = state.activeId;
      if (activeId === id) activeId = tabs[tabs.length - 1]?.id ?? null;
      return { tabs, activeId };
    });
    try {
      const active = get().activeId;
      if (active) sessionStorage.setItem(ACTIVE_KEY, active);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  },

  hydrate: (sessions) => {
    set((state) => {
      const existing = new Set(state.tabs.map((tab) => tab.sessionId));
      const additions = sessions
        .filter((session) => !existing.has(session.id) && session.state !== 'closed')
        .map((session) => tabFromSession(session));
      const activeId = state.activeId && (state.tabs.some((tab) => tab.id === state.activeId) || additions.some((tab) => tab.id === state.activeId))
        ? state.activeId
        : additions[0]?.id ?? state.tabs[0]?.id ?? null;
      return { tabs: [...state.tabs, ...additions], activeId };
    });
  },

  clear: () => set({ tabs: [], activeId: null })
}));
