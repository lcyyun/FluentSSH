import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: '10px',
    padding: '56px 24px',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: '14px',
    background: `linear-gradient(180deg, ${tokens.colorNeutralBackground2}, ${tokens.colorNeutralBackground1})`
  },
  compact: { padding: '28px 20px', border: `1px solid ${tokens.colorNeutralStroke2}` },
  icon: {
    width: '58px',
    height: '58px',
    borderRadius: '16px',
    display: 'grid',
    placeItems: 'center',
    color: tokens.colorBrandForeground1,
    background: tokens.colorBrandBackground2,
    boxShadow: tokens.shadow4,
    marginBottom: '4px',
    fontSize: '26px'
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1
  },
  description: {
    maxWidth: '480px',
    fontSize: '12.5px',
    lineHeight: 1.6,
    color: tokens.colorNeutralForeground3
  },
  actions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '8px'
  }
});

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, actions, compact }: EmptyStateProps) {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, compact && styles.compact)}>
      {icon && <div className={styles.icon}>{icon}</div>}
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.description}>{description}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

