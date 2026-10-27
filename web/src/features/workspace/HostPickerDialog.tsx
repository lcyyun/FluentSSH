import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  DesktopMacRegular,
  DismissRegular,
  FolderOpenRegular,
  SearchRegular,
  StarFilled,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuthType } from '@shared/types';
import { EmptyState } from '../../components/EmptyState';
import { formatRelativeTime, initials } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { openSessionForHost } from './session-actions';

const useStyles = makeStyles({
  surface: { width: '620px', maxWidth: 'calc(100vw - 32px)', padding: 0, overflow: 'hidden' },
  body: { gap: 0, maxHeight: 'min(82vh, 720px)' },
  title: {
    padding: '16px 18px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: `linear-gradient(180deg, ${tokens.colorNeutralBackground2}, ${tokens.colorNeutralBackground1})`
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '15px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1
  },
  subtitle: { display: 'block', fontSize: '11.5px', color: tokens.colorNeutralForeground3, marginTop: '2px', fontWeight: 400 },
  content: { padding: 0, margin: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  searchRow: { padding: '10px 16px 6px', flexShrink: 0 },
  list: { padding: '4px 10px 10px', overflowY: 'auto', minHeight: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '9px',
    cursor: 'pointer',
    border: '1px solid transparent',
    '&:hover': { background: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke2}` }
  },
  avatar: {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    borderRadius: '9px',
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    letterSpacing: '0.2px'
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  favorite: { color: '#e8b339', fontSize: '11px', display: 'flex' },
  rowMeta: {
    marginTop: '2px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  rowTags: { display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' },
  tag: {
    fontSize: '9.5px',
    padding: '0 5px',
    borderRadius: '999px',
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    border: `1px solid ${tokens.colorNeutralStroke3}`
  },
  rowActions: { display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  emptyWrap: { padding: '16px' },
  footer: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    padding: '9px 16px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2,
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3
  }
});

const AUTH_LABELS: Record<AuthType, string> = {
  password: '密码',
  key: '密钥',
  agent: 'Agent',
  'keyboard-interactive': '交互认证'
};

export function HostPickerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const hosts = useAppStore((state) => state.hosts);
  const setView = useAppStore((state) => state.setView);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setBusyId(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...hosts].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0);
    });
    if (!needle) return sorted;
    return sorted.filter((host) =>
      `${host.name} ${host.hostname} ${host.username} ${host.tags.join(' ')} ${host.notes}`.toLowerCase().includes(needle)
    );
  }, [hosts, query]);

  const choose = async (hostId: string, kind: 'terminal' | 'files') => {
    setBusyId(hostId);
    try {
      await openSessionForHost(hostId, kind);
      onClose();
    } finally {
      setBusyId(null);
    }
  };

  const browseHosts = () => {
    onClose();
    setView('hosts');
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.surface} aria-label="选择主机">
        <DialogBody className={styles.body}>
          <DialogTitle
            className={styles.title}
            action={
              <Button
                appearance="subtle"
                size="small"
                icon={<DismissRegular />}
                onClick={onClose}
                aria-label="关闭主机选择"
                data-testid="host-picker-close"
              />
            }
          >
            <span className={styles.titleRow}>
              <WindowConsoleRegular style={{ color: tokens.colorBrandForeground1 }} />
              选择要连接的主机
            </span>
            <span className={styles.subtitle}>打开终端或 SFTP 文件管理标签页</span>
          </DialogTitle>
          <DialogContent className={styles.content}>
            <div className={styles.searchRow}>
              <Input
                ref={inputRef}
                value={query}
                onChange={(_, data) => setQuery(data.value)}
                contentBefore={<SearchRegular />}
                placeholder="按名称、地址、用户或标签筛选…"
                style={{ width: '100%' }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && filtered[0]) void choose(filtered[0].id, 'terminal');
                  if (event.key === 'Escape') onClose();
                }}
                data-testid="host-picker-search"
              />
            </div>
            <div className={styles.list}>
              {hosts.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <EmptyState
                    compact
                    icon={<DesktopMacRegular />}
                    title="还没有保存的主机"
                    description="先添加一台 SSH 主机，就可以在这里快速打开终端或文件管理。"
                    actions={
                      <Button appearance="primary" onClick={browseHosts}>
                        去添加主机
                      </Button>
                    }
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <EmptyState compact title="没有匹配的主机" description="换个关键词试试，或清空筛选条件。" />
                </div>
              ) : (
                filtered.map((host) => {
                  const busy = busyId === host.id;
                  return (
                    <div
                      key={host.id}
                      className={styles.row}
                      onClick={() => void choose(host.id, 'terminal')}
                      data-testid="host-picker-row"
                      data-host-id={host.id}
                    >
                      <span className={mergeClasses(styles.avatar)} style={{ background: host.color || tokens.colorBrandBackground }}>
                        {initials(host.name)}
                      </span>
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>
                          {host.name}
                          {host.favorite && (
                            <span className={styles.favorite}>
                              <StarFilled />
                            </span>
                          )}
                        </span>
                        <span className={styles.rowMeta}>
                          {host.username}@{host.hostname}:{host.port} · {AUTH_LABELS[host.authType]} ·{' '}
                          {host.lastConnectedAt ? formatRelativeTime(host.lastConnectedAt) : '从未连接'}
                        </span>
                        {host.tags.length > 0 && (
                          <span className={styles.rowTags}>
                            {host.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className={styles.tag}>
                                {tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className={styles.rowActions}>
                        <Button
                          appearance="primary"
                          size="small"
                          icon={busy ? <Spinner size="tiny" /> : <WindowConsoleRegular />}
                          onClick={(event) => {
                            event.stopPropagation();
                            void choose(host.id, 'terminal');
                          }}
                          disabled={busy}
                          data-testid="host-picker-terminal"
                        >
                          终端
                        </Button>
                        <Button
                          appearance="secondary"
                          size="small"
                          icon={<FolderOpenRegular />}
                          onClick={(event) => {
                            event.stopPropagation();
                            void choose(host.id, 'files');
                          }}
                          disabled={busy}
                          data-testid="host-picker-files"
                        >
                          文件
                        </Button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
          <DialogActions className={styles.footer} fluid>
            <span>
              <span className="kbd-chip">Enter</span> 连接第一台 · <span className="kbd-chip">Esc</span> 关闭
            </span>
            <span>{hosts.length > 0 ? `${hosts.length} 台主机 · 收藏与最近连接优先` : '支持密码、密钥与交互认证'}</span>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
