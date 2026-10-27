import {
  Button,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowSyncRegular,
  DeleteRegular,
  HistoryRegular,
  SearchRegular,
  SettingsRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SectionCard } from '../../components/SectionCard';
import { StatusPill } from '../../components/StatusPill';
import { formatBytes, formatDateTime } from '../../lib/format';
import { useAppStore } from '../../store/app';

type LogEntry = Awaited<ReturnType<typeof api.logs.list>>['logs'][number];

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    padding: '11px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2
  },
  search: { width: '260px', maxWidth: '100%' },
  spacer: { flex: 1, minWidth: '8px' },
  hint: { fontSize: '11px', color: tokens.colorNeutralForeground3 },
  banner: { margin: '12px 16px 0' },
  tableWrap: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '760px', tableLayout: 'fixed' },
  colHost: { width: '28%' },
  colType: { width: '10%' },
  colStarted: { width: '20%' },
  colSession: { width: '22%' },
  colSize: { width: '8%' },
  colActions: { width: '12%' },
  th: {
    fontSize: '10.8px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    color: tokens.colorNeutralForeground3,
    paddingTop: '10px',
    paddingBottom: '10px',
    whiteSpace: 'nowrap'
  },
  td: { verticalAlign: 'middle', paddingTop: '9px', paddingBottom: '9px' },
  row: { ':hover': { background: tokens.colorNeutralBackground2 } },
  hostCell: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  hostName: { fontSize: '13px', fontWeight: 600, color: tokens.colorNeutralForeground1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sub: {
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground4,
    fontFamily: tokens.fontFamilyMonospace,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'block',
    maxWidth: '100%'
  },
  date: { fontSize: '11.5px', color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  size: { fontSize: '11.5px', color: tokens.colorNeutralForeground2, fontFamily: tokens.fontFamilyMonospace, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', alignItems: 'center', gap: '1px', justifyContent: 'flex-end' },
  danger: { color: tokens.colorPaletteRedForeground1 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '44px', color: tokens.colorNeutralForeground3 },
  emptyPad: { padding: '16px' },
  hideMd: { '@media (max-width: 1080px)': { display: 'none' } },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    padding: '9px 16px',
    borderBottom: `1px solid ${tokens.colorPaletteYellowBorder2}`,
    background: tokens.colorPaletteYellowBackground1,
    color: tokens.colorPaletteYellowForeground1,
    fontSize: '12px'
  }
});

function safeFileName(hostLabel: string, startedAt: number): string {
  const base = (hostLabel || 'session').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
  return `${base}-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}.log`;
}

