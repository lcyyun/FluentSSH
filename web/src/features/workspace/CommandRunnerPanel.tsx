import {
  Button,
  Spinner,
  Textarea,
  Tooltip,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import {
  BookmarkRegular,
  BroomRegular,
  DesktopMacRegular,
  DismissRegular,
  HistoryRegular,
  PlayRegular,
  SendRegular,
  StopRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandHistoryEntry, ExecResult, Snippet } from '@shared/types';
import { api, errorMessage } from '../../api';
import { CommandResultConsole } from '../automation/CommandResultConsole';
import { useAppStore } from '../../store/app';
import type { WorkspaceTab } from './store';

const useStyles = makeStyles({
  panel: {
    width: '392px',
    flexShrink: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.10)',
    '@media (max-width: 980px)': {
      position: 'absolute',
      inset: 0,
      zIndex: 30,
      width: '100%',
      borderLeft: 'none'
    }
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: `linear-gradient(180deg, ${tokens.colorNeutralBackground2}, ${tokens.colorNeutralBackground1})`,
    flexShrink: 0
  },
  headerIcon: { color: tokens.colorBrandForeground1, display: 'flex' },
  headerTitle: { fontSize: '13px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  headerSub: { fontSize: '10.5px', color: tokens.colorNeutralForeground3, marginLeft: '2px' },
  hostRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '8px 12px',
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2,
    flexShrink: 0
  },
  hostMono: { fontFamily: tokens.fontFamilyMonospace, fontSize: '11px' },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  composer: { display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 },
  console: { flex: 1, minHeight: '150px' },
  textarea: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    minHeight: '84px'
  },
  composerActions: { display: 'flex', alignItems: 'center', gap: '8px' },
  hint: { fontSize: '10.5px', color: tokens.colorNeutralForeground3, marginLeft: 'auto' },
  notice: {
    fontSize: '11px',
    color: tokens.colorPaletteYellowForeground1,
    background: tokens.colorPaletteYellowBackground2,
    border: `1px solid ${tokens.colorPaletteYellowBorder2}`,
    borderRadius: '7px',
    padding: '7px 9px',
    lineHeight: 1.5
  },
  section: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, marginTop: '2px' },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground3
  },
  sectionCount: {
    fontSize: '10px',
    fontWeight: 500,
    color: tokens.colorNeutralForeground4,
    background: tokens.colorNeutralBackground3,
    borderRadius: '999px',
    padding: '0 6px'
  },
  clearButton: { marginLeft: 'auto' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    maxHeight: '184px',
    overflow: 'auto',
    margin: 0,
    padding: 0,
    listStyle: 'none'
  },
  historyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid transparent',
    '&:hover': {
      background: tokens.colorNeutralBackground3,
      border: `1px solid ${tokens.colorNeutralStroke2}`
    }
  },
  historyCommand: {
    flex: 1,
    minWidth: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  historyMeta: { fontSize: '10px', color: tokens.colorNeutralForeground3, flexShrink: 0 },
  exitOk: { color: tokens.colorPaletteGreenForeground1, fontSize: '10.5px', fontWeight: 600, flexShrink: 0 },
  exitBad: { color: tokens.colorPaletteRedForeground1, fontSize: '10.5px', fontWeight: 600, flexShrink: 0 },
  empty: { fontSize: '11px', color: tokens.colorNeutralForeground3, padding: '4px 2px' },
  snippetWrap: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  snippetChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    maxWidth: '100%',
    padding: '4px 8px',
    borderRadius: '7px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    fontSize: '11px',
    cursor: 'pointer',
    fontFamily: tokens.fontFamilyBase,
    '&:hover': { background: tokens.colorNeutralBackground3, border: `1px solid ${tokens.colorStrokeFocus2}` }
  },
  snippetName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' },
  runIconButton: {
    display: 'grid',
    placeItems: 'center',
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    flexShrink: 0,
    '&:hover': { background: tokens.colorNeutralBackground4, color: tokens.colorNeutralForeground1 }
  }
});

export interface CommandRunnerPanelProps {
  tab: WorkspaceTab;
  onClose: () => void;
}

