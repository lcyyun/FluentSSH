import {
  Dialog,
  DialogSurface,
  Input,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowRightRegular,
  ArrowRoutingRegular,
  CodeRegular,
  DesktopMacRegular,
  DocumentBulletListRegular,
  FolderOpenRegular,
  KeyRegular,
  LockClosedRegular,
  SearchRegular,
  SettingsRegular,
  ShieldKeyholeRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular
} from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppView } from '../store/app';
import { useAppStore } from '../store/app';
import { useEffectiveMode } from '../theme';
const useStyles = makeStyles({
  surface: {
    width: '640px',
    maxWidth: 'calc(100vw - 40px)',
    padding: 0,
    overflow: 'hidden'
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
  },
  input: { flex: 1 },
  list: {
    maxHeight: '52vh',
    overflowY: 'auto',
    padding: '8px'
  },
  section: {
    fontSize: '10.5px',
    fontWeight: 600,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: tokens.colorNeutralForeground4,
    padding: '8px 10px 4px'
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '13px',
    color: tokens.colorNeutralForeground1
  },
  itemActive: {
    background: tokens.colorNeutralBackground3,
    outline: `1px solid ${tokens.colorNeutralStroke2}`
  },
  itemIcon: {
    width: '26px',
    height: '26px',
    borderRadius: '7px',
    display: 'grid',
    placeItems: 'center',
    background: tokens.colorNeutralBackground3,
    color: tokens.colorBrandForeground1,
    flexShrink: 0
  },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { fontWeight: 500 },
  itemSub: { fontSize: '11px', color: tokens.colorNeutralForeground3, marginTop: '1px' },
  hint: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 14px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3
  },
  empty: { padding: '32px 16px', textAlign: 'center', color: tokens.colorNeutralForeground3, fontSize: '12.5px' }
});

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  section: '主机' | '操作';
  keywords: string;
  run: () => void;
}

