import { Button, Spinner, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  CopyRegular,
  DismissRegular,
  FolderOpenRegular,
  ShieldKeyholeRegular,
  SquareMultipleRegular,
  StarFilled,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HostProfile } from '@shared/types';
import { EmptyState } from '../../components/EmptyState';
import { formatRelativeTime, initials } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { FileManagerTab } from '../files/FileManagerTab';
import { HostPickerDialog } from './HostPickerDialog';
import {
  closeTab,
  duplicateTab,
  hydrateWorkspaceSessions,
  isHostKeyErrorCode,
  openSessionForHost,
  reconnectTab,
  requestHostKeyRetry,
  useSessionEvents
} from './session-actions';
import type { WorkspaceTab } from './store';
import { useWorkspaceStore } from './store';
import { TerminalView } from './TerminalView';

/** Keyframes injected once by the workspace page (Griffel styles can only reference global names). */
const WORKSPACE_KEYFRAMES = `
@keyframes wsPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.42; } }
@keyframes wsBellFlash { 0% { background: rgba(255, 255, 255, 0.16); } 100% { background: transparent; } }
@keyframes wsMenuIn { from { opacity: 0; transform: translateY(-3px) scale(0.985); } to { opacity: 1; transform: none; } }
`;

const useStyles = makeStyles({
  root: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    background: 'transparent'
  },
  tabbar: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px',
    padding: '7px 10px 0',
    minHeight: '46px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    flexShrink: 0
  },
  tabsScroll: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'flex-end',
    gap: '3px',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: '0',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' }
  },
  tab: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    height: '34px',
    padding: '0 8px 0 11px',
    minWidth: '132px',
    maxWidth: '236px',
    border: `1px solid transparent`,
    borderBottom: 'none',
    borderRadius: '9px 9px 0 0',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontSize: '12px',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    transitionProperty: 'background, color, border-color',
    transitionDuration: '0.14s',
    outline: 'none',
    '&:hover': {
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.colorBrandStroke1}`,
      outlineOffset: '-2px'
    }
  },
  tabActive: {
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderBottom: 'none',
    boxShadow: '0 -2px 0 0 var(--brand-80, #0f6cbd) inset, 0 -6px 18px rgba(15, 108, 189, 0.10)',
    fontWeight: 600
  },
  tabIcon: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '14px',
    flexShrink: 0,
    color: tokens.colorNeutralForeground3
  },
  tabIconActive: { color: tokens.colorBrandForeground1 },
  tabTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1
  },
  statusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: 0,
    background: '#9aa5b4'
  },
  dotOnline: { background: '#2fbd82', boxShadow: '0 0 0 3px rgba(47, 189, 130, 0.14)' },
  dotPending: {
    background: '#e0a93d',
    animationName: 'wsPulse',
    animationDuration: '1.6s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out'
  },
  dotError: { background: '#e05a4e', boxShadow: '0 0 0 3px rgba(224, 90, 78, 0.14)' },
  dotOffline: { background: '#9aa5b4' },
  tabClose: {
    display: 'grid',
    placeItems: 'center',
    width: '19px',
    height: '19px',
    borderRadius: '5px',
    border: 'none',
    background: 'transparent',
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    padding: 0,
    fontSize: '11px',
    flexShrink: 0,
    opacity: 0,
    transitionProperty: 'opacity, background, color',
    transitionDuration: '0.12s',
    '&:hover': { background: tokens.colorNeutralBackground4, color: tokens.colorNeutralForeground1 }
  },
  tabCloseVisible: { opacity: 1 },
  tabSpinner: { flexShrink: 0 },
  tabActions: { display: 'flex', alignItems: 'center', gap: '2px', paddingBottom: '6px', flexShrink: 0 },
  iconButton: {
    display: 'grid',
    placeItems: 'center',
    width: '30px',
    height: '30px',
    border: '1px solid transparent',
    borderRadius: '8px',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    cursor: 'pointer',
    fontSize: '15px',
    padding: 0,
    '&:hover': {
      background: tokens.colorNeutralBackground3,
      color: tokens.colorNeutralForeground1,
      border: `1px solid ${tokens.colorNeutralStroke2}`
    }
  },
  content: { flex: 1, minHeight: 0, position: 'relative', background: 'var(--terminal-bg)' },
  tabPanel: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0
  },
  tabPanelHidden: { display: 'none' },
  panelSurface: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: tokens.colorNeutralBackground2 },
  pendingPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    background: 'var(--terminal-bg)',
    color: '#c8d3e2'
  },
  pendingTitle: { fontSize: '14px', fontWeight: 600 },
  pendingSub: { fontSize: '11.5px', color: '#8492a6', fontFamily: tokens.fontFamilyMonospace },
  /* ---------------------------------------------------------------- */
  /* Empty workspace                                                  */
  /* ---------------------------------------------------------------- */
  emptyRoot: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '30px 30px 40px'
  },
  emptyInner: { maxWidth: '1120px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' },
  hero: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    padding: '26px 28px',
    borderRadius: '16px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: `radial-gradient(800px 240px at 0% -40%, color-mix(in srgb, ${tokens.colorBrandBackground} 18%, transparent), transparent 70%), linear-gradient(180deg, ${tokens.colorNeutralBackground1}, ${tokens.colorNeutralBackground2})`,
    boxShadow: tokens.shadow4,
    flexWrap: 'wrap',
    overflow: 'hidden'
  },
  heroMark: {
    width: '54px',
    height: '54px',
    borderRadius: '15px',
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    background: 'linear-gradient(140deg, #3d9cf5 0%, #0f6cbd 55%, #0a4f8f 100%)',
    boxShadow: '0 12px 26px rgba(15, 108, 189, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.35)',
    fontSize: '24px',
    flexShrink: 0
  },
  heroText: { flex: 1, minWidth: '260px' },
  heroEyebrow: {
    fontSize: '10.5px',
    fontWeight: 700,
    letterSpacing: '1.4px',
    textTransform: 'uppercase',
    color: tokens.colorBrandForeground1,
    marginBottom: '3px'
  },
  heroTitle: {
    margin: 0,
    fontSize: '25px',
    fontWeight: 650,
    letterSpacing: '-0.4px',
    color: tokens.colorNeutralForeground1,
    lineHeight: 1.15
  },
  heroSub: {
    margin: '7px 0 0',
    fontSize: '12.5px',
    lineHeight: 1.6,
    color: tokens.colorNeutralForeground3,
    maxWidth: '560px'
  },
  heroActions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '-6px'
  },
  sectionTitle: { fontSize: '13.5px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  sectionHint: { fontSize: '11px', color: tokens.colorNeutralForeground3 },
  quickGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '10px'
  },
  hostCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '11px',
    padding: '11px 12px',
    borderRadius: '11px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
    transitionProperty: 'background, border-color, box-shadow, transform',
    transitionDuration: '0.15s',
    '&:hover': {
      background: tokens.colorNeutralBackground1Hover,
      border: `1px solid ${tokens.colorNeutralStroke1Hover}`,
      boxShadow: tokens.shadow4
    },
    '&:focus-visible': { outline: `2px solid ${tokens.colorBrandStroke1}`, outlineOffset: '1px' }
  },
  hostAvatar: {
    width: '38px',
    height: '38px',
    borderRadius: '11px',
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    flexShrink: 0
  },
  hostText: { flex: 1, minWidth: 0 },
  hostName: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '12.5px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  hostFavorite: { color: '#e8b339', fontSize: '11px', display: 'flex' },
  hostMeta: {
    fontSize: '11px',
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginTop: '2px'
  },
  hostFoot: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' },
  hostConn: { fontSize: '10px', color: tokens.colorNeutralForeground4 },
  hostActions: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 },
  hostActionBtn: {
    display: 'grid',
    placeItems: 'center',
    width: '28px',
    height: '28px',
    border: '1px solid transparent',
    borderRadius: '7px',
    background: 'transparent',
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    fontSize: '14px',
    padding: 0,
    '&:hover': { background: tokens.colorNeutralBackground3, color: tokens.colorBrandForeground1, border: `1px solid ${tokens.colorNeutralStroke2}` }
  },
  tipsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' },
  tipCard: {
    padding: '13px 14px',
    borderRadius: '11px',
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
    gap: '5px'
  },
  tipTitle: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  tipText: { fontSize: '11px', lineHeight: 1.6, color: tokens.colorNeutralForeground3 },
  kbdRow: { display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' },
  /* ---------------------------------------------------------------- */
  /* Context menu                                                     */
  /* ---------------------------------------------------------------- */
  contextMenu: {
    position: 'fixed',
    zIndex: 1200,
    minWidth: '208px',
    padding: '5px',
    borderRadius: '10px',
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: tokens.shadow16,
    animationName: 'wsMenuIn',
    animationDuration: '0.12s',
    animationTimingFunction: 'ease-out'
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    width: '100%',
    padding: '7px 9px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontSize: '12px',
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': { background: tokens.colorNeutralBackground3 },
    '&:disabled': { color: tokens.colorNeutralForeground4, cursor: 'default', background: 'transparent' }
  },
  menuItemDanger: { color: tokens.colorPaletteRedForeground1 },
  menuIcon: { display: 'flex', fontSize: '14px', color: tokens.colorNeutralForeground3 },
  menuDivider: { height: '1px', margin: '4px 6px', background: tokens.colorNeutralStroke3 },
  menuHeader: {
    padding: '5px 9px 6px',
    fontSize: '10px',
    color: tokens.colorNeutralForeground4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
});

function tabTone(tab: WorkspaceTab): string {
  switch (tab.state) {
    case 'connected':
      return 'online';
    case 'connecting':
    case 'awaiting-auth':
      return 'pending';
    case 'error':
      return 'error';
    default:
      return 'offline';
  }
}

function TerminalIcon({ kind }: { kind: WorkspaceTab['kind'] }) {
  return kind === 'files' ? <FolderOpenRegular /> : <WindowConsoleRegular />;
}

export default function WorkspacePage() {
  useSessionEvents();
  const styles = useStyles();
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const setActive = useWorkspaceStore((state) => state.setActive);
  const hosts = useAppStore((state) => state.hosts);
  const setView = useAppStore((state) => state.setView);
  const notify = useAppStore((state) => state.notify);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [runnerTabs, setRunnerTabs] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;

  /* hydrate sessions that already exist server-side (browser refresh etc.) */
  useEffect(() => {
    void hydrateWorkspaceSessions();
  }, []);

  /* palette / other features dispatch custom events to open sessions */
  useEffect(() => {
    const onOpenHost = (event: Event) => {
      const detail = (event as CustomEvent<{ hostId?: string; action?: string }>).detail;
      if (!detail?.hostId) return;
      void openSessionForHost(detail.hostId, detail.action === 'files' ? 'files' : 'terminal');
    };
    const onOpenFiles = () => {
      const state = useWorkspaceStore.getState();
      const current = state.tabs.find((tab) => tab.id === state.activeId);
      const hostId = current?.hostId ?? useAppStore.getState().hosts[0]?.id;
      if (hostId) void openSessionForHost(hostId, 'files');
      else setPickerOpen(true);
    };
    window.addEventListener('fluentssh:open-host', onOpenHost as EventListener);
    window.addEventListener('fluentssh:open-files', onOpenFiles as EventListener);
    return () => {
      window.removeEventListener('fluentssh:open-host', onOpenHost as EventListener);
      window.removeEventListener('fluentssh:open-files', onOpenFiles as EventListener);
    };
  }, []);

  /* keep the active tab valid when tabs are closed */
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!activeId || !tabs.some((tab) => tab.id === activeId)) {
      setActive(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId, setActive]);

  /* prune command-runner panels for closed tabs */
  useEffect(() => {
    setRunnerTabs((previous) => {
      const next = previous.filter((id) => tabs.some((tab) => tab.id === id && tab.kind === 'terminal'));
      return next.length === previous.length ? previous : next;
    });
  }, [tabs]);

  const cycleTab = useCallback(
    (direction: 1 | -1) => {
      const state = useWorkspaceStore.getState();
      if (state.tabs.length < 2) return;
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
      const next = (index + direction + state.tabs.length) % state.tabs.length;
      state.setActive(state.tabs[next].id);
    },
    []
  );

  /* workspace keyboard shortcuts */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      const target = event.target as HTMLElement | null;
      const inTerminal = Boolean(target?.closest?.('.xterm'));
      const inField = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest?.('[role="dialog"]'))
      );
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        cycleTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (!event.shiftKey && event.key.toLowerCase() === 'w') {
        if (inField && !inTerminal) return;
        const state = useWorkspaceStore.getState();
        if (!state.activeId) return;
        event.preventDefault();
        event.stopPropagation();
        void closeTab(state.activeId);
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'f') {
        const state = useWorkspaceStore.getState();
        if (!state.activeId) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('fluentssh:terminal-search', { detail: { tabId: state.activeId } }));
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cycleTab]);

  /* context menu dismissal */
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    const onScroll = () => setContextMenu(null);
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [contextMenu]);

  const toggleRunner = useCallback((tabId: string) => {
    setRunnerTabs((previous) =>
      previous.includes(tabId) ? previous.filter((id) => id !== tabId) : [...previous, tabId]
    );
  }, []);

  const openHost = (host: HostProfile, kind: 'terminal' | 'files') => {
    void openSessionForHost(host.id, kind);
  };

  const quickHosts = useMemo(() => {
    return [...hosts]
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0);
      })
      .slice(0, 6);
  }, [hosts]);

  const closeContextMenu = () => setContextMenu(null);

  const contextTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) ?? null : null;

  const runMenuAction = (action: () => unknown) => {
    closeContextMenu();
    void action();
  };

  const copySshCommand = (tab: WorkspaceTab) => {
    const command = `ssh ${tab.username}@${tab.hostname} -p ${tab.port}`;
    void navigator.clipboard
      .writeText(command)
      .then(() => notify('success', '已复制 SSH 命令', command))
      .catch(() => notify('error', '复制失败', '浏览器拒绝了剪贴板访问。'));
  };

  const empty = tabs.length === 0;

  return (
    <div className={styles.root} data-testid="workspace-page">
      <style>{WORKSPACE_KEYFRAMES}</style>

      {empty ? (
        <div className={styles.emptyRoot} data-testid="workspace-empty">
          <div className={styles.emptyInner}>
            <div className={styles.hero}>
              <div className={styles.heroMark}>&gt;_</div>
              <div className={styles.heroText}>
                <div className={styles.heroEyebrow}>Workspace</div>
                <h1 className={styles.heroTitle}>会话工作区</h1>
                <p className={styles.heroSub}>
                  在标签页中同时运行终端与 SFTP 文件管理。SSH 会话由服务端保持，切换标签、离开页面甚至刷新浏览器都不会中断远程连接。
                </p>
              </div>
              <div className={styles.heroActions}>
                <Button
                  appearance="primary"
                  size="large"
                  icon={<WindowConsoleRegular />}
                  onClick={() => setPickerOpen(true)}
                  data-testid="new-terminal-empty"
                >
                  打开终端
                </Button>
                <Button
                  appearance="secondary"
                  size="large"
                  icon={<FolderOpenRegular />}
                  onClick={() => setPickerOpen(true)}
                >
                  文件管理
                </Button>
              </div>
            </div>

            {quickHosts.length > 0 ? (
              <>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>快速连接</span>
                  <span className={styles.sectionHint}>收藏与最近连接的主机排在前面</span>
                  <span className={styles.sectionHint} style={{ marginLeft: 'auto' }}>
                    {hosts.length} 台主机
                  </span>
                </div>
                <div className={styles.quickGrid}>
                  {quickHosts.map((host) => (
                    <div
                      className={styles.hostCard}
                      key={host.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openHost(host, 'terminal')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openHost(host, 'terminal');
                        }
                      }}
                      data-testid="quick-host-card"
                      data-host-id={host.id}
                    >
                      <span className={styles.hostAvatar} style={{ background: host.color || tokens.colorBrandBackground }}>
                        {initials(host.name)}
                      </span>
                      <span className={styles.hostText}>
                        <span className={styles.hostName}>
                          {host.name}
                          {host.favorite && (
                            <span className={styles.hostFavorite}>
                              <StarFilled />
                            </span>
                          )}
                        </span>
                        <span className={styles.hostMeta}>
                          {host.username}@{host.hostname}:{host.port}
                        </span>
                        <span className={styles.hostFoot}>
                          <span className={styles.hostConn}>
                            {host.lastConnectedAt ? `最近连接 ${formatRelativeTime(host.lastConnectedAt)}` : '从未连接'}
                          </span>
                        </span>
                      </span>
                      <span className={styles.hostActions}>
                        <Tooltip content="打开终端" relationship="label">
                          <button
                            type="button"
                            className={styles.hostActionBtn}
                            onClick={(event) => {
                              event.stopPropagation();
                              openHost(host, 'terminal');
                            }}
                            aria-label={`打开 ${host.name} 的终端`}
                          >
                            <WindowConsoleRegular />
                          </button>
                        </Tooltip>
                        <Tooltip content="打开文件管理" relationship="label">
                          <button
                            type="button"
                            className={styles.hostActionBtn}
                            onClick={(event) => {
                              event.stopPropagation();
                              openHost(host, 'files');
                            }}
                            aria-label={`打开 ${host.name} 的文件管理`}
                          >
                            <FolderOpenRegular />
                          </button>
                        </Tooltip>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                icon={<WindowConsoleRegular />}
                title="还没有可连接的主机"
                description="添加一台 SSH 主机后，就可以从这里一键打开终端或文件管理。你也可以在任意页面按 Ctrl+K 使用快速连接。"
                actions={
                  <Button appearance="primary" onClick={() => setView('hosts')}>
                    浏览主机
                  </Button>
                }
              />
            )}

            <div className={styles.tipsGrid}>
              <div className={styles.tipCard}>
                <div className={styles.tipTitle}>
                  <ArrowClockwiseRegular /> 会话在服务端保持
                </div>
                <div className={styles.tipText}>
                  关闭浏览器标签或刷新页面只断开终端 WebSocket，SSH 会话仍在运行；重新打开工作区会自动回放最近的输出。
                </div>
              </div>
              <div className={styles.tipCard}>
                <div className={styles.tipTitle}>
                  <WindowConsoleRegular /> 键盘快捷键
                </div>
                <div className={styles.kbdRow}>
                  <span className="kbd-chip">Ctrl+W</span>
                  <span className={styles.tipText}>关闭标签</span>
                  <span className="kbd-chip">Ctrl+Tab</span>
                  <span className={styles.tipText}>切换</span>
                  <span className="kbd-chip">Ctrl+Shift+F</span>
                  <span className={styles.tipText}>搜索终端</span>
                </div>
              </div>
              <div className={styles.tipCard}>
                <div className={styles.tipTitle}>
                  <SquareMultipleRegular /> 标签内工具
                </div>
                <div className={styles.tipText}>
                  终端工具栏可清屏、复制、重连，并打开命令面板执行一次性命令；右键标签页可复制会话或关闭其他标签。
                </div>
              </div>
            </div>
          </div>

          <HostPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} />
        </div>
      ) : (
        <>
          <div className={styles.tabbar}>
            <div className={styles.tabsScroll} role="tablist" aria-label="打开的会话">
              {tabs.map((tab) => {
                const active = tab.id === activeId;
                const tone = tabTone(tab);
                return (
                  <div
                    key={tab.id}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    className={mergeClasses(styles.tab, active && styles.tabActive)}
                    onClick={() => setActive(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActive(tab.id);
                      } else if (event.key === 'Delete') {
                        event.preventDefault();
                        void closeTab(tab.id);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        tabId: tab.id,
                        x: Math.min(event.clientX, window.innerWidth - 232),
                        y: Math.min(event.clientY, window.innerHeight - 262)
                      });
                    }}
                    title={`${tab.title} · ${tab.username}@${tab.hostname}:${tab.port}`}
                    data-testid="workspace-tab"
                    data-tab-id={tab.id}
                    data-active={active ? 'true' : 'false'}
                    data-state={tab.state}
                    data-kind={tab.kind}
                  >
                    <span className={mergeClasses(styles.tabIcon, active && styles.tabIconActive)}>
                      <TerminalIcon kind={tab.kind} />
                    </span>
                    <span className={styles.tabTitle}>{tab.title}</span>
                    {(tab.state === 'connecting' || tab.state === 'awaiting-auth') && (
                      <Spinner size="extra-tiny" className={styles.tabSpinner} />
                    )}
                    <span
                      className={mergeClasses(
                        styles.statusDot,
                        tone === 'online' && styles.dotOnline,
                        tone === 'pending' && styles.dotPending,
                        tone === 'error' && styles.dotError,
                        tone === 'offline' && styles.dotOffline
                      )}
                      aria-hidden
                    />
                    <button
                      type="button"
                      className={mergeClasses(styles.tabClose, (active || tab.state !== 'connected') && styles.tabCloseVisible)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void closeTab(tab.id);
                      }}
                      aria-label={`关闭 ${tab.title}`}
                      data-testid="workspace-tab-close"
                    >
                      <DismissRegular />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={styles.tabActions}>
              <Tooltip content="新建终端" relationship="label">
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setPickerOpen(true)}
                  aria-label="新建终端"
                  data-testid="workspace-tab-new"
                >
                  <WindowConsoleRegular />
                </button>
              </Tooltip>
              <Tooltip content="打开文件管理" relationship="label">
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setPickerOpen(true)}
                  aria-label="打开文件管理"
                  data-testid="workspace-tab-new-files"
                >
                  <FolderOpenRegular />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className={styles.content}>
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={mergeClasses(styles.tabPanel, tab.id !== activeId && styles.tabPanelHidden)}
                data-testid="workspace-tab-panel"
                data-tab-id={tab.id}
              >
                {tab.kind === 'terminal' ? (
                  tab.sessionId ? (
                    <TerminalView
                      tab={tab}
                      visible={tab.id === activeId}
                      commandRunnerOpen={runnerTabs.includes(tab.id)}
                      onToggleCommandRunner={toggleRunner}
                    />
                  ) : (
                    <div className={styles.pendingPanel} data-testid="workspace-pending-tab">
                      <Spinner size="small" />
                      <div className={styles.pendingTitle}>正在创建会话…</div>
                      <div className={styles.pendingSub}>
                        {tab.username}@{tab.hostname}:{tab.port}
                      </div>
                    </div>
                  )
                ) : (
                  <div className={styles.panelSurface}>
                    <FileManagerTab tab={tab} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <HostPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} />
        </>
      )}

      {contextMenu && contextTab && (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          data-testid="workspace-tab-menu"
        >
          <div className={styles.menuHeader}>
            {contextTab.title} · {contextTab.username}@{contextTab.hostname}
          </div>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => runMenuAction(() => duplicateTab(contextTab.id))}
            role="menuitem"
            data-testid="workspace-tab-menu-duplicate"
          >
            <span className={styles.menuIcon}>
              <SquareMultipleRegular />
            </span>
            复制为新标签
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => runMenuAction(() => reconnectTab(contextTab.id))}
            role="menuitem"
            disabled={!contextTab.sessionId || contextTab.state === 'connected' || contextTab.state === 'connecting'}
            data-testid="workspace-tab-menu-reconnect"
          >
            <span className={styles.menuIcon}>
              <ArrowClockwiseRegular />
            </span>
            重新连接
          </button>
          {isHostKeyErrorCode(contextTab.errorCode) && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => runMenuAction(() => requestHostKeyRetry(contextTab.id))}
              role="menuitem"
              data-testid="workspace-tab-menu-trust"
            >
              <span className={styles.menuIcon}>
                <ShieldKeyholeRegular />
              </span>
              信任主机密钥…
            </button>
          )}
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => runMenuAction(() => copySshCommand(contextTab))}
            role="menuitem"
          >
            <span className={styles.menuIcon}>
              <CopyRegular />
            </span>
            复制 SSH 命令
          </button>
          <div className={styles.menuDivider} />
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => runMenuAction(() => closeTab(contextTab.id))}
            role="menuitem"
            data-testid="workspace-tab-menu-close"
          >
            <span className={styles.menuIcon}>
              <DismissRegular />
            </span>
            关闭标签
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() =>
              runMenuAction(async () => {
                for (const tab of useWorkspaceStore.getState().tabs) {
                  if (tab.id !== contextTab.id) await closeTab(tab.id);
                }
              })
            }
            role="menuitem"
            disabled={tabs.length < 2}
          >
            <span className={styles.menuIcon}>
              <DismissRegular />
            </span>
            关闭其他标签
          </button>
          <button
            type="button"
            className={mergeClasses(styles.menuItem, styles.menuItemDanger)}
            onClick={() =>
              runMenuAction(async () => {
                for (const tab of [...useWorkspaceStore.getState().tabs]) {
                  await closeTab(tab.id);
                }
              })
            }
            role="menuitem"
          >
            <span className={styles.menuIcon}>
              <DismissRegular />
            </span>
            关闭全部标签
          </button>
        </div>
      )}

      {!empty && activeTab && activeTab.state === 'error' && activeTab.errorCode && (
        <div style={{ display: 'none' }} data-testid="workspace-active-error" data-code={activeTab.errorCode} />
      )}
    </div>
  );
}
