import '@xterm/xterm/css/xterm.css';
import { Spinner, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  BroomRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  CodeRegular,
  CopyRegular,
  DismissRegular,
  KeyRegular,
  LockClosedRegular,
  PlugConnectedRegular,
  SearchRegular,
  ShieldCheckmarkRegular,
  WarningRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionState } from '@shared/types';
import { copyText, formatBytes, formatDuration } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { useEffectiveMode } from '../../theme';
import { CommandRunnerPanel } from './CommandRunnerPanel';
import { closeTab, isHostKeyErrorCode, reconnectTab, requestHostKeyRetry } from './session-actions';
import type { WorkspaceTab } from './store';
import { useWorkspaceStore } from './store';
import { TerminalSocket, type TerminalTransportStatus } from './terminal-socket';
import { TERMINAL_FONT_FALLBACK, getTerminalTheme } from './terminal-theme';

const SEARCH_OPTIONS: ISearchOptions = {
  caseSensitive: false,
  incremental: true,
  decorations: {
    matchBackground: '#2f4d70',
    matchOverviewRuler: '#2f4d70',
    activeMatchBackground: '#c98a2e',
    activeMatchColorOverviewRuler: '#c98a2e'
  }
};

const STATE_LABELS: Record<SessionState, string> = {
  connecting: '连接中',
  'awaiting-auth': '等待验证',
  connected: '已连接',
  disconnected: '已断开',
  closed: '已关闭',
  error: '连接出错'
};

const TRANSPORT_LABELS: Record<TerminalTransportStatus, string> = {
  connecting: '建立中',
  open: '正常',
  reconnecting: '重连中',
  closed: '已分离'
};

function markTone(state: SessionState): string {
  switch (state) {
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

/** Extract the tail of the scrollback as plain text (used by the copy button). */
function collectTerminalText(term: Terminal, maxLines = 4000): string {
  const buffer = term.buffer.active;
  const start = Math.max(0, buffer.length - maxLines);
  const lines: string[] = [];
  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);
    lines.push(line ? line.translateToString(true) : '');
  }
  return lines.join('\n').replace(/\s+$/, '');
}

