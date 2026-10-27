import {
  Button,
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
import type { ReactNode } from 'react';
import {
  AddRegular,
  ArrowRoutingRegular,
  ArrowSwapRegular,
  ArrowSyncRegular,
  DataUsageRegular,
  DeleteRegular,
  EditRegular,
  PlayRegular,
  PlugConnectedRegular,
  ServerRegular,
  StopRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TunnelInfo, TunnelInput } from '@shared/types';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { StatusPill } from '../../components/StatusPill';
import { useEventConnection, useServerEvent } from '../../events';
import { formatBytes, formatDateTime, formatDuration } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { TunnelFormDialog } from './TunnelFormDialog';
import {
  TUNNEL_STATUS_META,
  TUNNEL_TYPE_LABELS,
  hostKeyDetailsFromError,
  hostKeyDetailsFromTunnel,
  tunnelRoute,
  tunnelSshCommand,
  tunnelSummary,
  tunnelTypeTone
} from './tunnel-utils';

const useStyles = makeStyles({
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
    gap: '10px'
  },
  tile: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '13px 15px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    minWidth: 0
  },
  tileIcon: {
    width: '38px',
    height: '38px',
    flex: '0 0 38px',
    borderRadius: '10px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '19px'
  },
  tileIconSuccess: { background: tokens.colorPaletteGreenBackground2, color: tokens.colorPaletteGreenForeground1 },
  tileIconInfo: { background: tokens.colorPaletteBlueBackground2, color: tokens.colorPaletteBlueForeground2 },
  tileIconWarning: { background: tokens.colorPaletteYellowBackground2, color: tokens.colorPaletteYellowForeground1 },
  tileIconDanger: { background: tokens.colorPaletteRedBackground2, color: tokens.colorPaletteRedForeground1 },
  tileBody: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
  tileLabel: { fontSize: '11.5px', color: tokens.colorNeutralForeground3 },
  tileValue: {
    fontSize: '21px',
    fontWeight: 600,
    letterSpacing: '-0.4px',
    lineHeight: 1.15,
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: 'tabular-nums'
  },
  tileHint: {
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground4,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  banner: { marginBottom: '2px' },
  tableWrap: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '940px', tableLayout: 'fixed' },
  colName: { width: '22%' },
  colType: { width: '8%' },
  colRoute: { width: '23%' },
  colStatus: { width: '14%' },
  colConnections: { width: '6%' },
  colTraffic: { width: '8%' },
  colStarted: { width: '7%' },
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
  td: {
    verticalAlign: 'middle',
    paddingTop: '10px',
    paddingBottom: '10px'
  },
  row: {
    ':hover': { background: tokens.colorNeutralBackground2 }
  },
  nameCell: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '150px' },
  nameRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  tunnelName: { fontSize: '13px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  autoTag: {
    fontSize: '9.5px',
    fontWeight: 600,
    padding: '0 5px',
    height: '15px',
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '4px',
    color: tokens.colorBrandForeground1,
    background: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke2}`,
    letterSpacing: '0.2px'
  },
  subRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap'
  },
  routeCell: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '180px' },
  routeMain: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground1
  },
  routeEnd: {
    padding: '1px 5px',
    borderRadius: '4px',
    background: tokens.colorNeutralBackground3,
    flexShrink: 0
  },
  routeArrow: { color: tokens.colorNeutralForeground3, fontSize: '10.5px' },
  routeLabel: { fontSize: '10.5px', color: tokens.colorNeutralForeground4 },
  statusCell: { display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start', minWidth: '96px' },
  rowError: {
    maxWidth: '190px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '10.5px',
    color: tokens.colorPaletteRedForeground1
  },
  counter: { fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', color: tokens.colorNeutralForeground1 },
  trafficCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.colorNeutralForeground2,
    fontFamily: tokens.fontFamilyMonospace
  },
  startedCell: { fontSize: '11.5px', color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', alignItems: 'center', gap: '1px', justifyContent: 'flex-end' },
  danger: { color: tokens.colorPaletteRedForeground1 },
  hideLg: { '@media (max-width: 1220px)': { display: 'none' } },
  hideMd: { '@media (max-width: 1020px)': { display: 'none' } },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px', color: tokens.colorNeutralForeground3 },
  emptyPad: { padding: '16px' },
  errorState: { padding: '14px 16px' }
});

type TileTone = 'success' | 'info' | 'warning' | 'danger';

function SummaryTile({
  icon,
  tone,
  label,
  value,
  hint
}: {
  icon: ReactNode;
  tone: TileTone;
  label: string;
  value: ReactNode;
  hint: ReactNode;
}) {
  const styles = useStyles();
  const toneClass =
    tone === 'success'
      ? styles.tileIconSuccess
      : tone === 'warning'
        ? styles.tileIconWarning
        : tone === 'danger'
          ? styles.tileIconDanger
          : styles.tileIconInfo;
  return (
    <div className={styles.tile} data-testid={`tunnel-summary-${tone}`}>
      <span className={mergeClasses(styles.tileIcon, toneClass)}>{icon}</span>
      <span className={styles.tileBody}>
        <span className={styles.tileLabel}>{label}</span>
        <span className={styles.tileValue}>{value}</span>
        <span className={styles.tileHint}>{hint}</span>
      </span>
    </div>
  );
}

export default function TunnelsPage() {
  const styles = useStyles();
  const hosts = useAppStore((state) => state.hosts);
  const setView = useAppStore((state) => state.setView);
  const notify = useAppStore((state) => state.notify);

  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TunnelInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TunnelInfo | null>(null);
  const [, setTick] = useState(0);
  const errorsRef = useRef<Map<string, string | null>>(new Map());
  const lastErrorNoticeRef = useRef<Map<string, { message: string; at: number }>>(new Map());

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await api.tunnels.list();
      setTunnels(result.tunnels);
      errorsRef.current = new Map(result.tunnels.map((tunnel) => [tunnel.id, tunnel.error]));
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

  // Keep "running for" durations fresh without re-fetching.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const upsertTunnel = useCallback((tunnel: TunnelInfo) => {
    setTunnels((current) => {
      const index = current.findIndex((item) => item.id === tunnel.id);
      if (index === -1) return [...current, tunnel];
      const next = [...current];
      next[index] = tunnel;
      return next;
    });
    errorsRef.current.set(tunnel.id, tunnel.error);
  }, []);

  const setRowBusy = useCallback((id: string, action: string | null) => {
    setBusy((current) => {
      const next = { ...current };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  }, []);

  /** Toasts once per distinct error, whether it comes from the HTTP call or the event stream. */
  const notifyTunnelError = useCallback(
    (tunnel: TunnelInfo, message: string | null | undefined, title = '运行异常') => {
      const text = message ?? '未知错误';
      const last = lastErrorNoticeRef.current.get(tunnel.id);
      const now = Date.now();
      if (last && last.message === text && now - last.at < 4000) return;
      lastErrorNoticeRef.current.set(tunnel.id, { message: text, at: now });
      notify('error', `隧道「${tunnel.name}」${title}`, text);
    },
    [notify]
  );

  const startTunnel = useCallback(
    async (tunnel: TunnelInfo, retried = false) => {
      setRowBusy(tunnel.id, 'start');
      try {
        const { tunnel: updated } = await api.tunnels.start(tunnel.id);
        upsertTunnel(updated);
        if (updated.status === 'error') {
          notifyTunnelError(tunnel, updated.error, '启动失败');
        } else {
          lastErrorNoticeRef.current.delete(tunnel.id);
          notify('success', retried ? '隧道已启动（已信任主机密钥）' : '隧道已启动', tunnelSummary(updated));
        }
      } catch (error) {
        const details = hostKeyDetailsFromError(error);
        if (details) {
          useAppStore.getState().openHostKeyChallenge({
            details: { ...details, hostLabel: tunnel.hostName },
            retry: async () => {
              await startTunnel(tunnel, true);
            }
          });
          notify('warning', '需要验证 SSH 主机密钥', '确认指纹并信任后，将自动重试启动该隧道。');
        } else {
          notifyTunnelError(tunnel, errorMessage(error), '启动失败');
          void refresh(true);
        }
      } finally {
        setRowBusy(tunnel.id, null);
      }
    },
    [notify, notifyTunnelError, refresh, setRowBusy, upsertTunnel]
  );

  const stopTunnel = useCallback(
    async (tunnel: TunnelInfo) => {
      setRowBusy(tunnel.id, 'stop');
      try {
        const { tunnel: updated } = await api.tunnels.stop(tunnel.id);
        upsertTunnel(updated);
        notify('info', '隧道已停止', tunnel.name);
      } catch (error) {
        notify('error', `停止隧道「${tunnel.name}」失败`, errorMessage(error));
        void refresh(true);
      } finally {
        setRowBusy(tunnel.id, null);
      }
    },
    [notify, refresh, setRowBusy, upsertTunnel]
  );

  useServerEvent(
    useCallback(
      (event) => {
        if (event.type !== 'tunnel.updated') return;
        const tunnel = event.tunnel;
        const previous = errorsRef.current.get(tunnel.id) ?? null;
        upsertTunnel(tunnel);
        if (tunnel.status === 'error' && tunnel.error && tunnel.error !== previous) {
          const details = hostKeyDetailsFromTunnel(tunnel);
          if (details) {
            useAppStore.getState().openHostKeyChallenge({
              details: { ...details, hostLabel: tunnel.hostName },
              retry: async () => {
                await startTunnel(tunnel);
              }
            });
          } else {
            notifyTunnelError(tunnel, tunnel.error);
          }
        }
      },
      [notifyTunnelError, startTunnel, upsertTunnel]
    )
  );

  // Poll fallback when the realtime socket is offline.
  const eventStatus = useEventConnection((state) => state.status);
  useEffect(() => {
    if (eventStatus === 'online') return;
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [eventStatus, refresh]);

  const activeCount = tunnels.filter((tunnel) => tunnel.status === 'active').length;
  const startingCount = tunnels.filter((tunnel) => tunnel.status === 'starting').length;
  const stoppedCount = tunnels.filter((tunnel) => tunnel.status === 'stopped').length;
  const errorCount = tunnels.filter((tunnel) => tunnel.status === 'error').length;
  const connections = tunnels.reduce((total, tunnel) => total + tunnel.connections, 0);
  const bytesIn = tunnels.reduce((total, tunnel) => total + tunnel.bytesIn, 0);
  const bytesOut = tunnels.reduce((total, tunnel) => total + tunnel.bytesOut, 0);
  const hostFor = (tunnel: TunnelInfo) => hosts.find((host) => host.id === tunnel.hostId);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (tunnel: TunnelInfo) => {
    if (tunnel.status === 'active' || tunnel.status === 'starting') {
      notify('warning', '请先停止隧道', '运行中的隧道不能编辑，请先停止后再修改配置。');
      return;
    }
    setEditing(tunnel);
    setDialogOpen(true);
  };

  const submitForm = async (input: TunnelInput) => {
    if (editing) {
      const { tunnel } = await api.tunnels.update(editing.id, input);
      upsertTunnel(tunnel);
      notify('success', '隧道配置已更新', tunnel.name);
      return;
    }
    const { tunnel } = await api.tunnels.create(input);
    setTunnels((current) => [...current, tunnel]);
    errorsRef.current.set(tunnel.id, tunnel.error);
    notify('success', '隧道已创建', input.autoStart ? '已设为自动启动，正在尝试建立连接。' : '可在隧道列表中手动启动。');
    if (tunnel.autoStart) void startTunnel(tunnel);
  };

  const deleteTunnel = async () => {
    if (!deleteTarget) return;
    try {
      await api.tunnels.remove(deleteTarget.id);
      setTunnels((current) => current.filter((tunnel) => tunnel.id !== deleteTarget.id));
      errorsRef.current.delete(deleteTarget.id);
      notify('success', '隧道已删除', deleteTarget.name);
      setDeleteTarget(null);
    } catch (error) {
      notify('error', '删除隧道失败', errorMessage(error));
    }
  };

  return (
    <div className="view-scroll">
      <div className="page">
        <PageHeader
          eyebrow="Networking"
          title="SSH 隧道"
          subtitle="本地转发、远程转发与 SOCKS5 动态代理，连接状态实时更新。"
          badge={
            <StatusPill tone={activeCount > 0 ? 'success' : 'neutral'} dot>
              {activeCount > 0 ? `${activeCount} 条运行中` : '全部空闲'}
            </StatusPill>
          }
          actions={
            <>
              <Tooltip content="刷新隧道状态" relationship="label">
                <Button
                  appearance="subtle"
                  icon={<ArrowSyncRegular />}
                  onClick={() => void refresh()}
                  aria-label="刷新隧道"
                  disabled={loading}
                  data-testid="tunnel-refresh"
                />
              </Tooltip>
              <Button appearance="primary" icon={<AddRegular />} onClick={openCreate} data-testid="tunnel-create">
                新建隧道
              </Button>
            </>
          }
        />

        <div className={styles.summary}>
          <SummaryTile
            icon={<PlugConnectedRegular />}
            tone="success"
            label="运行中的隧道"
            value={activeCount}
            hint={startingCount > 0 ? `${startingCount} 条启动中 · 共 ${tunnels.length} 条` : `共 ${tunnels.length} 条隧道配置`}
          />
          <SummaryTile
            icon={<DataUsageRegular />}
            tone="info"
            label="活动连接"
            value={connections}
            hint="经隧道建立的转发连接数"
          />
          <SummaryTile
            icon={<ArrowSwapRegular />}
            tone="warning"
            label="累计流量"
            value={formatBytes(bytesIn + bytesOut)}
            hint={`↓ ${formatBytes(bytesIn)} · ↑ ${formatBytes(bytesOut)}`}
          />
          <SummaryTile
            icon={<ArrowRoutingRegular />}
            tone={errorCount > 0 ? 'danger' : 'info'}
            label={errorCount > 0 ? '运行异常' : '已停止'}
            value={errorCount > 0 ? errorCount : stoppedCount}
            hint={errorCount > 0 ? `${stoppedCount} 条已停止，查看行内错误信息` : '空闲隧道，随时可以启动'}
          />
        </div>

        {loadError && (
          <MessageBar intent="warning" className={styles.banner}>
            <MessageBarBody>
              <MessageBarTitle>隧道列表加载失败</MessageBarTitle>
              {loadError}
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => void refresh()}>
                重试
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}

        <SectionCard
          title="隧道列表"
          subtitle={`${tunnels.length} 条配置 · ${activeCount} 条运行中${startingCount > 0 ? ` · ${startingCount} 条启动中` : ''}`}
          actions={
            <Tooltip content="刷新" relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                onClick={() => void refresh()}
                aria-label="刷新隧道列表"
              />
            </Tooltip>
          }
          flush
        >
          {loading && tunnels.length === 0 ? (
            <div className={styles.loading}>
              <Spinner size="small" /> 正在加载隧道…
            </div>
          ) : tunnels.length === 0 ? (
            <div className={styles.emptyPad}>
              {loadError ? (
                <div className={styles.errorState}>
                  <MessageBar intent="warning">
                    <MessageBarBody>后端隧道接口暂不可用，请稍后重试。</MessageBarBody>
                  </MessageBar>
                </div>
              ) : (
                <EmptyState
                  icon={<ArrowRoutingRegular />}
                  title="还没有 SSH 隧道"
                  description="创建本地或远程端口转发，或启动一个 SOCKS5 代理，把远端网络带到本机。"
                  actions={
                    <Button appearance="primary" icon={<AddRegular />} onClick={openCreate} data-testid="tunnel-empty-create">
                      新建第一条隧道
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <Table size="small" className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colName)}>隧道</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colType)}>类型</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colRoute)}>转发链路</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colStatus)}>状态</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colConnections, styles.hideMd)}>连接</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colTraffic, styles.hideLg)}>流量</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colStarted, styles.hideLg)}>运行时长</TableHeaderCell>
                    <TableHeaderCell className={mergeClasses(styles.th, styles.colActions)} style={{ textAlign: 'right' }}>
                      操作
                    </TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tunnels.map((tunnel) => {
                    const status = TUNNEL_STATUS_META[tunnel.status];
                    const route = tunnelRoute(tunnel);
                    const routeLabel =
                      tunnel.type === 'local'
                        ? '本机监听 → 目标'
                        : tunnel.type === 'remote'
                          ? '远端监听 ← 本机目标'
                          : '本机 SOCKS5 代理';
                    const rowBusy = busy[tunnel.id];
                    const running = tunnel.status === 'active' || tunnel.status === 'starting';
                    return (
                      <TableRow key={tunnel.id} className={styles.row} data-testid="tunnel-row">
                        <TableCell className={styles.td}>
                          <div className={styles.nameCell}>
                            <div className={styles.nameRow}>
                              <span className={styles.tunnelName}>{tunnel.name}</span>
                              {tunnel.autoStart && <span className={styles.autoTag}>自动</span>}
                            </div>
                            <span className={styles.subRow}>
                              <ServerRegular /> {tunnel.hostName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <StatusPill tone={tunnelTypeTone(tunnel.type)}>{TUNNEL_TYPE_LABELS[tunnel.type]}</StatusPill>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <div className={styles.routeCell}>
                            <div className={styles.routeMain}>
                              <span className={styles.routeEnd}>{route.from}</span>
                              <span className={styles.routeArrow}>{tunnel.type === 'dynamic' ? '→ SOCKS5' : '→'}</span>
                              {route.to && <span className={styles.routeEnd}>{route.to}</span>}
                            </div>
                            <span className={styles.routeLabel}>{routeLabel}</span>
                          </div>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <div className={styles.statusCell}>
                            <StatusPill tone={status.tone} dot>
                              {status.label}
                            </StatusPill>
                            {tunnel.error && (
                              <Tooltip content={tunnel.error} relationship="description">
                                <span className={styles.rowError}>{tunnel.error}</span>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={mergeClasses(styles.td, styles.hideMd)}>
                          <span className={styles.counter}>{tunnel.connections}</span>
                        </TableCell>
                        <TableCell className={mergeClasses(styles.td, styles.hideLg)}>
                          <div className={styles.trafficCell}>
                            <span>↓ {formatBytes(tunnel.bytesIn)}</span>
                            <span>↑ {formatBytes(tunnel.bytesOut)}</span>
                          </div>
                        </TableCell>
                        <TableCell className={mergeClasses(styles.td, styles.hideLg)}>
                          <Tooltip
                            content={tunnel.startedAt ? `启动于 ${formatDateTime(tunnel.startedAt)}` : '尚未启动'}
                            relationship="description"
                          >
                            <span className={styles.startedCell}>
                              {tunnel.startedAt ? formatDuration(Date.now() - tunnel.startedAt) : '—'}
                            </span>
                          </Tooltip>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <div className={styles.actions}>
                            {running ? (
                              <Tooltip content={tunnel.status === 'starting' ? '正在启动…' : '停止隧道'} relationship="label">
                                <Button
                                  appearance="subtle"
                                  size="small"
                                  icon={rowBusy === 'stop' ? <Spinner size="tiny" /> : <StopRegular />}
                                  onClick={() => void stopTunnel(tunnel)}
                                  disabled={Boolean(rowBusy) || tunnel.status === 'starting'}
                                  aria-label="停止隧道"
                                  data-testid="tunnel-stop"
                                />
                              </Tooltip>
                            ) : (
                              <Tooltip content="启动隧道" relationship="label">
                                <Button
                                  appearance="subtle"
                                  size="small"
                                  icon={rowBusy === 'start' ? <Spinner size="tiny" /> : <PlayRegular />}
                                  onClick={() => void startTunnel(tunnel)}
                                  disabled={Boolean(rowBusy)}
                                  aria-label="启动隧道"
                                  data-testid="tunnel-start"
                                />
                              </Tooltip>
                            )}
                            <Tooltip content="编辑配置" relationship="label">
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={<EditRegular />}
                                onClick={() => openEdit(tunnel)}
                                disabled={Boolean(rowBusy)}
                                aria-label="编辑隧道"
                                data-testid="tunnel-edit"
                              />
                            </Tooltip>
                            <span data-testid="tunnel-copy">
                              <CopyButton
                                value={tunnelSshCommand(tunnel, hostFor(tunnel))}
                                successMessage="SSH 命令已复制"
                                tooltip="复制等价 SSH 命令"
                                quiet
                                size="small"
                              />
                            </span>
                            <Tooltip content="删除隧道" relationship="label">
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={rowBusy === 'delete' ? <Spinner size="tiny" /> : <DeleteRegular />}
                                onClick={() => setDeleteTarget(tunnel)}
                                disabled={Boolean(rowBusy)}
                                aria-label="删除隧道"
                                className={styles.danger}
                                data-testid="tunnel-delete"
                              />
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>

      <TunnelFormDialog
        open={dialogOpen}
        editing={editing}
        hosts={hosts}
        onDismiss={() => setDialogOpen(false)}
        onSubmit={submitForm}
        onManageHosts={() => {
          setDialogOpen(false);
          setView('hosts');
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除隧道"
        message={
          deleteTarget
            ? `确定要删除隧道「${deleteTarget.name}」吗？\n${tunnelSummary(deleteTarget)}\n运行中的隧道会被先停止，此操作不可撤销。`
            : ''
        }
        confirmLabel="删除隧道"
        danger
        onConfirm={deleteTunnel}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
