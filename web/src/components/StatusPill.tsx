import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

const useStyles = makeStyles({
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: '20px',
    padding: '0 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    border: '1px solid transparent'
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'currentColor',
    flexShrink: 0
  },
  success: {
    color: tokens.colorPaletteGreenForeground1,
    background: tokens.colorPaletteGreenBackground2,
    border: `1px solid ${tokens.colorPaletteGreenBorder2}`
  },
  warning: {
    color: tokens.colorPaletteYellowForeground1,
    background: tokens.colorPaletteYellowBackground2,
    border: `1px solid ${tokens.colorPaletteYellowBorder2}`
  },
  danger: {
    color: tokens.colorPaletteRedForeground1,
    background: tokens.colorPaletteRedBackground2,
    border: `1px solid ${tokens.colorPaletteRedBorder2}`
  },
  info: {
    color: tokens.colorPaletteBlueForeground2,
    background: tokens.colorPaletteBlueBackground2,
    border: `1px solid ${tokens.colorPaletteBlueBorderActive}`
  },
  neutral: {
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`
  },
  brand: {
    color: tokens.colorBrandForeground1,
    background: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke2}`
  }
});

export interface StatusPillProps {
  tone?: StatusTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}

export function StatusPill({ tone = 'neutral', children, dot, className }: StatusPillProps) {
  const styles = useStyles();
  return (
    <span className={mergeClasses(styles.pill, styles[tone], className)}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}