/**
 * Dockable one-off command runner for an existing terminal tab. Commands run
 * through `POST /api/exec` (a short-lived SSH exec channel), not through the
 * interactive terminal socket, so they never disturb the session.
 */
export function CommandRunnerPanel({ tab, onClose }: CommandRunnerPanelProps) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const openHostKeyChallenge = useAppStore((state) => state.openHostKeyChallenge);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const runSeq = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startedAtRef = useRef(0);
  const hosts = useAppStore((state) => state.hosts);
  const host = useMemo(() => {
    if (!tab.hostId) return null;
    return hosts.find((item) => item.id === tab.hostId) ?? null;
  }, [hosts, tab.hostId]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { history: entries } = await api.commands.history(40);
      setHistory(entries);
    } catch {
      // History is a convenience; failure must not break the panel.
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void loadHistory();
    void api.snippets
      .list()
      .then(({ snippets: items }) => {
        if (alive) setSnippets(items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [loadHistory]);

  useEffect(() => {
    if (!busy) return;
    startedAtRef.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAtRef.current), 200);
    return () => window.clearInterval(timer);
  }, [busy]);

  const runCommand = useCallback(
    async (raw?: string) => {
      const value = (raw ?? command).trim();
      if (!value) return;
      if (!tab.hostId) {
        notify('warning', '无法执行命令', '内联会话没有可复用的主机配置，请保存为主机后再使用命令面板。');
        return;
      }
      const requestId = runSeq.current + 1;
      runSeq.current = requestId;
      setBusy(true);
      setError(null);
      setNotice(null);
      setCommand(value);
      try {
        const { result: execResult } = await api.exec.run({ hostId: tab.hostId, command: value, timeoutMs: 120_000 });
        if (runSeq.current !== requestId) return;
        setResult(execResult);
        void loadHistory();
      } catch (err) {
        if (runSeq.current !== requestId) return;
        const apiError = err as { code?: string; details?: Record<string, unknown> };
        if (apiError.code === 'HOST_KEY_UNKNOWN' || apiError.code === 'HOST_KEY_MISMATCH') {
          openHostKeyChallenge({
            details: { ...(apiError.details ?? {}), hostLabel: tab.hostName },
            retry: () => runCommand(value)
          });
        } else {
          setError(errorMessage(err));
          notify('error', '命令执行失败', errorMessage(err));
        }
      } finally {
        if (runSeq.current === requestId) setBusy(false);
      }
    },
    [command, loadHistory, notify, openHostKeyChallenge, tab.hostId, tab.hostName]
  );

  const cancelRun = () => {
    runSeq.current += 1;
    setBusy(false);
    setNotice('已停止等待远端命令结果。远端进程可能仍在运行，可稍后在命令历史中查看。');
  };

  const applyHistoryEntry = (entry: CommandHistoryEntry, run: boolean) => {
    setCommand(entry.command);
    setResult(entry);
    setError(null);
    if (run) void runCommand(entry.command);
    else textareaRef.current?.focus();
  };

  const insertSnippet = (snippet: Snippet) => {
    setCommand(snippet.command);
    textareaRef.current?.focus();
  };

  const clearHistory = async () => {
    try {
      await api.commands.clearHistory();
      setHistory([]);
      notify('success', '命令历史已清空');
    } catch (err) {
      notify('error', '清空失败', errorMessage(err));
    }
  };

  const hostLabel = host ? `${host.username}@${host.hostname}:${host.port}` : `${tab.username}@${tab.hostname}:${tab.port}`;

  return (
    <aside className={styles.panel} data-testid="command-runner-panel" aria-label="命令面板">
      <header className={styles.header}>
        <span className={styles.headerIcon}>
          <WindowConsoleRegular />
        </span>
        <span className={styles.headerTitle}>命令面板</span>
        <span className={styles.headerSub}>单次 exec · 不影响终端</span>
        <Tooltip content="关闭命令面板" relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<DismissRegular />}
            onClick={onClose}
            aria-label="关闭命令面板"
            data-testid="command-runner-close"
            style={{ marginLeft: 'auto' }}
          />
        </Tooltip>
      </header>

      <div className={styles.hostRow}>
        <DesktopMacRegular />
        <span className={styles.hostMono}>{hostLabel}</span>
        {!tab.hostId && <span className="tertiary">（内联会话）</span>}
      </div>

      <div className={styles.body}>
        {notice && <div className={styles.notice}>{notice}</div>}
        {!tab.hostId && (
          <div className={styles.notice}>该标签由快速连接创建，凭据未持久化。保存为主机后即可使用命令面板；或直接在终端中输入命令。</div>
        )}
        <div className={styles.composer}>
          <Textarea
            ref={textareaRef}
            className={styles.textarea}
            resize="vertical"
            value={command}
            onChange={(_, data) => setCommand(data.value)}
            placeholder="输入一次性远程命令，例如：df -h /"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void runCommand();
              }
            }}
            data-testid="command-runner-input"
          />
          <div className={styles.composerActions}>
            <Button
              appearance="primary"
              size="small"
              icon={busy ? <Spinner size="tiny" /> : <SendRegular />}
              onClick={() => void runCommand()}
              disabled={busy || !command.trim() || !tab.hostId}
              data-testid="send-command"
            >
              {busy ? `执行中 ${Math.floor(elapsed / 1000)}s` : '执行命令'}
            </Button>
            {busy ? (
              <Button appearance="subtle" size="small" icon={<StopRegular />} onClick={cancelRun}>
                取消等待
              </Button>
            ) : (
              <span className={styles.hint}>Ctrl+Enter 执行</span>
            )}
          </div>
        </div>

        <CommandResultConsole result={result} error={error} running={busy} minHeight={140} className={styles.console} />

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <HistoryRegular />
            最近命令
            {loadingHistory && <Spinner size="extra-tiny" />}
            <span className={styles.sectionCount}>{history.length}</span>
            <Button
              appearance="subtle"
              size="small"
              className={styles.clearButton}
              onClick={() => void clearHistory()}
              disabled={history.length === 0}
              icon={<BroomRegular />}
              aria-label="清空命令历史"
            >
              清空
            </Button>
          </div>
          {history.length === 0 ? (
            <div className={styles.empty}>还没有命令历史。执行一次命令后会出现在这里。</div>
          ) : (
            <ul className={styles.list}>
              {history.map((entry) => (
                <li key={entry.id}>
                  <div
                    className={styles.historyRow}
                    onClick={() => applyHistoryEntry(entry, false)}
                    onDoubleClick={() => applyHistoryEntry(entry, true)}
                    data-testid="command-runner-history-row"
                  >
                    <span className={styles.historyCommand} title={entry.command}>
                      {entry.command}
                    </span>
                    <span className={styles.historyMeta}>{entry.durationMs} ms</span>
                    <span className={entry.exitCode === 0 ? styles.exitOk : styles.exitBad}>{entry.exitCode ?? '—'}</span>
                    <Tooltip content="重新执行" relationship="label">
                      <button
                        type="button"
                        className={styles.runIconButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          applyHistoryEntry(entry, true);
                        }}
                        aria-label="重新执行命令"
                      >
                        <PlayRegular />
                      </button>
                    </Tooltip>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <BookmarkRegular />
            命令片段
            <span className={styles.sectionCount}>{snippets.length}</span>
          </div>
          {snippets.length === 0 ? (
            <div className={styles.empty}>在「命令与片段」页面创建片段后，可在此快速插入。</div>
          ) : (
            <div className={styles.snippetWrap}>
              {snippets.slice(0, 24).map((snippet) => (
                <Tooltip key={snippet.id} content={snippet.command} relationship="description">
                  <button
                    type="button"
                    className={styles.snippetChip}
                    onClick={() => insertSnippet(snippet)}
                    data-testid="snippet-row"
                    data-snippet-id={snippet.id}
                  >
                    <BookmarkRegular style={{ fontSize: 12 }} />
                    <span className={styles.snippetName}>{snippet.name}</span>
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
