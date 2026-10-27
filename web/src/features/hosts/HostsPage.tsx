import {
  Badge,
  Button,
  Dropdown,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Spinner,
  Tooltip,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import {
  AddRegular,
  AppsListRegular,
  ArrowExportRegular,
  ArrowImportRegular,
  DeleteRegular,
  EditRegular,
  FlashRegular,
  FolderAddRegular,
  FolderOpenRegular,
  GridRegular,
  MoreHorizontalRegular,
  SearchRegular,
  StarFilled,
  StarRegular,
  ArrowUploadRegular
} from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import type { HostGroup, HostProfile } from '@shared/types';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { useAppStore } from '../../store/app';
import { downloadTextFile } from '../../lib/format';
import { useWorkspaceStore } from '../workspace/store';
import { openSftp, openTerminal } from '../workspace/session-actions';
import { GroupDialog } from './GroupDialog';
import { HostCard } from './HostCard';
import { HostCommandDialog } from './HostCommandDialog';
import { HostDialog } from './HostDialog';
import { ExportSshConfigDialog, ImportSshConfigDialog } from './ImportExportDialogs';
import { QuickConnectDialog } from './QuickConnectDialog';

const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gridTemplateColumns: '218px minmax(0, 1fr)',
    gap: '16px',
    alignItems: 'start'
  },
  rail: {
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '12px',
    boxShadow: tokens.shadow2,
    padding: '8px',
    position: 'sticky',
    top: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  railHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px 8px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    color: tokens.colorNeutralForeground3
  },
  groupItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    width: '100%',
    minHeight: '34px',
    padding: '0 9px',
    border: 'none',
    borderRadius: '7px',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontSize: '12.5px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    ':hover': { background: tokens.colorNeutralBackground3 }
  },
  groupItemActive: {
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: 600,
    ':hover': { background: tokens.colorBrandBackground2 }
  },
  groupIcon: { fontSize: '16px', display: 'flex', flexShrink: 0 },
  groupDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  groupName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  count: {
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground4,
    fontVariantNumeric: 'tabular-nums',
    minWidth: '16px',
    textAlign: 'right'
  },
  groupActions: { opacity: 0, ':hover': { opacity: 1 } },
  railFooter: {
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    marginTop: '6px',
    paddingTop: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  content: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  },
  search: { width: '300px', maxWidth: '100%' },
  toolbarRight: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(292px, 1fr))',
    gap: '12px'
  },
  list: { display: 'flex', flexDirection: 'column', gap: '6px' },
  loading: { display: 'grid', placeItems: 'center', height: '240px' },
  emptyWrap: {
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: '12px',
    background: tokens.colorNeutralBackground1
  },
  hintBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground4
  }
});

type GroupFilter = 'all' | 'favorites' | 'ungrouped' | string;
type SortKey = 'name' | 'lastConnected' | 'created';

