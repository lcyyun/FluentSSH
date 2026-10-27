import {
  Button,
  FluentProvider,
  Spinner,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowRoutingRegular,
  ChevronDoubleLeftRegular,
  ChevronDoubleRightRegular,
  CheckmarkCircleRegular,
  CodeRegular,
  DesktopMacRegular,
  DismissRegular,
  DocumentBulletListRegular,
  ErrorCircleRegular,
  InfoRegular,
  LockClosedRegular,
  LockOpenRegular,
  SearchRegular,
  SettingsRegular,
  ShieldKeyholeRegular,
  WarningRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api';
import { CommandPalette } from './components/CommandPalette';
import { AuthPromptDialog } from './components/overlays/AuthPromptDialog';
import { HostKeyDialog } from './components/overlays/HostKeyDialog';
import { VaultUnlockDialog } from './components/overlays/VaultUnlockDialog';
import { startEventStream, useEventConnection, useServerEvent } from './events';
import CommandsPage from './features/automation/CommandsPage';
import HostsPage from './features/hosts/HostsPage';
import LogsPage from './features/logs/LogsPage';
import SecurityPage from './features/security/SecurityPage';
import SettingsPage from './features/settings/SettingsPage';
import TunnelsPage from './features/tunnels/TunnelsPage';
import WorkspacePage from './features/workspace/WorkspacePage';
import { useWorkspaceStore } from './features/workspace/store';
import { useAppStore, type AppView, type ToastLevel } from './store/app';
import { useAppTheme, useEffectiveMode } from './theme';
import './styles.css';

const useStyles = makeStyles({
  titlebar: { WebkitAppRegion: 'drag' } as never,
  noDrag: { WebkitAppRegion: 'no-drag' } as never,
  navIcon: { fontSize: '18px', display: 'flex' },
  main: { position: 'relative' },
  toastStack: {
    position: 'fixed',
    right: '18px',
    bottom: '18px',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '340px',
    maxWidth: 'calc(100vw - 36px)',
    pointerEvents: 'none'
  },
  toast: {
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '11px 12px',
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    boxShadow: tokens.shadow16,
    animation: 'fadeIn 0.18s ease both'
  },
  toastTitle: { fontSize: '12.5px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  toastBody: { fontSize: '11.5px', color: tokens.colorNeutralForeground3, marginTop: '2px', lineHeight: 1.45 },
  toastClose: { marginLeft: 'auto', flexShrink: 0 }
});

const NAV_MAIN: Array<{ view: AppView; label: string; icon: ReactNode }> = [
  { view: 'hosts', label: 'SSH 主机', icon: <DesktopMacRegular /> },
  { view: 'workspace', label: '会话工作区', icon: <WindowConsoleRegular /> },
  { view: 'tunnels', label: 'SSH 隧道', icon: <ArrowRoutingRegular /> },
  { view: 'commands', label: '命令与片段', icon: <CodeRegular /> }
];

const NAV_SECONDARY: Array<{ view: AppView; label: string; icon: ReactNode }> = [
  { view: 'security', label: '密钥与主机', icon: <ShieldKeyholeRegular /> },
  { view: 'logs', label: '日志与审计', icon: <DocumentBulletListRegular /> }
];

export default function App() {
  const settings = useAppStore((state) => state.settings);
  const { theme } = useAppTheme();
  const mode = useEffectiveMode(settings?.theme ?? 'light');
  const reduceMotion = settings?.reduceMotion ?? false;
  return (
    <FluentProvider theme={theme} style={{ height: '100%', background: 'transparent' }}>
      <Root reduceMotion={reduceMotion} mode={mode} />
    </FluentProvider>
  );
}

function Root({ reduceMotion, mode }: { reduceMotion: boolean; mode: 'light' | 'dark' }) {
  const styles = useStyles();
  const booted = useAppStore((state) => state.booted);
  const bootError = useAppStore((state) => state.bootError);
  const initialize = useAppStore((state) => state.initialize);
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const navCollapsed = useAppStore((state) => state.navCollapsed);
  const setNavCollapsed = useAppStore((state) => state.setNavCollapsed);
  const vault = useAppStore((state) => state.vault);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const lockVault = useAppStore((state) => state.lockVault);
  const notify = useAppStore((state) => state.notify);
  const setVault = useAppStore((state) => state.setVault);
  const setAuthPrompt = useAppStore((state) => state.setAuthPrompt);
  const authPrompt = useAppStore((state) => state.authPrompt);
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);
  const upsertHost = useAppStore((state) => state.upsertHost);
  const removeHostLocal = useAppStore((state) => state.removeHostLocal);
  const tabCount = useWorkspaceStore((state) => state.tabs.length);
  const eventStatus = useEventConnection((state) => state.status);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    void initialize();
    startEventStream();
  }, [initialize]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (settings) {
      document.documentElement.dataset.reduceMotion = String(settings.reduceMotion);
    }
  }, [settings]);

  useServerEvent(
    useCallback(
      (event) => {
        switch (event.type) {
          case 'auth.prompt':
            setAuthPrompt(event.prompt);
            break;
          case 'auth.prompt.closed':
            if (useAppStore.getState().authPrompt?.requestId === event.requestId) setAuthPrompt(null);
            break;
          case 'vault.locked':
            void api.vault
              .status()
              .then(({ status }) => setVault(status))
              .catch(() => setVault({ protected: true, unlocked: false, autoLockMinutes: 0, locksAt: null }));
            break;
          case 'vault.unlocked':
            void api.vault
              .status()
              .then(({ status }) => setVault(status))
              .catch(() => undefined);
            break;
          case 'notify':
            notify(event.level === 'success' ? 'success' : event.level, event.title, event.message);
            break;
          case 'host.updated':
            upsertHost(event.host);
            break;
          case 'host.deleted':
            removeHostLocal(event.hostId);
            break;
          default:
            break;
        }
      },
      [notify, removeHostLocal, setAuthPrompt, setVault, upsertHost]
    )
  );

  const toggleTheme = () => {
    const current = useAppStore.getState().settings?.theme ?? 'light';
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = current === 'system' ? (systemDark ? 'dark' : 'light') : current;
    void updateSettings({ theme: effective === 'dark' ? 'light' : 'dark' });
  };

  if (!booted) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          {bootError ? (
            <>
              <div className="brand-mark boot-brand">&gt;_</div>
              <div className="boot-title">无法连接到本地服务</div>
              <div className="boot-sub" style={{ maxWidth: 460, textAlign: 'center' }}>
                {bootError}
                <br />
                请确认 <span className="mono">pnpm start</span> 或 <span className="mono">pnpm dev</span> 正在运行。
              </div>
              <Button appearance="primary" onClick={() => void initialize()}>
                重试
              </Button>
            </>
          ) : (
            <>
              <div className="brand-mark boot-brand">&gt;_</div>
              <div className="boot-title">FluentSSH</div>
              <div className="boot-sub">正在准备你的 SSH 工作台…</div>
              <Spinner size="small" />
            </>
          )}
        </div>
      </div>
    );
  }

  const activeTunnels = 0;
  const vaultLabel = vault?.protected ? (vault.unlocked ? '已解锁' : '已锁定') : '本地密钥';
  const content = renderView(view);

  return (
    <div className="app-frame" data-theme={mode}>
      <header className="titlebar">
        <div className="brand">
          <div className="brand-mark">&gt;_</div>
          <div className="brand-text">
            <span className="brand-name">FluentSSH</span>
            <span className="brand-sub">SSH Workspace</span>
          </div>
        </div>
        <div className="titlebar-center">
          <button className="search-trigger" onClick={() => setPaletteOpen(true)} type="button" data-testid="search-trigger">
            <SearchRegular />
            <span>搜索主机或执行操作…</span>
            <span className="kbd">Ctrl K</span>
          </button>
        </div>
        <div className="titlebar-actions">
          <div className="connection-badge" title="实时事件连接状态">
            <span className={`connection-dot ${eventStatus === 'online' ? 'online' : eventStatus === 'connecting' ? 'connecting' : 'offline'}`} />
            <span>{eventStatus === 'online' ? '实时连接' : eventStatus === 'connecting' ? '连接中' : '已断开'}</span>
          </div>
          <Tooltip content={mode === 'dark' ? '浅色模式' : '深色模式'} relationship="label">
            <Button
              appearance="subtle"
              icon={mode === 'dark' ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
              onClick={toggleTheme}
              aria-label="切换主题"
            />
          </Tooltip>
          <Tooltip content={vault?.unlocked ? '锁定保险库' : '解锁保险库'} relationship="label">
            <Button
              appearance="subtle"
              icon={vault?.unlocked ? <LockOpenRegular /> : <LockClosedRegular />}
              onClick={() => {
                if (vault?.unlocked && vault.protected) void lockVault();
                else notify('info', '保险库已解锁', '可在设置 → 安全中设置主密码。');
              }}
              aria-label="保险库"
            />
          </Tooltip>
          <Tooltip content="设置" relationship="label">
            <Button
              appearance="subtle"
              icon={<SettingsRegular />}
              onClick={() => setView('settings')}
              aria-label="设置"
              data-testid="nav-settings"
            />
          </Tooltip>
        </div>
      </header>

      <div className="main-body">
        <nav className={mergeClasses('nav-rail', navCollapsed && 'collapsed')} aria-label="主导航">
          <div className="nav-section-label">工作区</div>
          <div className="nav-items">
            {NAV_MAIN.map((item) => (
              <NavItem
                key={item.view}
                active={view === item.view}
                icon={item.icon}
                label={item.label}
                collapsed={navCollapsed}
                badge={item.view === 'workspace' && tabCount > 0 ? tabCount : item.view === 'tunnels' && activeTunnels > 0 ? activeTunnels : undefined}
                onClick={() => setView(item.view)}
                testId={`nav-${item.view}`}
              />
            ))}
          </div>
          <div className="nav-section-label" style={{ marginTop: 8 }}>
            安全与记录
          </div>
          <div className="nav-items">
            {NAV_SECONDARY.map((item) => (
              <NavItem
                key={item.view}
                active={view === item.view}
                icon={item.icon}
                label={item.label}
                collapsed={navCollapsed}
                onClick={() => setView(item.view)}
                testId={`nav-${item.view}`}
              />
            ))}
          </div>
          <div className="nav-spacer" />
          <div className="rail-footer">
            <button
              type="button"
              className="rail-vault-card"
              onClick={() => {
                if (vault?.unlocked && vault.protected) void lockVault();
                else if (!vault?.unlocked) setView('settings');
              }}
              title={vaultLabel}
            >
              <span className={`rail-vault-icon${vault && !vault.unlocked ? ' locked' : ''}`}>
                {vault?.unlocked ? <LockOpenRegular /> : <LockClosedRegular />}
              </span>
              <span className="rail-vault-text">
                <div className="rail-vault-title">保险库 · {vaultLabel}</div>
                <div className="rail-vault-sub">
                  {vault?.protected ? (vault.unlocked ? '主密码保护已启用' : '点击解锁以使用凭据') : '未设置主密码'}
                </div>
              </span>
            </button>
            <button type="button" className="rail-collapse" onClick={() => setNavCollapsed(!navCollapsed)}>
              {navCollapsed ? <ChevronDoubleRightRegular /> : <ChevronDoubleLeftRegular />}
              <span className="rail-collapse-label">收起侧栏</span>
            </button>
          </div>
        </nav>

        <main className={styles.main + ' main-pane'}>{content}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <AuthPromptDialog />
      <HostKeyDialog />
      <VaultUnlockDialog />
      <ToastStack toasts={toasts} onDismiss={dismissToast} styles={styles} />
    </div>
  );
}

