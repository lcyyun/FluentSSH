import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme
} from '@fluentui/react-components';
import type { AccentName, ThemeMode } from '@shared/types';
import { useEffect, useState } from 'react';
import { useAppStore } from './store/app';

const FONT_FAMILY =
  '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif';
const FONT_MONO =
  '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, "Microsoft YaHei UI", monospace';

function makeRamp(hue: number, saturation: number, lightness: number[]): BrandVariants {
  const ramp = {} as Record<number, string>;
  const keys = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
  keys.forEach((key, index) => {
    const sat = key >= 140 ? saturation * 0.82 : key <= 40 ? saturation * 0.72 : saturation;
    ramp[key] = hslToHex(hue, Math.round(sat), lightness[index]);
  });
  return ramp as unknown as BrandVariants;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Fluent v9 brand ramp convention: brand[10] is the darkest shade and
 * brand[160] the lightest. createLightTheme maps colorBrandBackground to
 * brand[80] and colorBrandBackground2 to brand[160], so this order matters.
 */
const LIGHTNESS = [12, 18, 22, 26, 30, 35, 41, 47, 54, 62, 70, 78, 85, 90, 94, 97];

export const ACCENT_RAMPS: Record<AccentName, BrandVariants> = {
  blue: makeRamp(207, 88, LIGHTNESS),
  teal: makeRamp(178, 74, LIGHTNESS),
  purple: makeRamp(264, 66, LIGHTNESS),
  green: makeRamp(146, 62, LIGHTNESS),
  orange: makeRamp(26, 88, LIGHTNESS),
  pink: makeRamp(334, 74, LIGHTNESS),
  graphite: makeRamp(214, 20, LIGHTNESS)
};

export const ACCENT_LABELS: Record<AccentName, string> = {
  blue: '湖蓝',
  teal: '青碧',
  purple: '紫罗兰',
  green: '森绿',
  orange: '琥珀',
  pink: '品红',
  graphite: '石墨'
};

export const ACCENT_SWATCH: Record<AccentName, string> = {
  blue: '#0f6cbd',
  teal: '#0e7c6b',
  purple: '#6b3fb5',
  green: '#3f7f35',
  orange: '#c65a10',
  pink: '#b42964',
  graphite: '#4b5563'
};

export function buildTheme(mode: 'light' | 'dark', accent: AccentName): Theme {
  const ramp = ACCENT_RAMPS[accent] ?? ACCENT_RAMPS.blue;
  const theme = mode === 'dark' ? createDarkTheme(ramp) : createLightTheme(ramp);
  return {
    ...theme,
    fontFamilyBase: FONT_FAMILY,
    fontFamilyMonospace: FONT_MONO
  };
}

const QUERY = '(prefers-color-scheme: dark)';

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return dark;
}

export function useEffectiveMode(mode: ThemeMode): 'light' | 'dark' {
  const systemDark = useSystemDark();
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

/** Reactive app theme object for the shell. */
export function useAppTheme() {
  const settings = useAppStore((state) => state.settings);
  const mode = useEffectiveMode(settings?.theme ?? 'light');
  const accent = settings?.accent ?? 'blue';
  const theme = buildTheme(mode, accent);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.accent = accent;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#101319' : '#f3f6fb');
  }, [mode, accent]);
  return { theme, mode, accent };
}
