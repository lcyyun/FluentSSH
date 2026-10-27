import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Textarea,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  BookmarkRegular,
  BroomRegular,
  CodeRegular,
  CopyRegular,
  DeleteRegular,
  EditRegular,
  HistoryRegular,
  PlayRegular,
  SearchRegular,
  SendRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandHistoryEntry, ExecResult, HostProfile, Snippet } from '@shared/types';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { StatusPill } from '../../components/StatusPill';
import { formatRelativeTime } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { openTerminal } from '../workspace/session-actions';
import { CommandResultConsole } from './CommandResultConsole';
import { SnippetDialog } from './SnippetDialog';

const TIMEOUT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 30_000, label: '30 秒' },
  { value: 60_000, label: '1 分钟' },
  { value: 120_000, label: '2 分钟' },
  { value: 300_000, label: '5 分钟' },
  { value: 600_000, label: '10 分钟' }
];

const useStyles = makeStyles({
  page: { maxWidth: '1320px' },
  toolbarRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '12px'
  },
  hostField: { minWidth: '240px', flex: '0 1 300px' },
  timeoutField: { width: '132px' },
  hostDropdown: { minWidth: 0, width: '100%' },
  timeoutDropdown: { minWidth: 0, width: '100%' },
  hostMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    paddingBottom: '6px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    minWidth: 0
  },
  commandArea: { display: 'flex', flexDirection: 'column', gap: '10px' },
  commandTextarea: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12.5px',
    minHeight: '118px'
  },
  commandActions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  hint: { marginLeft: 'auto', fontSize: '10.5px', color: tokens.colorNeutralForeground3 },
  quickSnippets: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px' },
  quickLabel: { fontSize: '11px', color: tokens.colorNeutralForeground3, marginRight: '2px' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '4px 9px',
    borderRadius: '7px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    fontSize: '11px',
    cursor: 'pointer',
    '&:hover': { background: tokens.colorNeutralBackground3, border: `1px solid ${tokens.colorNeutralStroke1Hover}` }
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: '14px',
    alignItems: 'start'
  },
  cardBody: { display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '220px' },
  cardToolbar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  cardSearch: { flex: 1, minWidth: '150px' },
  list: { display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '430px', overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '8px 9px',
    borderRadius: '8px',
    border: `1px solid transparent`,
    cursor: 'pointer',
    '&:hover': { background: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke3}` }
  },
  rowIcon: { display: 'flex', color: tokens.colorNeutralForeground3, marginTop: '2px', flexShrink: 0 },
  rowMain: { flex: 1, minWidth: 0 },
  rowCommand: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '3px',
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3,
    flexWrap: 'wrap'
  },
  rowActions: { display: 'flex', alignItems: 'center', gap: '1px', flexShrink: 0 },
  iconAction: {
    display: 'grid',
    placeItems: 'center',
    width: '26px',
    height: '26px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: tokens.colorNeutralForeground3,
    cursor: 'pointer',
    fontSize: '13px',
    padding: 0,
    '&:hover': { background: tokens.colorNeutralBackground4, color: tokens.colorNeutralForeground1 }
  },
  iconActionDanger: { '&:hover': { background: tokens.colorPaletteRedBackground2, color: tokens.colorPaletteRedForeground1 } },
  snippetName: { fontSize: '12px', fontWeight: 600, color: tokens.colorNeutralForeground1, display: 'flex', alignItems: 'center', gap: '6px' },
  snippetTags: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '3px' },
  tag: {
    fontSize: '9.5px',
    padding: '0 5px',
    borderRadius: '999px',
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    border: `1px solid ${tokens.colorNeutralStroke3}`
  },
  emptyPad: { padding: '26px 12px' },
  exitOk: { color: tokens.colorPaletteGreenForeground1, fontWeight: 600 },
  exitBad: { color: tokens.colorPaletteRedForeground1, fontWeight: 600 }
});

export default function CommandsPage() {
  const styles = useStyles();
  const hosts = useAppStore((state) => state.hosts);
  const setView = useAppStore((state) => state.setView);
  const notify = useAppStore((state) => state.notify);
  const openHostKeyChallenge = useAppStore((state) => state.openHostKeyChallenge);

  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [timeoutMs, setTimeoutMs] = useState(60_000);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CommandHistoryEntry[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [snippetSearch, setSnippetSearch] = useState('');
  const [snippetDialog, setSnippetDialog] = useState<{ open: boolean; snippet: Snippet | null }>({ open: false, snippet: null });
  const [deleteTarget, setDeleteTarget] = useState<Snippet | null>(null);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);

  const selectedHost: HostProfile | null = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? null,
    [hosts, selectedHostId]
  );

  useEffect(() => {
    if (selectedHostId && hosts.some((host) => host.id === selectedHostId)) return;
    const preferred =
      [...hosts].sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0);
      })[0] ?? null;
    setSelectedHostId(preferred?.id ?? null);
  }, [hosts, selectedHostId]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { history: entries } = await api.commands.history(200);
      setHistory(entries);
    } catch (err) {
      notify('error', '读取命令历史失败', errorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  }, [notify]);

  const loadSnippets = useCallback(async () => {
    setSnippetsLoading(true);
    try {
      const { snippets: items } = await api.snippets.list();
      setSnippets(items);
    } catch (err) {
      notify('error', '读取命令片段失败', errorMessage(err));
    } finally {
      setSnippetsLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadHistory();
    void loadSnippets();
  }, [loadHistory, loadSnippets]);

  const runCommand = useCallback(
    async (rawCommand?: string, hostOverride?: HostProfile | null) => {
      const host = hostOverride ?? selectedHost ?? hosts.find((item) => item.id === selectedHostId) ?? null;
      const value = (rawCommand ?? command).trim();
      if (!host) {
        notify('warning', '请选择目标主机', '命令需要通过已保存的主机凭据执行。');
        return;
      }
      if (!value) return;
      setCommand(value);
      setRunning(true);
      setError(null);
      setResult(null);
      try {
        const { result: execResult } = await api.exec.run({ hostId: host.id, command: value, timeoutMs });
        setResult(execResult);
        void loadHistory();
      } catch (err) {
        const apiError = err as { code?: string; details?: Record<string, unknown> };
        if (apiError.code === 'HOST_KEY_UNKNOWN' || apiError.code === 'HOST_KEY_MISMATCH') {
          openHostKeyChallenge({
            details: { ...(apiError.details ?? {}), hostLabel: host.name },
            retry: () => runCommand(value, host)
          });
        } else {
          setError(errorMessage(err));
          notify('error', '命令执行失败', errorMessage(err));
        }
      } finally {
        setRunning(false);
      }
    },
    [command, hosts, loadHistory, notify, openHostKeyChallenge, selectedHost, selectedHostId, timeoutMs]
  );

  const runInTerminal = async () => {
    const host = selectedHost;
    if (!host) {
      notify('warning', '请选择目标主机');
      return;
    }
    const initialCommand = command.trim() || undefined;
    await openTerminal({ hostId: host.id, host, initialCommand });
  };

  const clearHistory = async () => {
    try {
      await api.commands.clearHistory();
      setHistory([]);
      setClearHistoryOpen(false);
      notify('success', '命令历史已清空');
    } catch (err) {
      notify('error', '清空历史失败', errorMessage(err));
    }
  };

  const removeSnippet = async () => {
    if (!deleteTarget) return;
    try {
      await api.snippets.remove(deleteTarget.id);
      setSnippets((previous) => previous.filter((snippet) => snippet.id !== deleteTarget.id));
      notify('success', '片段已删除', deleteTarget.name);
    } catch (err) {
      notify('error', '删除片段失败', errorMessage(err));
    } finally {
      setDeleteTarget(null);
    }
  };

  const filteredHistory = useMemo(() => {
    const needle = historySearch.trim().toLowerCase();
    if (!needle) return history;
    return history.filter((entry) =>
      `${entry.command} ${entry.hostLabel} ${entry.stdout}`.toLowerCase().includes(needle)
    );
  }, [history, historySearch]);

  const filteredSnippets = useMemo(() => {
    const needle = snippetSearch.trim().toLowerCase();
    if (!needle) return snippets;
    return snippets.filter((snippet) =>
      `${snippet.name} ${snippet.command} ${snippet.description} ${snippet.tags.join(' ')}`.toLowerCase().includes(needle)
    );
  }, [snippets, snippetSearch]);

  const quickSnippets = snippets.slice(0, 8);
  const hostLabel = selectedHost ? `${selectedHost.username}@${selectedHost.hostname}:${selectedHost.port}` : '未选择主机';

  return (
    <div className="view-scroll" data-testid="commands-page">
      <div className="page" style={{ maxWidth: '1320px' }}>
        <PageHeader
          eyebrow="Automation"
          title="命令与片段"
          subtitle="通过 SSH exec 通道执行一次性命令，把常用运维操作保存成可复用片段。命令不会占用交互式终端。"
          actions={
            <>
              <Button
                appearance="secondary"
                icon={<ArrowClockwiseRegular />}
                onClick={() => {
                  void loadHistory();
                  void loadSnippets();
                }}
              >
                刷新
              </Button>
              <Button appearance="primary" icon={<BookmarkRegular />} onClick={() => setSnippetDialog({ open: true, snippet: null })} data-testid="snippet-create">
                新建片段
              </Button>
            </>
          }
        />

        {hosts.length === 0 ? (
          <EmptyState
            icon={<CodeRegular />}
            title="先添加一台 SSH 主机"
            description="命令与片段需要通过已保存的主机连接执行。添加主机后即可在这里运行远程命令。"
            actions={
              <Button appearance="primary" onClick={() => setView('hosts')}>
                浏览主机
              </Button>
            }
          />
        ) : (
          <>
            <SectionCard
              title="执行命令"
              subtitle="默认通过 bash -lc 执行，输出最多保留 1 MB"
              actions={<StatusPill tone="brand" dot>SSH exec</StatusPill>}
            >
              <div className={styles.toolbarRow}>
                <Field label="目标主机" className={styles.hostField}>
                  <Dropdown
                    className={styles.hostDropdown}
                    value={selectedHost?.name ?? ''}
                    selectedOptions={selectedHostId ? [selectedHostId] : []}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) setSelectedHostId(data.optionValue);
                    }}
                    placeholder="选择目标主机"
                    data-testid="host-select"
                  >
                    {hosts.map((host) => (
                      <Option key={host.id} value={host.id} text={host.name}>
                        {host.name} · {host.username}@{host.hostname}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label="超时时间" className={styles.timeoutField}>
                  <Dropdown
                    className={styles.timeoutDropdown}
                    value={TIMEOUT_OPTIONS.find((option) => option.value === timeoutMs)?.label ?? '1 分钟'}
                    selectedOptions={[String(timeoutMs)]}
                    onOptionSelect={(_, data) => {
                      const next = Number(data.optionValue);
                      if (Number.isFinite(next)) setTimeoutMs(next);
                    }}
                  >
                    {TIMEOUT_OPTIONS.map((option) => (
                      <Option key={option.value} value={String(option.value)} text={option.label}>
                        {option.label}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <div className={styles.hostMeta}>
                  <WindowConsoleRegular />
                  {hostLabel}
                </div>
              </div>

              <div className={styles.commandArea}>
                <Textarea
                  className={styles.commandTextarea}
                  resize="vertical"
                  value={command}
                  onChange={(_, data) => setCommand(data.value)}
                  placeholder="输入要执行的远程命令，例如：uptime && df -h /"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void runCommand();
                    }
                  }}
                  data-testid="command-input"
                />
                <div className={styles.commandActions}>
                  <Button
                    appearance="primary"
                    icon={running ? <Spinner size="tiny" /> : <SendRegular />}
                    onClick={() => void runCommand()}
                    disabled={running || !command.trim() || !selectedHost}
                    data-testid="command-run"
                  >
                    {running ? '执行中…' : '执行命令'}
                  </Button>
                  <Button
                    appearance="secondary"
                    icon={<WindowConsoleRegular />}
                    onClick={() => void runInTerminal()}
                    disabled={!selectedHost}
                    data-testid="command-run-in-terminal"
                  >
                    在终端中运行
                  </Button>
                  <Button
                    appearance="subtle"
                    icon={<BroomRegular />}
                    onClick={() => {
                      setCommand('');
                      setResult(null);
                      setError(null);
                    }}
                    disabled={!command && !result && !error}
                  >
                    清空
                  </Button>
                  <span className={styles.hint}>Ctrl+Enter 执行 · 输出不会影响终端会话</span>
                </div>
                {quickSnippets.length > 0 && (
                  <div className={styles.quickSnippets}>
                    <span className={styles.quickLabel}>快速插入：</span>
                    {quickSnippets.map((snippet) => (
                      <button
                        key={snippet.id}
                        type="button"
                        className={styles.chip}
                        onClick={() => setCommand(snippet.command)}
                        title={snippet.command}
                        data-testid="quick-snippet-chip"
                      >
                        <BookmarkRegular style={{ fontSize: 12 }} />
                        {snippet.name}
                      </button>
                    ))}
                  </div>
                )}
                <CommandResultConsole result={result} error={error} running={running} minHeight={200} />
              </div>
            </SectionCard>

            <div className={styles.columns}>
              <SectionCard
                title={
                  <span className="row">
                    <HistoryRegular /> 命令历史
                  </span>
                }
                subtitle={`最近 ${history.length} 条 · 点击可填入命令`}
                actions={
                  <>
                    {historyLoading && <Spinner size="extra-tiny" />}
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<BroomRegular />}
                      onClick={() => setClearHistoryOpen(true)}
                      disabled={history.length === 0}
                      data-testid="history-clear"
                    >
                      清空
                    </Button>
                  </>
                }
              >
                <div className={styles.cardBody}>
                  <div className={styles.cardToolbar}>
                    <Input
                      className={styles.cardSearch}
                      contentBefore={<SearchRegular />}
                      value={historySearch}
                      onChange={(_, data) => setHistorySearch(data.value)}
                      placeholder="筛选命令、主机或输出…"
                      data-testid="history-search"
                    />
                  </div>
                  {filteredHistory.length === 0 ? (
                    <div className={styles.emptyPad}>
                      <EmptyState
                        compact
                        icon={<HistoryRegular />}
                        title={history.length === 0 ? '还没有命令历史' : '没有匹配的命令'}
                        description={history.length === 0 ? '执行一次远程命令后，结果会自动记录在这里。' : '换个关键词试试。'}
                      />
                    </div>
                  ) : (
                    <ul className={styles.list}>
                      {filteredHistory.map((entry) => (
                        <li key={entry.id}>
                          <div
                            className={styles.row}
                            onClick={() => {
                              setCommand(entry.command);
                              setResult(entry);
                              setError(null);
                            }}
                            data-testid="history-row"
                            data-command={entry.command}
                          >
                            <span className={styles.rowIcon}>
                              <CodeRegular />
                            </span>
                            <span className={styles.rowMain}>
                              <span className={styles.rowCommand} title={entry.command}>
                                {entry.command}
                              </span>
                              <span className={styles.rowMeta}>
                                <span className={entry.exitCode === 0 ? styles.exitOk : styles.exitBad}>
                                  退出码 {entry.exitCode ?? '—'}
                                </span>
                                <span>{entry.durationMs} ms</span>
                                <span>{entry.hostLabel}</span>
                                <span>{formatRelativeTime(entry.startedAt)}</span>
                              </span>
                            </span>
                            <span className={styles.rowActions}>
                              <Tooltip content="重新执行" relationship="label">
                                <button
                                  type="button"
                                  className={styles.iconAction}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setCommand(entry.command);
                                    if (entry.hostId && hosts.some((host) => host.id === entry.hostId)) {
                                      setSelectedHostId(entry.hostId);
                                    }
                                    void runCommand(entry.command, hosts.find((host) => host.id === entry.hostId) ?? selectedHost);
                                  }}
                                  aria-label="重新执行命令"
                                  data-testid="history-rerun"
                                >
                                  <PlayRegular />
                                </button>
                              </Tooltip>
                              <CopyButton value={entry.command} tooltip="复制命令" size="small" />
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title={
                  <span className="row">
                    <BookmarkRegular /> 片段库
                  </span>
                }
                subtitle={`${snippets.length} 个片段 · 支持标签与搜索`}
                actions={
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<BookmarkRegular />}
                    onClick={() => setSnippetDialog({ open: true, snippet: null })}
                    data-testid="snippet-create-inline"
                  >
                    新建
                  </Button>
                }
              >
                <div className={styles.cardBody}>
                  <div className={styles.cardToolbar}>
                    <Input
                      className={styles.cardSearch}
                      contentBefore={<SearchRegular />}
                      value={snippetSearch}
                      onChange={(_, data) => setSnippetSearch(data.value)}
                      placeholder="搜索片段名称、命令或标签…"
                      data-testid="snippet-search"
                    />
                    {snippetsLoading && <Spinner size="extra-tiny" />}
                  </div>
                  {filteredSnippets.length === 0 ? (
                    <div className={styles.emptyPad}>
                      <EmptyState
                        compact
                        icon={<BookmarkRegular />}
                        title={snippets.length === 0 ? '还没有命令片段' : '没有匹配的片段'}
                        description={
                          snippets.length === 0
                            ? '把常用的运维命令保存为片段，之后可以一键填入并执行。'
                            : '换个关键词，或新建一个片段。'
                        }
                        actions={
                          <Button appearance="primary" size="small" onClick={() => setSnippetDialog({ open: true, snippet: null })}>
                            新建片段
                          </Button>
                        }
                      />
                    </div>
                  ) : (
                    <ul className={styles.list}>
                      {filteredSnippets.map((snippet) => (
                        <li key={snippet.id}>
                          <div
                            className={styles.row}
                            onClick={() => setCommand(snippet.command)}
                            data-testid="snippet-row"
                            data-snippet-id={snippet.id}
                          >
                            <span className={styles.rowIcon}>
                              <BookmarkRegular />
                            </span>
                            <span className={styles.rowMain}>
                              <span className={styles.snippetName}>
                                {snippet.name}
                              </span>
                              <span className={styles.rowCommand} title={snippet.command}>
                                {snippet.command}
                              </span>
                              {snippet.tags.length > 0 && (
                                <span className={styles.snippetTags}>
                                  {snippet.tags.map((tag) => (
                                    <span key={tag} className={styles.tag}>
                                      {tag}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                            <span className={styles.rowActions}>
                              <Tooltip content="填入并执行" relationship="label">
                                <button
                                  type="button"
                                  className={styles.iconAction}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setCommand(snippet.command);
                                    void runCommand(snippet.command);
                                  }}
                                  aria-label="执行片段"
                                  data-testid="snippet-run"
                                >
                                  <PlayRegular />
                                </button>
                              </Tooltip>
                              <Tooltip content="编辑片段" relationship="label">
                                <button
                                  type="button"
                                  className={styles.iconAction}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSnippetDialog({ open: true, snippet });
                                  }}
                                  aria-label="编辑片段"
                                  data-testid="snippet-edit"
                                >
                                  <EditRegular />
                                </button>
                              </Tooltip>
                              <CopyButton value={snippet.command} tooltip="复制命令" size="small" />
                              <Tooltip content="删除片段" relationship="label">
                                <button
                                  type="button"
                                  className={mergeClasses(styles.iconAction, styles.iconActionDanger)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteTarget(snippet);
                                  }}
                                  aria-label="删除片段"
                                  data-testid="snippet-delete"
                                >
                                  <DeleteRegular />
                                </button>
                              </Tooltip>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </SectionCard>
            </div>
          </>
        )}
      </div>

      <SnippetDialog
        open={snippetDialog.open}
        snippet={snippetDialog.snippet}
        onClose={() => setSnippetDialog({ open: false, snippet: null })}
        onSaved={(saved) => {
          setSnippets((previous) => {
            const exists = previous.some((snippet) => snippet.id === saved.id);
            return exists ? previous.map((snippet) => (snippet.id === saved.id ? saved : snippet)) : [saved, ...previous];
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除命令片段"
        message={`确定要删除片段「${deleteTarget?.name ?? ''}」吗？此操作无法撤销。`}
        confirmLabel="删除"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void removeSnippet()}
      />

      <ConfirmDialog
        open={clearHistoryOpen}
        title="清空命令历史"
        message="将删除所有已记录的命令历史（包括其他主机的记录）。此操作无法撤销。"
        confirmLabel="清空历史"
        danger
        onCancel={() => setClearHistoryOpen(false)}
        onConfirm={() => void clearHistory()}
      />
    </div>
  );
}