const useToolbarStyles = makeStyles({
  button: {
    display: 'grid',
    placeItems: 'center',
    width: '28px',
    height: '28px',
    border: '1px solid transparent',
    borderRadius: '7px',
    background: 'transparent',
    color: '#a9b6c8',
    cursor: 'pointer',
    padding: 0,
    fontSize: '15px',
    transitionProperty: 'background, color, border-color',
    transitionDuration: '0.14s',
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.08)',
      color: '#e7eef8'
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.colorBrandStroke1}`,
      outlineOffset: '1px'
    }
  },
  active: {
    background: 'rgba(88, 166, 255, 0.16)',
    color: '#8ecbff',
    border: '1px solid rgba(88, 166, 255, 0.36)'
  },
  danger: {
    '&:hover': { background: 'rgba(255, 107, 95, 0.16)', color: '#ff9b94' }
  },
  disabled: { opacity: 0.4, cursor: 'default' }
});

function ToolbarButton({
  label,
  icon,
  onClick,
  active,
  danger,
  disabled,
  testId
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const styles = useToolbarStyles();
  return (
    <Tooltip content={label} relationship="label">
      <button
        type="button"
        className={mergeClasses(styles.button, active && styles.active, danger && styles.danger, disabled && styles.disabled)}
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        data-testid={testId}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--terminal-bg)',
    color: '#dbe4f0',
    overflow: 'hidden'
  },
  toolbar: {
    height: '40px',
    flex: '0 0 40px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 8px 0 12px',
    background: 'var(--terminal-header)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
    userSelect: 'none'
  },
  toolbarLead: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 },
  toolbarDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    background: '#8d99ad'
  },
  dotOnline: { background: '#2fbd82', boxShadow: '0 0 0 3px rgba(47, 189, 130, 0.16)' },
  dotPending: {
    background: '#e0a93d',
    boxShadow: '0 0 0 3px rgba(224, 169, 61, 0.18)',
    animationName: 'wsPulse',
    animationDuration: '1.6s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out'
  },
  dotError: { background: '#ff6b5f', boxShadow: '0 0 0 3px rgba(255, 107, 95, 0.18)' },
  dotOffline: { background: '#7c8798' },
  stateLabel: { fontSize: '11.5px', color: '#cdd8e6', whiteSpace: 'nowrap' },
  divider: { width: '1px', height: '16px', background: 'rgba(255, 255, 255, 0.12)', flexShrink: 0 },
  hostLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    color: '#9eacbe',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0
  },
  remoteTitle: {
    fontSize: '11px',
    color: '#748296',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '260px'
  },
  toolbarActions: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 },
  toolbarSep: { width: '1px', height: '18px', background: 'rgba(255, 255, 255, 0.1)', margin: '0 3px', flexShrink: 0 },
  body: { flex: 1, minHeight: 0, display: 'flex', position: 'relative' },
  mainColumn: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' },
  surface: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--terminal-bg)',
    overflow: 'hidden',
    transitionProperty: 'opacity',
    transitionDuration: '0.16s'
  },
  surfaceBell: { animationName: 'wsBellFlash', animationDuration: '0.22s', animationTimingFunction: 'ease' },
  termHost: {
    flex: 1,
    minHeight: 0,
    padding: '10px 10px 6px 14px',
    overflow: 'hidden',
    '& .xterm': { height: '100%' },
    '& .xterm-viewport': { background: 'transparent !important', scrollbarWidth: 'thin' }
  },
  statusbar: { padding: '0 10px', gap: '12px', overflow: 'hidden' },
  spacer: { flex: 1 },
  statItem: { display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' },
  statusDot: { width: '7px', height: '7px', borderRadius: '50%', background: '#8d99ad' },
  statusValue: { color: '#cdd6e4', fontWeight: 500 },
  fingerprint: { color: '#7f8b9d', fontFamily: tokens.fontFamilyMonospace, fontSize: '10.5px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  searching: {
    position: 'absolute',
    top: '8px',
    right: '12px',
    zIndex: 12,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 5px 4px 8px',
    borderRadius: '8px',
    background: 'rgba(17, 24, 34, 0.96)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.42)'
  },
  searchInput: {
    width: '208px',
    height: '26px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: '#e8eef7',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    '&::placeholder': { color: '#66748a' }
  },
  searchCount: { fontSize: '10.5px', color: '#8492a6', minWidth: '48px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
  searchButton: {
    display: 'grid',
    placeItems: 'center',
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: '#a9b6c8',
    cursor: 'pointer',
    fontSize: '13px',
    padding: 0,
    '&:hover': { background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff' }
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    display: 'grid',
    placeItems: 'center',
    padding: '24px',
    background: 'rgba(6, 10, 16, 0.72)',
    backdropFilter: 'blur(2px)',
    animation: 'fadeIn 0.18s ease both'
  },
  overlaySoft: { background: 'rgba(6, 10, 16, 0.48)' },
  overlayCard: {
    width: 'min(440px, 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '10px',
    padding: '26px 26px 22px',
    borderRadius: '16px',
    background: 'linear-gradient(180deg, rgba(27, 36, 49, 0.97), rgba(17, 24, 34, 0.97))',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.5)'
  },
  overlayIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '23px',
    color: '#8ecbff',
    background: 'rgba(88, 166, 255, 0.14)',
    border: '1px solid rgba(88, 166, 255, 0.28)',
    marginBottom: '2px'
  },
  overlayIconWarning: { color: '#e8c98c', background: 'rgba(224, 169, 61, 0.14)', border: '1px solid rgba(224, 169, 61, 0.3)' },
  overlayIconDanger: { color: '#ff9b94', background: 'rgba(255, 107, 95, 0.13)', border: '1px solid rgba(255, 107, 95, 0.3)' },
  overlayTitle: { fontSize: '16px', fontWeight: 600, color: '#eef3fa' },
  overlayDesc: { fontSize: '12px', lineHeight: 1.6, color: '#9fadc0', maxWidth: '360px' },
  overlayError: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: '8px',
    background: 'rgba(0, 0, 0, 0.28)',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    color: '#c8d3e2',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    lineHeight: 1.55,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    maxHeight: '110px',
    overflow: 'auto',
    textAlign: 'left'
  },
  overlayActions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '6px' },
  networkBanner: {
    position: 'absolute',
    top: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 15,
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '5px 11px',
    borderRadius: '999px',
    background: 'rgba(64, 48, 18, 0.94)',
    border: '1px solid rgba(224, 169, 61, 0.45)',
    color: '#f0cf94',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)'
  },
  wsNotice: {
    position: 'absolute',
    top: '8px',
    left: '12px',
    right: '12px',
    zIndex: 14,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 10px',
    borderRadius: '8px',
    background: 'rgba(70, 28, 28, 0.94)',
    border: '1px solid rgba(255, 107, 95, 0.4)',
    color: '#ffc2bd',
    fontSize: '11.5px'
  },
  keyHint: { fontSize: '10.5px', color: '#6f7d90' }
});

export interface TerminalViewProps {
  tab: WorkspaceTab;
  /** Only the active tab is visible; hidden tabs stay mounted and keep buffering. */
  visible: boolean;
  commandRunnerOpen: boolean;
  onToggleCommandRunner: (tabId: string) => void;
}

interface ProblemDescription {
  title: string;
  description: string;
  tone: 'warning' | 'danger' | 'neutral';
}

function describeProblem(tab: WorkspaceTab): ProblemDescription {
  const code = tab.errorCode;
  if (code === 'HOST_KEY_UNKNOWN') {
    return {
      title: '首次连接，需要验证主机密钥',
      description: '该主机的 SSH 密钥尚未被信任。请核对指纹后信任它，再重新连接以继续。',
      tone: 'warning'
    };
  }
  if (code === 'HOST_KEY_MISMATCH') {
    return {
      title: '主机密钥已更改',
      description: '存储的密钥与服务器当前提供的密钥不一致。这可能意味着服务器被重装，也可能存在中间人攻击风险。',
      tone: 'danger'
    };
  }
  if (code === 'AUTH_FAILED') {
    return {
      title: '身份验证失败',
      description: '服务器拒绝了凭据。请检查用户名、密码或密钥，编辑主机后重新连接。',
      tone: 'danger'
    };
  }
  if (code === 'CONNECTION_FAILED') {
    return {
      title: '无法连接到主机',
      description: 'SSH 连接未能建立。请检查网络、端口与主机地址后重试。',
      tone: 'danger'
    };
  }
  if (code === 'VAULT_LOCKED') {
    return {
      title: '保险库已锁定',
      description: '该主机的密码或私钥已被锁定。请先在右上角解锁保险库，再重新连接。',
      tone: 'warning'
    };
  }
  if (tab.exitCode !== undefined && tab.exitCode !== null) {
    return {
      title: '远程 Shell 已退出',
      description: `远程 Shell 已结束（退出码 ${tab.exitCode}）。你可以重新连接以打开一个新的 Shell。`,
      tone: 'neutral'
    };
  }
  if (tab.state === 'closed') {
    return { title: '会话已结束', description: '连接已被服务端关闭。你可以重新连接以打开一个新的 Shell。', tone: 'neutral' };
  }
  return {
    title: '会话已断开',
    description: '终端连接已断开。SSH 会话在服务端保持，重新连接后可以继续使用。',
    tone: 'neutral'
  };
}

/**
 * xterm.js powered terminal for a single SSH session.
 *
 * The component is designed to stay mounted while the user switches tabs: the
 * xterm instance, scrollback and terminal WebSocket all survive tab switches,
 * and only the visibility-driven layout pass re-fits the viewport.
 */
export function TerminalView({ tab, visible, commandRunnerOpen, onToggleCommandRunner }: TerminalViewProps) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const settings = useAppStore((state) => state.settings);
  const setView = useAppStore((state) => state.setView);
  const mode = useEffectiveMode(settings?.theme ?? 'light');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const socketRef = useRef<TerminalSocket | null>(null);
  const openedRef = useRef(false);
  const visibleRef = useRef(visible);
  const bellTimerRef = useRef<number | null>(null);

  const [transport, setTransport] = useState<TerminalTransportStatus>('connecting');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [gridSize, setGridSize] = useState<{ cols: number; rows: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<{ index: number; count: number } | null>(null);
  const [wsNotice, setWsNotice] = useState<string | null>(null);
  const [bellFlash, setBellFlash] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  /** Locally observed I/O bytes; combined with server stats for the status bar. */
  const byteCountRef = useRef({ inbound: 0, outbound: 0 });

  visibleRef.current = visible;

  const fitTerminal = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const element = containerRef.current;
    if (!term || !fit || !element) return;
    if (element.clientWidth < 24 || element.clientHeight < 24) return;
    try {
      fit.fit();
    } catch {
      // Ignore transient measurement errors while the tab is animating in.
    }
    const cols = term.cols;
    const rows = term.rows;
    setGridSize((previous) =>
      previous && previous.cols === cols && previous.rows === rows ? previous : { cols, rows }
    );
    socketRef.current?.sendResize(cols, rows);
  }, []);

  const openAndFit = useCallback(() => {
    const term = termRef.current;
    const element = containerRef.current;
    if (!term || !element) return;
    if (!openedRef.current) {
      if (element.clientWidth < 24 || element.clientHeight < 24) return;
      try {
        term.open(element);
        openedRef.current = true;
      } catch {
        return;
      }
    }
    fitTerminal();
  }, [fitTerminal]);

  const copySelection = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    const text = term.hasSelection() ? term.getSelection() : collectTerminalText(term);
    if (!text.trim()) {
      notify('info', '没有可复制的内容');
      return;
    }
    const copied = await copyText(text);
    notify(
      copied ? 'success' : 'error',
      copied ? '终端内容已复制' : '复制失败',
      copied ? undefined : '浏览器拒绝了剪贴板访问。'
    );
  }, [notify]);

  const pasteClipboard = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) term.paste(text);
    } catch {
      notify('warning', '无法读取剪贴板', '请使用 Ctrl+V 粘贴，或允许浏览器访问剪贴板。');
    }
  }, [notify]);

  const clearTerminal = useCallback(() => {
    searchRef.current?.clearDecorations();
    termRef.current?.clear();
    termRef.current?.focus();
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchTerm('');
    setSearchResults(null);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  const findInTerminal = useCallback(
    (direction: 'next' | 'previous') => {
      const addon = searchRef.current;
      const term = searchTerm.trim();
      if (!addon || !term) return;
      try {
        if (direction === 'next') addon.findNext(term, SEARCH_OPTIONS);
        else addon.findPrevious(term, SEARCH_OPTIONS);
      } catch {
        // Older xterm builds without the proposed API fall back to plain search.
        try {
          if (direction === 'next') addon.findNext(term);
          else addon.findPrevious(term);
        } catch {
          // Invalid search input is ignored.
        }
      }
    },
    [searchTerm]
  );

  /** Latest callbacks for the custom key handler (avoids re-creating the terminal). */
  const actionsRef = useRef<{
    openSearch: () => void;
    copySelection: () => void;
    pasteClipboard: () => void;
  }>({
    openSearch: () => undefined,
    copySelection: () => undefined,
    pasteClipboard: () => undefined
  });
  actionsRef.current = {
    openSearch: () => openSearch(),
    copySelection: () => void copySelection(),
    pasteClipboard: () => void pasteClipboard()
  };

  /* ------------------------------------------------------------------ */
  /* xterm instance                                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const terminalSettings = useAppStore.getState().settings?.terminal;
    const terminal = new Terminal({
      fontFamily: terminalSettings?.fontFamily || TERMINAL_FONT_FALLBACK,
      fontSize: terminalSettings?.fontSize ?? 14,
      lineHeight: terminalSettings?.lineHeight ?? 1.25,
      fontWeight: 400,
      fontWeightBold: 600,
      letterSpacing: 0,
      cursorStyle: terminalSettings?.cursorStyle ?? 'bar',
      cursorBlink: terminalSettings?.cursorBlink ?? true,
      cursorInactiveStyle: 'outline',
      scrollback: terminalSettings?.scrollback ?? 10_000,
      theme: getTerminalTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
      allowTransparency: false,
      // The search addon uses decorations (proposed API) to highlight matches.
      allowProposedApi: true,
      convertEol: false,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
      rightClickSelectsWord: true,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
      tabStopWidth: 8,
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
      macOptionIsMeta: true,
      logLevel: 'off'
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const linksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault();
      window.open(uri, '_blank', 'noopener,noreferrer');
    });
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(linksAddon);
    termRef.current = terminal;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;
    openedRef.current = false;

    const dataListener = terminal.onData((data) => {
      byteCountRef.current.outbound += data.length;
      socketRef.current?.sendInput(data);
    });
    const bellListener = terminal.onBell(() => {
      if (!useAppStore.getState().settings?.terminal.bell) return;
      setBellFlash(true);
      if (bellTimerRef.current) window.clearTimeout(bellTimerRef.current);
      bellTimerRef.current = window.setTimeout(() => setBellFlash(false), 260);
    });
    const resultsListener = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResults({ index: resultIndex, count: resultCount });
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const ctrl = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();
      if (ctrl && shift && key === 'f') {
        event.preventDefault();
        actionsRef.current.openSearch();
        return false;
      }
      if (ctrl && shift && key === 'c') {
        event.preventDefault();
        actionsRef.current.copySelection();
        return false;
      }
      if (ctrl && shift && key === 'v') {
        event.preventDefault();
        actionsRef.current.pasteClipboard();
        return false;
      }
      // Let the workspace handle tab navigation instead of sending it to the shell.
      if (ctrl && event.key === 'Tab') return false;
      if (ctrl && shift && event.key === 'Tab') return false;
      return true;
    });

    const handleMouseUp = () => {
      if (!useAppStore.getState().settings?.terminal.copyOnSelect) return;
      if (terminal.hasSelection()) void copyText(terminal.getSelection());
    };
    element.addEventListener('mouseup', handleMouseUp);

    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        openAndFit();
      });
    });
    observer.observe(element);

    if (visibleRef.current) openAndFit();

    return () => {
      observer.disconnect();
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      if (bellTimerRef.current) window.clearTimeout(bellTimerRef.current);
      element.removeEventListener('mouseup', handleMouseUp);
      dataListener.dispose();
      bellListener.dispose();
      resultsListener.dispose();
      searchRef.current = null;
      fitRef.current = null;
      termRef.current = null;
      openedRef.current = false;
      try {
        linksAddon.dispose();
      } catch {
        // ignore
      }
      terminal.dispose();
    };
  }, [tab.sessionId, openAndFit]);

  /* ------------------------------------------------------------------ */
  /* settings + theme are applied reactively                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal || !settings) return;
    const terminalSettings = settings.terminal;
    terminal.options.fontFamily = terminalSettings.fontFamily || TERMINAL_FONT_FALLBACK;
    terminal.options.fontSize = terminalSettings.fontSize;
    terminal.options.lineHeight = terminalSettings.lineHeight;
    terminal.options.cursorStyle = terminalSettings.cursorStyle;
    terminal.options.cursorBlink = terminalSettings.cursorBlink;
    terminal.options.scrollback = terminalSettings.scrollback;
    const frame = window.requestAnimationFrame(() => fitTerminal());
    return () => window.cancelAnimationFrame(frame);
  }, [settings, fitTerminal]);

  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) return;
    terminal.options.theme = getTerminalTheme(mode);
  }, [mode]);

  /* ------------------------------------------------------------------ */
  /* terminal WebSocket (reattaches, never closes the SSH session)       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!tab.sessionId) return;
    const patch = (value: Partial<WorkspaceTab>) => useWorkspaceStore.getState().patchTab(tab.id, value);
    const socket = new TerminalSocket(tab.sessionId, {
      onBacklog: (bytes, reattach) => {
        const terminal = termRef.current;
        if (!terminal) return;
        if (reattach) terminal.reset();
        byteCountRef.current.inbound += bytes.byteLength;
        terminal.write(bytes);
      },
      onOutput: (bytes) => {
        byteCountRef.current.inbound += bytes.byteLength;
        termRef.current?.write(bytes);
      },
      onState: ({ state, message, errorCode, errorDetails }) => {
        patch({
          state,
          error: message ?? null,
          errorCode: errorCode ?? null,
          errorDetails: errorDetails ?? null
        });
      },
      onExit: (code, signal) => {
        patch({ state: 'disconnected', exitCode: code, exitSignal: signal, error: '远程 Shell 已退出。' });
      },
      onError: (message) => {
        setWsNotice(message);
      },
      onTitle: (title) => {
        if (!title.trim()) return;
        patch({ remoteTitle: title, title });
      },
      onStatus: (status) => setTransport(status),
      onLatency: (latency) => setLatencyMs(latency)
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.dispose();
      socketRef.current = null;
    };
  }, [tab.id, tab.sessionId]);

  /* A server-driven reconnect resets the terminal socket; re-attach immediately
     instead of waiting for the exponential backoff to expire. */
  useEffect(() => {
    if (tab.state === 'connecting' || tab.state === 'awaiting-auth') {
      socketRef.current?.reconnectNow();
    }
  }, [tab.state]);

  /* ------------------------------------------------------------------ */
  /* reactive layout / focus                                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!visible) return;
    const frame = window.requestAnimationFrame(() => {
      openAndFit();
      termRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible, openAndFit]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => fitTerminal(), 120);
    return () => window.clearTimeout(timer);
  }, [visible, commandRunnerOpen, fitTerminal]);

  useEffect(() => {
    if (!visible) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [visible]);

  useEffect(() => {
    if (!searchOpen) return;
    // `autoFocus` covers the mount paint; this also handles reopening the bar
    // from the toolbar while the terminal still holds keyboard focus.
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    if (!searchTerm.trim()) {
      searchRef.current?.clearDecorations();
      setSearchResults(null);
      return;
    }
    findInTerminal('next');
  }, [searchTerm, searchOpen, findInTerminal]);

  useEffect(() => {
    if (!wsNotice) return;
    const timer = window.setTimeout(() => setWsNotice(null), 9000);
    return () => window.clearTimeout(timer);
  }, [wsNotice]);

  /** Workspace-level Ctrl+Shift+F shortcut routed through a DOM event. */
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string }>).detail;
      if (!detail?.tabId || detail.tabId === tab.id) openSearch();
    };
    window.addEventListener('fluentssh:terminal-search', handler as EventListener);
    return () => window.removeEventListener('fluentssh:terminal-search', handler as EventListener);
  }, [tab.id, openSearch]);

  const displayState = tab.state;
  const tone = markTone(displayState);
  const stateLabel = STATE_LABELS[displayState] ?? displayState;
  const connectedAt = tab.connectedAt ?? tab.stats?.connectedAt ?? null;
  const duration = connectedAt ? formatDuration(Math.max(0, now - connectedAt)) : '—';
  const fingerprint = tab.hostKeyFingerprint?.replace(/^SHA256:/, '') ?? null;
  const latency = latencyMs ?? tab.stats?.latencyMs ?? null;
  const cols = gridSize?.cols ?? tab.cols ?? 0;
  const rows = gridSize?.rows ?? tab.rows ?? 0;
  const bytesIn = Math.max(tab.stats?.bytesIn ?? 0, byteCountRef.current.inbound);
  const bytesOut = Math.max(tab.stats?.bytesOut ?? 0, byteCountRef.current.outbound);
  const commandRunnerAvailable = Boolean(tab.hostId);

  const showSessionOverlay = displayState !== 'connected';
  const problem = describeProblem(tab);
  const problemIcon =
    problem.tone === 'danger' ? (
      <WarningRegular />
    ) : problem.tone === 'warning' ? (
      <ShieldCheckmarkRegular />
    ) : (
      <PlugConnectedRegular />
    );

  return (
    <section className={styles.root} data-testid="terminal-view" data-tab-id={tab.id} aria-label={`${tab.hostName} 终端`}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLead}>
          <span
            className={mergeClasses(
              styles.toolbarDot,
              tone === 'online' && styles.dotOnline,
              tone === 'pending' && styles.dotPending,
              tone === 'error' && styles.dotError,
              tone === 'offline' && styles.dotOffline
            )}
            data-testid="terminal-state-dot"
            data-state={displayState}
          />
          <span className={styles.stateLabel}>{stateLabel}</span>
          <span className={styles.divider} />
          <span className={styles.hostLabel} title={`${tab.username}@${tab.hostname}:${tab.port}`}>
            <WindowConsoleRegular style={{ fontSize: 13, flexShrink: 0 }} />
            {tab.username}@{tab.hostname}:{tab.port}
          </span>
          {tab.remoteTitle && <span className={styles.remoteTitle}>{tab.remoteTitle}</span>}
        </div>
        <div className={styles.toolbarActions}>
          <ToolbarButton label="搜索终端（Ctrl+Shift+F）" icon={<SearchRegular />} onClick={openSearch} active={searchOpen} testId="terminal-search-toggle" />
          <ToolbarButton label="清空屏幕" icon={<BroomRegular />} onClick={clearTerminal} testId="terminal-clear" />
          <ToolbarButton label="复制终端内容" icon={<CopyRegular />} onClick={() => void copySelection()} testId="terminal-copy" />
          <ToolbarButton
            label={commandRunnerAvailable ? '命令面板（单次 exec）' : '命令面板需要已保存的主机'}
            icon={<CodeRegular />}
            onClick={() => onToggleCommandRunner(tab.id)}
            active={commandRunnerOpen}
            disabled={!commandRunnerAvailable}
            testId="command-runner-toggle"
          />
          {displayState !== 'connected' && displayState !== 'connecting' && (
            <ToolbarButton label="重新连接" icon={<PlugConnectedRegular />} onClick={() => void reconnectTab(tab.id)} testId="terminal-reconnect" />
          )}
          <span className={styles.toolbarSep} />
          <ToolbarButton label="关闭会话标签" icon={<DismissRegular />} onClick={() => void closeTab(tab.id)} danger testId="terminal-close" />
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.mainColumn}>
          <div className={mergeClasses(styles.surface, bellFlash && styles.surfaceBell)}>
            <div ref={containerRef} className={mergeClasses(styles.termHost, 'terminal-host')} data-testid="terminal-host" />

            {searchOpen && (
              <div className={styles.searching} role="search">
                <SearchRegular style={{ color: '#8492a6', fontSize: 13 }} />
                <input
                  ref={searchInputRef}
                  className={styles.searchInput}
                  value={searchTerm}
                  placeholder="在终端中查找…"
                  autoFocus
                  onChange={(event) => setSearchTerm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      findInTerminal(event.shiftKey ? 'previous' : 'next');
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      closeSearch();
                    }
                  }}
                  data-testid="terminal-search-input"
                />
                <span className={styles.searchCount}>
                  {searchResults ? `${searchResults.count > 0 ? searchResults.index + 1 : 0} / ${searchResults.count}` : '0 / 0'}
                </span>
                <button type="button" className={styles.searchButton} onClick={() => findInTerminal('previous')} aria-label="上一个匹配" data-testid="terminal-search-prev">
                  <ChevronUpRegular />
                </button>
                <button type="button" className={styles.searchButton} onClick={() => findInTerminal('next')} aria-label="下一个匹配" data-testid="terminal-search-next">
                  <ChevronDownRegular />
                </button>
                <button type="button" className={styles.searchButton} onClick={closeSearch} aria-label="关闭搜索" data-testid="terminal-search-close">
                  <DismissRegular />
                </button>
              </div>
            )}

            {transport === 'reconnecting' && displayState === 'connected' && (
              <div className={styles.networkBanner} role="status" data-testid="terminal-network-banner">
                <Spinner size="extra-tiny" />
                网络中断，正在重连终端…
              </div>
            )}

            {wsNotice && (
              <div className={styles.wsNotice} role="alert">
                <WarningRegular />
                <span className="grow">{wsNotice}</span>
                <button type="button" className={styles.searchButton} onClick={() => setWsNotice(null)} aria-label="忽略">
                  <DismissRegular />
                </button>
              </div>
            )}

            {showSessionOverlay && (
              <div className={mergeClasses(styles.overlay, displayState === 'connecting' && styles.overlaySoft)} data-testid="terminal-overlay" data-state={displayState}>
                {displayState === 'connecting' ? (
                  <div className={styles.overlayCard}>
                    <div className={styles.overlayIcon}>
                      <Spinner size="small" />
                    </div>
                    <div className={styles.overlayTitle}>正在建立 SSH 连接</div>
                    <div className={styles.overlayDesc}>
                      {tab.username}@{tab.hostname}:{tab.port}
                      <br />
                      正在协商加密与身份验证，请稍候…
                    </div>
                  </div>
                ) : displayState === 'awaiting-auth' ? (
                  <div className={styles.overlayCard}>
                    <div className={mergeClasses(styles.overlayIcon, styles.overlayIconWarning)}>
                      <KeyRegular />
                    </div>
                    <div className={styles.overlayTitle}>等待身份验证</div>
                    <div className={styles.overlayDesc}>服务器要求额外的身份验证，请在弹出的验证窗口中完成。</div>
                  </div>
                ) : (
                  <div className={styles.overlayCard}>
                    <div
                      className={mergeClasses(
                        styles.overlayIcon,
                        problem.tone === 'warning' && styles.overlayIconWarning,
                        problem.tone === 'danger' && styles.overlayIconDanger
                      )}
                    >
                      {problemIcon}
                    </div>
                    <div className={styles.overlayTitle}>{problem.title}</div>
                    <div className={styles.overlayDesc}>{problem.description}</div>
                    {tab.error && tab.state === 'error' && <div className={styles.overlayError}>{tab.error}</div>}
                    {tab.state === 'closed' && tab.exitCode !== undefined && tab.exitCode !== null && (
                      <div className={styles.overlayError}>退出码：{tab.exitCode}</div>
                    )}
                    <div className={styles.overlayActions}>
                      {isHostKeyErrorCode(tab.errorCode) ? (
                        <PrimaryDarkButton onClick={() => requestHostKeyRetry(tab.id)} testId="terminal-trust-host-key">
                          信任主机密钥
                        </PrimaryDarkButton>
                      ) : (
                        <PrimaryDarkButton onClick={() => void reconnectTab(tab.id)} testId="terminal-overlay-reconnect">
                          重新连接
                        </PrimaryDarkButton>
                      )}
                      {tab.hostId && (
                        <SecondaryDarkButton onClick={() => setView('hosts')} testId="terminal-edit-host">
                          编辑主机
                        </SecondaryDarkButton>
                      )}
                      <SecondaryDarkButton onClick={() => void closeTab(tab.id)} testId="terminal-overlay-close">
                        关闭标签
                      </SecondaryDarkButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={mergeClasses('session-statusbar', styles.statusbar)} data-testid="terminal-statusbar">
            <span className={styles.statItem}>
              <span
                className={mergeClasses(
                  styles.statusDot,
                  tone === 'online' && styles.dotOnline,
                  tone === 'pending' && styles.dotPending,
                  tone === 'error' && styles.dotError,
                  tone === 'offline' && styles.dotOffline
                )}
              />
              <strong className={styles.statusValue}>{stateLabel}</strong>
            </span>
            <span className={styles.statItem}>
              网络<strong className={styles.statusValue}>{TRANSPORT_LABELS[transport]}</strong>
            </span>
            <span className={styles.statItem}>
              ↓<strong className={styles.statusValue}>{formatBytes(bytesIn)}</strong>
              ↑<strong className={styles.statusValue}>{formatBytes(bytesOut)}</strong>
            </span>
            <span className={styles.statItem}>
              延迟<strong className={styles.statusValue}>{latency !== null ? `${latency} ms` : '—'}</strong>
            </span>
            <span className={styles.statItem}>
              时长<strong className={styles.statusValue}>{duration}</strong>
            </span>
            <span className={styles.statItem}>
              <strong className={styles.statusValue}>{cols}×{rows}</strong>
            </span>
            <span className={styles.spacer} />
            <span className={styles.statItem} title={tab.hostKeyFingerprint ?? 'SSH 加密通道'}>
              <LockClosedRegular style={{ fontSize: 11 }} />
              <strong className={styles.statusValue}>SSH 加密</strong>
              {fingerprint && <span className={styles.fingerprint}>{fingerprint.slice(0, 12)}…</span>}
            </span>
          </div>
        </div>

        {commandRunnerOpen && <CommandRunnerPanel tab={tab} onClose={() => onToggleCommandRunner(tab.id)} />}
      </div>
    </section>
  );
}

const useOverlayButtonStyles = makeStyles({
  primary: {
    height: '30px',
    padding: '0 14px',
    borderRadius: '7px',
    border: '1px solid rgba(88, 166, 255, 0.5)',
    background: 'linear-gradient(180deg, #2f7fd0, #2568ad)',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    '&:hover': { background: 'linear-gradient(180deg, #3d8ede, #2a75be)' }
  },
  secondary: {
    height: '30px',
    padding: '0 14px',
    borderRadius: '7px',
    border: '1px solid rgba(255, 255, 255, 0.16)',
    background: 'rgba(255, 255, 255, 0.05)',
    color: '#dbe4f0',
    fontSize: '12px',
    cursor: 'pointer',
    '&:hover': { background: 'rgba(255, 255, 255, 0.11)' }
  }
});

function PrimaryDarkButton({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  const styles = useOverlayButtonStyles();
  return (
    <button type="button" className={styles.primary} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

function SecondaryDarkButton({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  const styles = useOverlayButtonStyles();
  return (
    <button type="button" className={styles.secondary} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}
