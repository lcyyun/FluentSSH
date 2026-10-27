import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  card: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '12px',
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: `linear-gradient(180deg, ${tokens.colorNeutralBackground2}, ${tokens.colorNeutralBackground1})`
  },
  headerText: { flex: 1, minWidth: 0 },
  title: {
    fontSize: '13.5px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  subtitle: {
    marginTop: '2px',
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground3
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0
  },
  body: { padding: '16px', flex: 1, minHeight: 0 },
  bodyFlush: { padding: 0 },
  footer: {
    padding: '10px 16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2
  }
});

export interface SectionCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function SectionCard({
  title,
  subtitle,
  actions,
  footer,
  children,
  flush,
  className,
  bodyClassName
}: SectionCardProps) {
  const styles = useStyles();
  return (
    <section className={mergeClasses(styles.card, className)}>
      {(title || actions) && (
        <header className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.title}>{title}</div>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={mergeClasses(styles.body, flush && styles.bodyFlush, bodyClassName)}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}