export function SessionLogsTab() {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const setView = useAppStore((state) => state.setView);
  const recordSessions = useAppStore((state) => state.settings?.security.recordSessions);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LogEntry | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.logs.list();
      setLogs(result.logs);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((log) => `${log.hostLabel} ${log.kind} ${log.sessionId}`.toLowerCase().includes(needle));
  }, [logs, query]);

  const totalSize = useMemo(() => logs.reduce((sum, log) => sum + log.size, 0), [logs]);

  const download = (log: LogEntry) => {
    const anchor = document.createElement('a');
    anchor.href = api.logs.downloadUrl(log.sessionId);
    anchor.download = safeFileName(log.hostLabel, log.startedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    notify('info', '开始下载会话记录', `${log.hostLabel} · ${formatBytes(log.size)}`);
  };

  const removeLog = async () => {
    if (!deleteTarget) return;
    try {
      await api.logs.remove(deleteTarget.sessionId);
      setLogs((current) => current.filter((log) => log.sessionId !== deleteTarget.sessionId));
      notify('success', '会话记录已删除', deleteTarget.hostLabel);
    } catch (error) {
      notify('error', '删除会话记录失败', errorMessage(error));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <SectionCard
        title="会话记录"
        subtitle={`${logs.length} 段会话输出 · 共 ${formatBytes(totalSize)} · 保存在本机日志目录`}
        actions={
          <Tooltip content="刷新会话记录" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
              onClick={() => void refresh()}
              aria-label="刷新会话记录"
              data-testid="logs-refresh"
            />
          </Tooltip>
        }
        flush
      >
        {recordSessions === false && (
          <div className={styles.notice}>
            <SettingsRegular />
            <span className="grow">会话记录当前已关闭，新的终端会话不会保存输出。</span>
            <Button appearance="secondary" size="small" onClick={() => setView('settings')}>
              前往设置
            </Button>
          </div>
        )}

        <div className={styles.toolbar}>
          <Input
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            placeholder="搜索主机或会话 ID…"
            contentBefore={<SearchRegular />}
            size="small"
            className={styles.search}
            data-testid="logs-search"
          />
          <span className={styles.spacer} />
          <span className={styles.hint}>终端输出按会话保存在本机，可随时下载或删除。</span>
        </div>

        {loadError && (
          <MessageBar intent="warning" className={styles.banner}>
            <MessageBarBody>
              <MessageBarTitle>会话记录加载失败</MessageBarTitle>
              {loadError}
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => void refresh()}>
                重试
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}

        {loading && logs.length === 0 ? (
          <div className={styles.loading}>
            <Spinner size="small" /> 正在加载会话记录…
          </div>
        ) : logs.length === 0 ? (
          <div className={styles.emptyPad}>
            {!loadError && (
              <EmptyState
                icon={<HistoryRegular />}
                title="还没有会话记录"
                description={
                  recordSessions === false
                    ? '会话记录功能已关闭。在设置 → 安全中开启「记录会话输出」后，新的终端会话会自动保存。'
                    : '打开终端会话后，输出会被记录到本机日志目录，方便回放、排查与归档。'
                }
                actions={
                  <>
                    <Button appearance="secondary" icon={<SettingsRegular />} onClick={() => setView('settings')}>
                      打开设置
                    </Button>
                    <Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => void refresh()}>
                      刷新
                    </Button>
                  </>
                }
              />
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyPad}>
            <EmptyState
              compact
              icon={<SearchRegular />}
              title="没有匹配的会话记录"
              description={`没有主机或会话 ID 匹配「${query}」的记录。`}
              actions={
                <Button appearance="secondary" size="small" onClick={() => setQuery('')}>
                  清除搜索
                </Button>
              }
            />
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <Table size="small" className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={mergeClasses(styles.th, styles.colHost)}>主机</TableHeaderCell>
                  <TableHeaderCell className={mergeClasses(styles.th, styles.colType)}>类型</TableHeaderCell>
                  <TableHeaderCell className={mergeClasses(styles.th, styles.colStarted)}>开始时间</TableHeaderCell>
                  <TableHeaderCell className={mergeClasses(styles.th, styles.colSession, styles.hideMd)}>会话 ID</TableHeaderCell>
                  <TableHeaderCell className={mergeClasses(styles.th, styles.colSize)}>大小</TableHeaderCell>
                  <TableHeaderCell className={mergeClasses(styles.th, styles.colActions)} style={{ textAlign: 'right' }}>
                    操作
                  </TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((log) => (
                  <TableRow key={log.sessionId} className={styles.row} data-testid="log-row">
                    <TableCell className={styles.td}>
                      <div className={styles.hostCell}>
                        <span className={styles.hostName}>{log.hostLabel}</span>
                        <span className={styles.sub}>{safeFileName(log.hostLabel, log.startedAt)}</span>
                      </div>
                    </TableCell>
                    <TableCell className={styles.td}>
                      <StatusPill tone={log.kind === 'terminal' ? 'brand' : 'info'}>
                        {log.kind === 'terminal' ? '终端' : log.kind === 'sftp' ? 'SFTP' : log.kind}
                      </StatusPill>
                    </TableCell>
                    <TableCell className={styles.td}>
                      <span className={styles.date}>{formatDateTime(log.startedAt)}</span>
                    </TableCell>
                    <TableCell className={mergeClasses(styles.td, styles.hideMd)}>
                      <span className={styles.sub}>{log.sessionId}</span>
                    </TableCell>
                    <TableCell className={styles.td}>
                      <span className={styles.size}>{formatBytes(log.size)}</span>
                    </TableCell>
                    <TableCell className={styles.td}>
                      <div className={styles.actions}>
                        <Tooltip content="下载会话输出" relationship="label">
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<ArrowDownloadRegular />}
                            onClick={() => download(log)}
                            aria-label="下载会话记录"
                            data-testid="log-download"
                          />
                        </Tooltip>
                        <Tooltip content="删除会话记录" relationship="label">
                          <Button
                            appearance="subtle"
                            size="small"
                            icon={<DeleteRegular />}
                            onClick={() => setDeleteTarget(log)}
                            aria-label="删除会话记录"
                            className={styles.danger}
                            data-testid="log-delete"
                          />
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除会话记录"
        message={
          deleteTarget
            ? `确定要删除「${deleteTarget.hostLabel}」的会话记录吗？\n文件将从本机日志目录移除，此操作不可撤销。`
            : ''
        }
        confirmLabel="删除记录"
        danger
        onConfirm={removeLog}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