export default function HostsPage() {
  const styles = useStyles();
  const hosts = useAppStore((state) => state.hosts);
  const groups = useAppStore((state) => state.groups);
  const settings = useAppStore((state) => state.settings);
  const notify = useAppStore((state) => state.notify);
  const upsertHost = useAppStore((state) => state.upsertHost);
  const removeHostLocal = useAppStore((state) => state.removeHostLocal);
  const refreshHosts = useAppStore((state) => state.refreshHosts);
  const refreshGroups = useAppStore((state) => state.refreshGroups);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const tabs = useWorkspaceStore((state) => state.tabs);

  const [filter, setFilter] = useState<GroupFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [localBusy, setLocalBusy] = useState(false);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<HostProfile | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<HostGroup | null>(null);
  const [deleteHostTarget, setDeleteHostTarget] = useState<HostProfile | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<HostGroup | null>(null);
  const [commandHost, setCommandHost] = useState<HostProfile | null>(null);

  const view = settings?.ui.hostView ?? 'grid';

  const activeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tab of tabs) {
      if (!tab.hostId) continue;
      if (['connected', 'connecting', 'awaiting-auth'].includes(tab.state)) {
        map.set(tab.hostId, (map.get(tab.hostId) ?? 0) + 1);
      }
    }
    return map;
  }, [tabs]);

  const groupName = (groupId: string | null) => groups.find((group) => group.id === groupId)?.name;

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let favorites = 0;
    let ungrouped = 0;
    for (const host of hosts) {
      if (host.favorite) favorites += 1;
      if (host.groupId) map.set(host.groupId, (map.get(host.groupId) ?? 0) + 1);
      else ungrouped += 1;
    }
    return { map, favorites, ungrouped };
  }, [hosts]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let result = hosts.filter((host) => {
      if (filter === 'favorites' && !host.favorite) return false;
      if (filter === 'ungrouped' && host.groupId) return false;
      if (filter !== 'all' && filter !== 'favorites' && filter !== 'ungrouped' && host.groupId !== filter) return false;
      if (!needle) return true;
      const haystack = [host.name, host.hostname, host.username, host.notes, ...host.tags].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    result = [...result].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      if (sort === 'lastConnected') return (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0);
      return b.createdAt - a.createdAt;
    });
    return result;
  }, [hosts, filter, search, sort]);

  const openNewHost = () => {
    setEditingHost(null);
    setHostDialogOpen(true);
  };

  useEffect(() => {
    const onNewHost = () => openNewHost();
    const onQuickConnect = () => setQuickOpen(true);
    const onOpenHost = (event: Event) => {
      const detail = (event as CustomEvent<{ hostId: string; action?: 'terminal' | 'files' }>).detail;
      const host = useAppStore.getState().hosts.find((item) => item.id === detail.hostId);
      if (!host) return;
      if (detail.action === 'files') void openSftp({ hostId: host.id, host });
      else void openTerminal({ hostId: host.id, host });
    };
    window.addEventListener('fluentssh:new-host', onNewHost);
    window.addEventListener('fluentssh:quick-connect', onQuickConnect);
    window.addEventListener('fluentssh:open-host', onOpenHost);
    return () => {
      window.removeEventListener('fluentssh:new-host', onNewHost);
      window.removeEventListener('fluentssh:quick-connect', onQuickConnect);
      window.removeEventListener('fluentssh:open-host', onOpenHost);
    };
  }, []);

  const toggleFavorite = async (host: HostProfile) => {
    try {
      const result = await api.hosts.update(host.id, { favorite: !host.favorite });
      upsertHost(result.host);
    } catch (error) {
      notify('error', '更新收藏失败', errorMessage(error));
    }
  };

  const duplicate = async (host: HostProfile) => {
    try {
      const result = await api.hosts.duplicate(host.id);
      upsertHost(result.host);
      notify('success', '主机已复制', result.host.name);
    } catch (error) {
      notify('error', '复制主机失败', errorMessage(error));
    }
  };

  const exportHost = async (host: HostProfile) => {
    try {
      const { content } = await api.hosts.exportHostConfig(host.id);
      downloadTextFile(`${host.name.replace(/[^\w.-]+/g, '-')}-ssh-config`, content);
      notify('success', '已导出 SSH Config', host.name);
    } catch (error) {
      notify('error', '导出失败', errorMessage(error));
    }
  };

  const confirmDeleteHost = async () => {
    if (!deleteHostTarget) return;
    await api.hosts.remove(deleteHostTarget.id);
    removeHostLocal(deleteHostTarget.id);
    notify('success', '主机已删除', deleteHostTarget.name);
    setDeleteHostTarget(null);
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroupTarget) return;
    await api.groups.remove(deleteGroupTarget.id);
    if (filter === deleteGroupTarget.id) setFilter('all');
    await Promise.all([refreshGroups(), refreshHosts()]);
    notify('success', '分组已删除', '分组中的主机已移动到未分组。');
    setDeleteGroupTarget(null);
  };

  const changeView = (next: 'grid' | 'list') => void updateSettings({ ui: { hostView: next } });

  const refreshAll = async () => {
    setLocalBusy(true);
    try {
      await Promise.all([refreshHosts(), refreshGroups()]);
    } catch (error) {
      notify('error', '刷新失败', errorMessage(error));
    } finally {
      setLocalBusy(false);
    }
  };

  const groupFilterLabel =
    filter === 'all'
      ? '全部主机'
      : filter === 'favorites'
        ? '收藏'
        : filter === 'ungrouped'
          ? '未分组'
          : groupName(filter) ?? '分组';

  return (
    <div className="view-scroll">
      <div className="page">
        <PageHeader
          eyebrow="Connections"
          title="SSH 主机"
          subtitle="集中管理服务器、凭据、跳板机与连接偏好。双击主机卡片即可连接。"
          badge={<Badge appearance="tint" color="brand">{hosts.length} 台</Badge>}
          actions={
            <>
              <Button appearance="secondary" icon={<FlashRegular />} onClick={() => setQuickOpen(true)} data-testid="quick-connect">
                快速连接
              </Button>
              <Button appearance="primary" icon={<AddRegular />} onClick={openNewHost} data-testid="new-host">
                新建主机
              </Button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button appearance="subtle" icon={<MoreHorizontalRegular />} aria-label="更多操作" />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<FolderAddRegular />} onClick={() => { setEditingGroup(null); setGroupDialogOpen(true); }}>
                      新建分组
                    </MenuItem>
                    <MenuItem icon={<ArrowImportRegular />} onClick={() => setImportOpen(true)}>
                      从 SSH Config 导入
                    </MenuItem>
                    <MenuItem icon={<ArrowExportRegular />} onClick={() => setExportOpen(true)}>
                      导出 SSH Config
                    </MenuItem>
                    <MenuItem icon={<ArrowUploadRegular />} onClick={() => void refreshAll()}>
                      刷新数据
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </>
          }
        />

        <div className={styles.layout}>
          <aside className={styles.rail}>
            <div className={styles.railHeader}>
              分组
              <Tooltip content="新建分组" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<AddRegular />}
                  aria-label="新建分组"
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupDialogOpen(true);
                  }}
                />
              </Tooltip>
            </div>
            <button
              type="button"
              className={`${styles.groupItem}${filter === 'all' ? ` ${styles.groupItemActive}` : ''}`}
              onClick={() => setFilter('all')}
            >
              <span className={styles.groupIcon}><GridRegular /></span>
              <span className={styles.groupName}>全部主机</span>
              <span className={styles.count}>{hosts.length}</span>
            </button>
            <button
              type="button"
              className={`${styles.groupItem}${filter === 'favorites' ? ` ${styles.groupItemActive}` : ''}`}
              onClick={() => setFilter('favorites')}
            >
              <span className={styles.groupIcon}><StarRegular /></span>
              <span className={styles.groupName}>收藏</span>
              <span className={styles.count}>{counts.favorites}</span>
            </button>
            {groups.map((group) => (
              <div key={group.id} style={{ position: 'relative' }}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`${styles.groupItem}${filter === group.id ? ` ${styles.groupItemActive}` : ''}`}
                  onClick={() => setFilter(group.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setFilter(group.id);
                  }}
                >
                  <span className={styles.groupDot} style={{ background: group.color }} />
                  <span className={styles.groupName}>{group.name}</span>
                  <span className={styles.count}>{counts.map.get(group.id) ?? 0}</span>
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<MoreHorizontalRegular />}
                        className={styles.groupActions}
                        aria-label="分组操作"
                        onClick={(event) => event.stopPropagation()}
                      />
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        <MenuItem
                          icon={<EditRegular />}
                          onClick={() => {
                            setEditingGroup(group);
                            setGroupDialogOpen(true);
                          }}
                        >
                          编辑分组
                        </MenuItem>
                        <MenuItem icon={<DeleteRegular />} onClick={() => setDeleteGroupTarget(group)}>
                          删除分组
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                </div>
              </div>
            ))}
            <button
              type="button"
              className={`${styles.groupItem}${filter === 'ungrouped' ? ` ${styles.groupItemActive}` : ''}`}
              onClick={() => setFilter('ungrouped')}
            >
              <span className={styles.groupIcon}><FolderOpenRegular /></span>
              <span className={styles.groupName}>未分组</span>
              <span className={styles.count}>{counts.ungrouped}</span>
            </button>
            <div className={styles.railFooter}>
              <Button appearance="subtle" size="small" icon={<FolderAddRegular />} onClick={() => { setEditingGroup(null); setGroupDialogOpen(true); }} style={{ justifyContent: 'flex-start' }}>
                管理分组
              </Button>
            </div>
          </aside>

          <section className={styles.content}>
            <div className={styles.toolbar}>
              <Input
                className={styles.search}
                contentBefore={<SearchRegular />}
                placeholder="搜索主机、地址或标签…"
                value={search}
                onChange={(_, data) => setSearch(data.value)}
                data-testid="host-search"
              />
              <div className={styles.toolbarRight}>
                <Dropdown
                  value={sortLabel(sort)}
                  selectedOptions={[sort]}
                  onOptionSelect={(_, data) => setSort(data.optionValue as SortKey)}
                  style={{ minWidth: '132px' }}
                >
                  <Option value="name">按名称排序</Option>
                  <Option value="lastConnected">最近连接</Option>
                  <Option value="created">最近创建</Option>
                </Dropdown>
                <Tooltip content="网格视图" relationship="label">
                  <Button
                    appearance={view === 'grid' ? 'primary' : 'subtle'}
                    icon={<GridRegular />}
                    onClick={() => changeView('grid')}
                    aria-label="网格视图"
                  />
                </Tooltip>
                <Tooltip content="列表视图" relationship="label">
                  <Button
                    appearance={view === 'list' ? 'primary' : 'subtle'}
                    icon={<AppsListRegular />}
                    onClick={() => changeView('list')}
                    aria-label="列表视图"
                  />
                </Tooltip>
                <Tooltip content="刷新" relationship="label">
                  <Button appearance="subtle" onClick={() => void refreshAll()} aria-label="刷新" icon={localBusy ? <Spinner size="tiny" /> : undefined}>
                    {!localBusy && '刷新'}
                  </Button>
                </Tooltip>
              </div>
            </div>

            <div className={styles.hintBar}>
              <span>{groupFilterLabel}</span>
              <span>·</span>
              <span>{filtered.length} 台主机</span>
              {search && (
                <>
                  <span>·</span>
                  <span>搜索 “{search}”</span>
                </>
              )}
            </div>

            {hosts.length === 0 ? (
              <div className={styles.emptyWrap}>
                <EmptyState
                  icon={<FolderOpenRegular />}
                  title="还没有 SSH 主机"
                  description="添加你的第一台服务器，或从现有 ~/.ssh/config 导入。所有密码和私钥口令都会加密保存在本地保险库。"
                  actions={
                    <>
                      <Button appearance="primary" icon={<AddRegular />} onClick={openNewHost}>
                        新建主机
                      </Button>
                      <Button appearance="secondary" icon={<ArrowImportRegular />} onClick={() => setImportOpen(true)}>
                        从 SSH Config 导入
                      </Button>
                      <Button appearance="subtle" icon={<FlashRegular />} onClick={() => setQuickOpen(true)}>
                        快速连接
                      </Button>
                    </>
                  }
                />
              </div>
            ) : filtered.length === 0 ? (
              <div className={styles.emptyWrap}>
                <EmptyState
                  icon={<SearchRegular />}
                  compact
                  title="没有匹配的主机"
                  description="尝试更换搜索关键词或选择其他分组。"
                  actions={
                    <Button
                      appearance="secondary"
                      onClick={() => {
                        setSearch('');
                        setFilter('all');
                      }}
                    >
                      清除筛选
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className={view === 'grid' ? styles.grid : styles.list}>
                {filtered.map((host) => (
                  <HostCard
                    key={host.id}
                    host={host}
                    groupName={groupName(host.groupId)}
                    view={view}
                    activeSessions={activeCounts.get(host.id) ?? 0}
                    onConnect={() => void openTerminal({ hostId: host.id, host })}
                    onFiles={() => void openSftp({ hostId: host.id, host, initialPath: host.defaultPath || undefined })}
                    onEdit={() => {
                      setEditingHost(host);
                      setHostDialogOpen(true);
                    }}
                    onDuplicate={() => void duplicate(host)}
                    onDelete={() => setDeleteHostTarget(host)}
                    onFavorite={() => void toggleFavorite(host)}
                    onRunCommand={() => setCommandHost(host)}
                    onExport={() => void exportHost(host)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <HostDialog
        open={hostDialogOpen}
        host={editingHost}
        groups={groups}
        hosts={hosts}
        initialGroupId={filter !== 'all' && filter !== 'favorites' && filter !== 'ungrouped' ? filter : null}
        onClose={() => setHostDialogOpen(false)}
        onSaved={(host) => upsertHost(host)}
      />
      <QuickConnectDialog open={quickOpen} onClose={() => setQuickOpen(false)} />
      <ImportSshConfigDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void Promise.all([refreshHosts(), refreshGroups()])}
      />
      <ExportSshConfigDialog open={exportOpen} onClose={() => setExportOpen(false)} hosts={hosts} />
      <GroupDialog
        open={groupDialogOpen}
        group={editingGroup}
        onClose={() => setGroupDialogOpen(false)}
        onSaved={() => void refreshGroups()}
      />
      <HostCommandDialog host={commandHost} open={Boolean(commandHost)} onClose={() => setCommandHost(null)} />
      <ConfirmDialog
        open={Boolean(deleteHostTarget)}
        title={`删除主机 ${deleteHostTarget?.name ?? ''}`}
        message={`确定删除 ${deleteHostTarget?.name ?? ''}？该主机保存的密码/密钥口令会一并从保险库中删除，已打开的会话不会自动关闭。`}
        confirmLabel="删除"
        danger
        onCancel={() => setDeleteHostTarget(null)}
        onConfirm={confirmDeleteHost}
      />
      <ConfirmDialog
        open={Boolean(deleteGroupTarget)}
        title={`删除分组 ${deleteGroupTarget?.name ?? ''}`}
        message="分组内的主机不会被删除，它们会移动到「未分组」。"
        confirmLabel="删除分组"
        danger
        onCancel={() => setDeleteGroupTarget(null)}
        onConfirm={confirmDeleteGroup}
      />
    </div>
  );
}

function sortLabel(sort: SortKey) {
  switch (sort) {
    case 'name':
      return '按名称排序';
    case 'lastConnected':
      return '最近连接';
    case 'created':
      return '最近创建';
  }
}