function NavItem({
  active,
  icon,
  label,
  collapsed,
  badge,
  onClick,
  testId
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  badge?: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button type="button" className={mergeClasses('nav-item', active && 'active')} onClick={onClick} data-testid={testId} title={label}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {badge !== undefined && !collapsed && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

function renderView(view: AppView) {
  switch (view) {
    case 'hosts':
      return <HostsPage />;
    case 'workspace':
      return <WorkspacePage />;
    case 'tunnels':
      return <TunnelsPage />;
    case 'commands':
      return <CommandsPage />;
    case 'security':
      return <SecurityPage />;
    case 'logs':
      return <LogsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HostsPage />;
  }
}

function ToastStack({
  toasts,
  onDismiss,
  styles
}: {
  toasts: Array<{ id: string; level: ToastLevel; title: string; message?: string }>;
  onDismiss: (id: string) => void;
  styles: ReturnType<typeof useStyles>;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.toastStack} aria-live="polite">
      {toasts.map((toast) => (
        <div className={styles.toast} key={toast.id} data-testid="toast">
          <ToastIcon level={toast.level} />
          <div className="grow">
            <div className={styles.toastTitle}>{toast.title}</div>
            {toast.message && <div className={styles.toastBody}>{toast.message}</div>}
          </div>
          <Button
            className={styles.toastClose}
            appearance="subtle"
            size="small"
            icon={<DismissRegular />}
            onClick={() => onDismiss(toast.id)}
            aria-label="关闭通知"
          />
        </div>
      ))}
    </div>
  );
}

function ToastIcon({ level }: { level: ToastLevel }) {
  const color =
    level === 'success'
      ? tokens.colorPaletteGreenForeground1
      : level === 'warning'
        ? tokens.colorPaletteYellowForeground1
        : level === 'error'
          ? tokens.colorPaletteRedForeground1
          : tokens.colorBrandForeground1;
  const icon =
    level === 'success' ? (
      <CheckmarkCircleRegular />
    ) : level === 'warning' ? (
      <WarningRegular />
    ) : level === 'error' ? (
      <ErrorCircleRegular />
    ) : (
      <InfoRegular />
    );
  return <span style={{ color, fontSize: '18px', marginTop: 1 }}>{icon}</span>;
}
