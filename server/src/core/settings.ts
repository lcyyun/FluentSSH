import type {
  AppSettings,
  AccentName,
  ThemeMode
} from '../../../shared/types.js';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  accent: 'blue',
  reduceMotion: false,
  compactMode: false,
  terminal: {
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace',
    fontSize: 14,
    lineHeight: 1.25,
    cursorStyle: 'bar',
    cursorBlink: true,
    scrollback: 10_000,
    bell: false,
    copyOnSelect: false
  },
  security: {
    autoLockMinutes: 0,
    lockOnBrowserBlur: false,
    strictHostKeys: true,
    recordSessions: true
  },
  connections: {
    keepaliveInterval: 20_000,
    connectTimeout: 20_000,
    defaultUsername: 'root',
    defaultPort: 22
  },
  files: {
    showHidden: false,
    confirmDelete: true,
    editorFontSize: 13
  },
  ui: {
    navCollapsed: false,
    hostView: 'grid'
  }
};

export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
export const ACCENTS: AccentName[] = ['blue', 'teal', 'purple', 'green', 'orange', 'pink', 'graphite'];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep merge that only accepts keys already present in the defaults. */
export function mergeSettings(base: AppSettings, patch: unknown): AppSettings {
  if (!isPlainObject(patch)) return base;
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (!(key in target)) continue;
      if (isPlainObject(target[key]) && isPlainObject(value)) {
        out[key] = merge(target[key] as Record<string, unknown>, value);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  const merged = merge(base as unknown as Record<string, unknown>, patch) as unknown as AppSettings;
  merged.theme = THEME_MODES.includes(merged.theme) ? merged.theme : base.theme;
  merged.accent = ACCENTS.includes(merged.accent) ? merged.accent : base.accent;
  merged.security.autoLockMinutes = Math.max(0, Math.min(24 * 60, Number(merged.security.autoLockMinutes) || 0));
  merged.terminal.fontSize = Math.max(9, Math.min(32, Number(merged.terminal.fontSize) || 14));
  merged.terminal.scrollback = Math.max(1000, Math.min(200_000, Number(merged.terminal.scrollback) || 10_000));
  merged.connections.defaultPort = Math.max(1, Math.min(65_535, Number(merged.connections.defaultPort) || 22));
  merged.connections.keepaliveInterval = Math.max(0, Number(merged.connections.keepaliveInterval) || 0);
  merged.connections.connectTimeout = Math.max(1000, Number(merged.connections.connectTimeout) || 20_000);
  merged.files.editorFontSize = Math.max(9, Math.min(32, Number(merged.files.editorFontSize) || 13));
  return merged;
}
