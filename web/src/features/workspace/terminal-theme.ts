import type { ITheme } from '@xterm/xterm';

/**
 * Terminal palettes. The terminal keeps a dark "warm charcoal" surface in both
 * app themes — that is deliberate, like every modern SSH client — but the tint,
 * selection and accent colors are tuned per theme so light mode feels like an
 * intentional dark inset rather than a leftover dark-mode artifact.
 */
export const TERMINAL_THEMES: Record<'light' | 'dark', ITheme> = {
  light: {
    background: '#0e141d',
    foreground: '#d8e1ee',
    cursor: '#5aa9f7',
    cursorAccent: '#0e141d',
    selectionBackground: 'rgba(72, 144, 226, 0.34)',
    selectionForeground: '#ffffff',
    selectionInactiveBackground: 'rgba(120, 146, 180, 0.24)',
    black: '#202835',
    red: '#f07178',
    green: '#7fd18b',
    yellow: '#e6c07b',
    blue: '#6cb6ff',
    magenta: '#c79bf2',
    cyan: '#63d4d4',
    white: '#c9d4e3',
    brightBlack: '#5a6879',
    brightRed: '#ff8f95',
    brightGreen: '#9ae5a3',
    brightYellow: '#f2d49b',
    brightBlue: '#8ecbff',
    brightMagenta: '#dbb7ff',
    brightCyan: '#87ebeb',
    brightWhite: '#eef3fa'
  },
  dark: {
    background: '#080c12',
    foreground: '#d5deeb',
    cursor: '#79c0ff',
    cursorAccent: '#080c12',
    selectionBackground: 'rgba(88, 166, 255, 0.32)',
    selectionForeground: '#ffffff',
    selectionInactiveBackground: 'rgba(110, 134, 168, 0.22)',
    black: '#1b222d',
    red: '#ff7b86',
    green: '#85e09a',
    yellow: '#e8c98c',
    blue: '#74baff',
    magenta: '#d0a5ff',
    cyan: '#6fdede',
    white: '#c5d0df',
    brightBlack: '#5f6d80',
    brightRed: '#ff9ba2',
    brightGreen: '#9ff0b1',
    brightYellow: '#f5dcae',
    brightBlue: '#9cd0ff',
    brightMagenta: '#e3c3ff',
    brightCyan: '#93f2f2',
    brightWhite: '#f2f6fb'
  }
};

/** Fallback font stack for hosts without a per-host terminal preference. */
export const TERMINAL_FONT_FALLBACK =
  '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, "Microsoft YaHei UI", monospace';

export function getTerminalTheme(mode: 'light' | 'dark'): ITheme {
  return { ...TERMINAL_THEMES[mode] };
}

/** ANSI-ish colors reused by the command result consoles in the automation UI. */
export const CONSOLE_COLORS = {
  background: '#0b1017',
  foreground: '#d3dce8',
  stdout: '#cfe0d6',
  stderr: '#ff9099',
  meta: '#8b98ab',
  accent: '#79c0ff',
  success: '#85e09a',
  warning: '#e8c98c',
  danger: '#ff7b86',
  border: 'rgba(255, 255, 255, 0.09)'
} as const;