const VIEW_COMMANDS: Array<{ view: AppView; title: string; icon: ReactNode }> = [
  { view: 'workspace', title: '会话工作区', icon: <DesktopMacRegular /> },
  { view: 'tunnels', title: 'SSH 隧道', icon: <ArrowRoutingRegular /> },
  { view: 'commands', title: '命令与片段', icon: <CodeRegular /> },
  { view: 'security', title: '密钥与 Known Hosts', icon: <ShieldKeyholeRegular /> },
  { view: 'logs', title: '日志与审计', icon: <DocumentBulletListRegular /> },
  { view: 'settings', title: '设置', icon: <SettingsRegular /> }
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const styles = useStyles();
  const hosts = useAppStore((state) => state.hosts);
  const groups = useAppStore((state) => state.groups);
  const setView = useAppStore((state) => state.setView);
  const lockVault = useAppStore((state) => state.lockVault);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const mode = useEffectiveMode(settings?.theme ?? 'light');
  const notify = useAppStore((state) => state.notify);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groupName = (groupId: string | null) => groups.find((group) => group.id === groupId)?.name;

  const commands = useMemo<Command[]>(() => {
    const hostCommands: Command[] =
      hosts.length > 0
        ? hosts.map((host) => ({
            id: `host-${host.id}`,
            title: host.name,
            subtitle: `${host.username}@${host.hostname}:${host.port}${groupName(host.groupId) ? ` · ${groupName(host.groupId)}` : ''}`,
            icon: <DesktopMacRegular />,
            section: '主机' as const,
            keywords: `${host.name} ${host.hostname} ${host.username} ${host.tags.join(' ')}`,
            run: () => {
              window.dispatchEvent(
                new CustomEvent('fluentssh:open-host', { detail: { hostId: host.id, action: 'terminal' } })
              );
            }
          }))
        : [];

    const actions: Command[] = [
      {
        id: 'new-host',
        title: '新建 SSH 主机',
        subtitle: '添加连接配置、密码或密钥',
        icon: <AddRegular />,
        section: '操作',
        keywords: 'new host 新建 主机 add',
        run: () => {
          setView('hosts');
          window.dispatchEvent(new CustomEvent('fluentssh:new-host'));
        }
      },
      ...VIEW_COMMANDS.map<Command>((entry) => ({
        id: `view-${entry.view}`,
        title: entry.title,
        icon: entry.icon,
        section: '操作',
        keywords: `view ${entry.view} 导航`,
        run: () => setView(entry.view)
      })),
      {
        id: 'toggle-theme',
        title: mode === 'dark' ? '切换到浅色主题' : '切换到深色主题',
        icon: mode === 'dark' ? <WeatherSunnyRegular /> : <WeatherMoonRegular />,
        section: '操作',
        keywords: 'theme dark light 主题 深色 浅色',
        run: () => void updateSettings({ theme: mode === 'dark' ? 'light' : 'dark' })
      },
      {
        id: 'lock-vault',
        title: '锁定保险库',
        icon: <LockClosedRegular />,
        section: '操作',
        keywords: 'lock vault 锁定 保险库',
        run: () => void lockVault()
      },
      {
        id: 'open-files',
        title: '打开文件管理',
        subtitle: '在会话工作区中浏览 SFTP 文件',
        icon: <FolderOpenRegular />,
        section: '操作',
        keywords: 'sftp files 文件 管理',
        run: () => {
          setView('workspace');
          window.dispatchEvent(new CustomEvent('fluentssh:open-files'));
        }
      },
      {
        id: 'open-keys',
        title: '管理 SSH 密钥',
        icon: <KeyRegular />,
        section: '操作',
        keywords: 'keys ssh 密钥',
        run: () => setView('security')
      }
    ];
    return [...hostCommands, ...actions];
  }, [hosts, groups, mode, setView, lockVault, updateSettings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.slice(0, 12);
    const scored = commands
      .map((command) => {
        const haystack = `${command.title} ${command.subtitle ?? ''} ${command.keywords}`.toLowerCase();
        const title = command.title.toLowerCase();
        let score = 0;
        if (title === needle) score = 100;
        else if (title.startsWith(needle)) score = 80;
        else if (title.includes(needle)) score = 60;
        else if (haystack.includes(needle)) score = 40;
        return { command, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 20).map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setBusy(false);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const run = (command: Command | undefined) => {
    if (!command || busy) return;
    setBusy(true);
    onOpenChange(false);
    window.setTimeout(() => {
      try {
        command.run();
      } catch (error) {
        notify('error', '命令执行失败', error instanceof Error ? error.message : String(error));
      }
    }, 10);
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className={styles.surface} aria-label="命令面板">
        <div className={styles.searchRow}>
          <SearchRegular />
          <Input
            ref={inputRef}
            className={styles.input}
            appearance="underline"
            placeholder="搜索主机或执行操作…"
            value={query}
            onChange={(_, data) => setQuery(data.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(filtered[activeIndex]);
              } else if (event.key === 'Escape') {
                onOpenChange(false);
              }
            }}
            data-testid="command-palette-input"
          />
          {busy && <Spinner size="tiny" />}
        </div>
        <div className={styles.list} ref={listRef}>
          {filtered.length === 0 && <div className={styles.empty}>没有匹配的主机或操作</div>}
          {filtered.map((command, index) => {
            const previous = filtered[index - 1];
            const showSection = !previous || previous.section !== command.section;
            return (
              <div key={command.id}>
                {showSection && <div className={styles.section}>{command.section}</div>}
                <div
                  className={mergeClasses(styles.item, index === activeIndex && styles.itemActive)}
                  data-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(command)}
                  data-testid={`command-item-${index}`}
                >
                  <span className={styles.itemIcon}>{command.icon}</span>
                  <span className={styles.itemText}>
                    <div className={styles.itemTitle}>{command.title}</div>
                    {command.subtitle && <div className={styles.itemSub}>{command.subtitle}</div>}
                  </span>
                  <ArrowRightRegular style={{ color: tokens.colorNeutralForeground4 }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.hint}>
          <span>
            <span className="kbd-chip">↑↓</span> 选择 · <span className="kbd-chip">Enter</span> 打开
          </span>
          <span>
            <span className="kbd-chip">Esc</span> 关闭
          </span>
        </div>
      </DialogSurface>
    </Dialog>
  );
}

export type { AppView };
