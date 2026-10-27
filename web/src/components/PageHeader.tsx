import { makeStyles, tokens, Text } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '16px',
    flexWrap: 'wrap'
  },
  heading: {
    flex: 1,
    minWidth: '240px'
  },
  eyebrow: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '1.1px',
    textTransform: 'uppercase',
    color: tokens.colorBrandForeground1,
    marginBottom: '4px'
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap'
  },
  title: {
    margin: 0,
    fontSize: '23px',
    fontWeight: 650,
    letterSpacing: '-0.3px',
    lineHeight: 1.18,
    color: tokens.colorNeutralForeground1
  },
  subtitle: {
    margin: '5px 0 0',
    color: tokens.colorNeutralForeground3,
    fontSize: '12.5px',
    lineHeight: 1.5
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  }
});

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}

export function PageHeader({ title, subtitle, eyebrow, actions, badge }: PageHeaderProps) {
  const styles = useStyles();
  return (
    <div className={styles.header}>
      <div className={styles.heading}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {badge}
        </div>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

