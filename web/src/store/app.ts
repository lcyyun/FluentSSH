import { create } from 'zustand';
import type {
  AppInfo,
  AppSettings,
  AuthPrompt,
  HostGroup,
  HostProfile,
  VaultStatus
} from '@shared/types';
import { api, errorMessage } from '../api';

export type AppView = 'hosts' | 'workspace' | 'tunnels' | 'commands' | 'security' | 'logs' | 'settings';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  level: ToastLevel;
  title: string;
  message?: string;
}

export interface HostKeyChallenge {
  details: {
    hostname?: string;
    port?: number;
    keyType?: string;
    fingerprint?: string;
    expectedFingerprint?: string;
    authType?: string;
    hostLabel?: string;
    [key: string]: unknown;
  };
  retry: () => void | Promise<void>;
}

interface AppState {
  booted: boolean;
  bootError: string | null;
  info: AppInfo | null;
  settings: AppSettings | null;
  vault: VaultStatus | null;
  hosts: HostProfile[];
  groups: HostGroup[];
  view: AppView;
  navCollapsed: boolean;
  authPrompt: AuthPrompt | null;
  hostKeyChallenge: HostKeyChallenge | null;
  toasts: ToastItem[];

  initialize: () => Promise<void>;
  reloadAll: () => Promise<void>;
  refreshHosts: () => Promise<void>;
  refreshGroups: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  upsertHost: (host: HostProfile) => void;
  removeHostLocal: (hostId: string) => void;
  setView: (view: AppView) => void;
  setNavCollapsed: (collapsed: boolean) => void;
  updateSettings: (patch: Record<string, unknown>) => Promise<void>;
  setVault: (vault: VaultStatus) => void;
  lockVault: () => Promise<void>;
  unlockVault: (password: string) => Promise<void>;
  notify: (level: ToastLevel, title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  setAuthPrompt: (prompt: AuthPrompt | null) => void;
  openHostKeyChallenge: (challenge: HostKeyChallenge) => void;
  closeHostKeyChallenge: () => void;
}

const savedView = (() => {
  try {
    const value = sessionStorage.getItem('fluentssh.view');
    if (value) return value as AppView;
  } catch {
    // ignore
  }
  return 'hosts' as AppView;
})();

export const useAppStore = create<AppState>((set, get) => ({
  booted: false,
  bootError: null,
  info: null,
  settings: null,
  vault: null,
  hosts: [],
  groups: [],
  view: savedView,
  navCollapsed: false,
  authPrompt: null,
  hostKeyChallenge: null,
  toasts: [],

  initialize: async () => {
    set({ bootError: null });
    try {
      const bootstrap = await api.bootstrap();
      const [hostsResult, groupsResult] = await Promise.all([api.hosts.list(), api.groups.list()]);
      set({
        booted: true,
        info: bootstrap.info,
        settings: bootstrap.settings,
        vault: bootstrap.vault,
        hosts: hostsResult.hosts,
        groups: groupsResult.groups,
        navCollapsed: bootstrap.settings.ui.navCollapsed
      });
    } catch (error) {
      set({ booted: false, bootError: errorMessage(error) });
    }
  },

  reloadAll: async () => {
    await get().initialize();
  },

  refreshHosts: async () => {
    const { hosts } = await api.hosts.list();
    set({ hosts });
  },

  refreshGroups: async () => {
    const { groups } = await api.groups.list();
    set({ groups });
  },

  refreshSettings: async () => {
    const { settings } = await api.settings.get();
    set({ settings, navCollapsed: settings.ui.navCollapsed });
  },

  upsertHost: (host) =>
    set((state) => {
      const exists = state.hosts.some((item) => item.id === host.id);
      return {
        hosts: exists ? state.hosts.map((item) => (item.id === host.id ? host : item)) : [...state.hosts, host]
      };
    }),

  removeHostLocal: (hostId) =>
    set((state) => ({ hosts: state.hosts.filter((item) => item.id !== hostId) })),

  setView: (view) => {
    try {
      sessionStorage.setItem('fluentssh.view', view);
    } catch {
      // ignore
    }
    set({ view });
  },

  setNavCollapsed: (collapsed) => {
    set({ navCollapsed: collapsed });
    void api.settings.patch({ ui: { navCollapsed: collapsed } }).catch(() => undefined);
  },

  updateSettings: async (patch) => {
    const previous = get().settings;
    if (previous) {
      // Optimistic merge for snappy toggles; server remains the source of truth.
      set({ settings: deepMergeSettings(previous, patch) });
    }
    try {
      const { settings } = await api.settings.patch(patch);
      set({ settings });
    } catch (error) {
      if (previous) set({ settings: previous });
      get().notify('error', '设置保存失败', errorMessage(error));
    }
  },

  setVault: (vault) => set({ vault }),

  lockVault: async () => {
    try {
      const { status } = await api.vault.lock();
      set({ vault: status });
      get().notify('info', '保险库已锁定', '已保存的密码、私钥口令将不可用，直到解锁。');
    } catch (error) {
      get().notify('error', '锁定失败', errorMessage(error));
    }
  },

  unlockVault: async (password) => {
    const { status } = await api.vault.unlock(password);
    set({ vault: status });
    get().notify('success', '保险库已解锁');
  },

  notify: (level, title, message) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, level, title, message }] }));
    window.setTimeout(() => get().dismissToast(id), level === 'error' ? 9000 : 4500);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  setAuthPrompt: (prompt) => set({ authPrompt: prompt }),

  openHostKeyChallenge: (challenge) => set({ hostKeyChallenge: challenge }),

  closeHostKeyChallenge: () => set({ hostKeyChallenge: null })
}));

function deepMergeSettings(base: AppSettings, patch: Record<string, unknown>): AppSettings {
  const result = structuredClone(base) as unknown as Record<string, unknown>;
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object') {
        merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  };
  merge(result, patch);
  return result as unknown as AppSettings;
}

export function notifyFromError(error: unknown, title = '操作失败') {
  useAppStore.getState().notify('error', title, errorMessage(error));
}
