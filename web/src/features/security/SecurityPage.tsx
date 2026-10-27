import {
  Button,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Tab,
  TabList,
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
  AddRegular,
  ArrowExportRegular,
  ArrowImportRegular,
  ArrowSyncRegular,
  DeleteRegular,
  EditRegular,
  InfoRegular,
  KeyRegular,
  LockClosedRegular,
  SearchRegular,
  ShieldCheckmarkRegular,
  ShieldKeyholeRegular
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KnownHost, SshKeyMeta } from '@shared/types';
import { api } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { StatusPill } from '../../components/StatusPill';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { useAppStore } from '../../store/app';
import {
  ImportKnownHostsDialog,
  ExportKnownHostsDialog,
  TrustKnownHostDialog
} from './KnownHostDialogs';
import { KeyDetailsDrawer, KeyGenerateDialog, KeyImportDialog, KeyRenameDialog } from './KeyDialogs';
import {
  KEY_ALGORITHM_LABELS,
  fingerprintPreview,
  friendlyApiError,
  isKeyInUseError,
  keyInUseHostNames,
  knownHostSourceTone,
  sourceLabel
} from './security-utils';

const useStyles = makeStyles({
  tabs: { marginTop: '-4px' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    padding: '11px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    background: tokens.colorNeutralBackground2
  },
  search: { width: '280px', maxWidth: '100%' },
  spacer: { flex: 1, minWidth: '8px' },
  banner: { margin: '12px 16px 0' },
  tableWrap: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '880px', tableLayout: 'fixed' },
  colKeyName: { width: '27%' },
  colKeyAlgo: { width: '11%' },
  colKeyFingerprint: { width: '30%' },
  colKeyCreated: { width: '16%' },
  colKeyActions: { width: '16%' },
  colKhHost: { width: '27%' },
  colKhType: { width: '14%' },
  colKhFingerprint: { width: '25%' },
  colKhAdded: { width: '12%' },
  colKhSeen: { width: '12%' },
  colKhActions: { width: '10%' },
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
  nameCell: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '150px' },
  nameRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  name: { fontSize: '13px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  badge: {
    fontSize: '9.5px',
    fontWeight: 600,
    padding: '0 5px',
    height: '15px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    borderRadius: '4px',
    letterSpacing: '0.2px'
  },
  badgeGenerated: {
    color: tokens.colorPaletteBlueForeground2,
    background: tokens.colorPaletteBlueBackground2,
    border: `1px solid ${tokens.colorPaletteBlueBorderActive}`
  },
  badgeImported: {
    color: tokens.colorNeutralForeground2,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`
  },
  badgePlain: {
    color: tokens.colorPaletteYellowForeground1,
    background: tokens.colorPaletteYellowBackground2,
    border: `1px solid ${tokens.colorPaletteYellowBorder2}`
  },
  sub: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%'
  },
  fingerprint: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block',
    width: '100%',
    maxWidth: '100%'
  },
  algCell: { display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' },
  algMeta: { fontSize: '10.5px', color: tokens.colorNeutralForeground4, fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: '11.5px' },
  date: { fontSize: '11.5px', color: tokens.colorNeutralForeground2, whiteSpace: 'nowrap' },
  actions: { display: 'flex', alignItems: 'center', gap: '1px', justifyContent: 'flex-end' },
  danger: { color: tokens.colorPaletteRedForeground1 },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '40px',
    color: tokens.colorNeutralForeground3
  },
  emptyPad: { padding: '16px' },
  hideMd: { '@media (max-width: 1180px)': { display: 'none' } },
  hideLg: { '@media (max-width: 1360px)': { display: 'none' } },
  sourceCell: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  hostName: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  keyType: { fontFamily: tokens.fontFamilyMonospace, fontSize: '11px', color: tokens.colorNeutralForeground2 },
  errorPad: { padding: '14px 16px' }
});

type TabValue = 'keys' | 'known-hosts';

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  copy[index] = next;
  return copy;
}

export default function SecurityPage() {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const vault = useAppStore((state) => state.vault);

  const [tab, setTab] = useState<TabValue>('keys');

  const [keys, setKeys] = useState<SshKeyMeta[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysQuery, setKeysQuery] = useState('');

  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([]);
  const [knownHostsLoading, setKnownHostsLoading] = useState(true);
  const [knownHostsError, setKnownHostsError] = useState<string | null>(null);
  const [knownHostsQuery, setKnownHostsQuery] = useState('');

  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SshKeyMeta | null>(null);
  const [deleteKeyTarget, setDeleteKeyTarget] = useState<SshKeyMeta | null>(null);
  const [detailsKey, setDetailsKey] = useState<SshKeyMeta | null>(null);

  const [trustOpen, setTrustOpen] = useState(false);
  const [knownHostsImportOpen, setKnownHostsImportOpen] = useState(false);
  const [knownHostsExportOpen, setKnownHostsExportOpen] = useState(false);
  const [deleteKnownHostTarget, setDeleteKnownHostTarget] = useState<KnownHost | null>(null);

  const refreshKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const result = await api.keys.list();
      setKeys(result.keys);
      setKeysError(null);
    } catch (error) {
      setKeysError(friendlyApiError(error));
    } finally {
      setKeysLoading(false);
    }
  }, []);

  const refreshKnownHosts = useCallback(async () => {
    setKnownHostsLoading(true);
    try {
      const result = await api.knownHosts.list();
      setKnownHosts(result.knownHosts);
      setKnownHostsError(null);
    } catch (error) {
      setKnownHostsError(friendlyApiError(error));
    } finally {
      setKnownHostsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshKeys();
    void refreshKnownHosts();
  }, [refreshKeys, refreshKnownHosts]);

  const filteredKeys = useMemo(() => {
    const needle = keysQuery.trim().toLowerCase();
    if (!needle) return keys;
    return keys.filter((key) =>
      `${key.name} ${key.comment} ${key.fingerprint} ${KEY_ALGORITHM_LABELS[key.algorithm]} ${key.bits} ${key.publicKey}`
        .toLowerCase()
        .includes(needle)
    );
  }, [keys, keysQuery]);

  const filteredKnownHosts = useMemo(() => {
    const needle = knownHostsQuery.trim().toLowerCase();
    if (!needle) return knownHosts;
    return knownHosts.filter((entry) =>
      `${entry.hostname}:${entry.port} ${entry.keyType} ${entry.fingerprint} ${sourceLabel(entry.source)}`
        .toLowerCase()
        .includes(needle)
    );
  }, [knownHosts, knownHostsQuery]);

  const refreshActive = () => {
    if (tab === 'keys') void refreshKeys();
    else void refreshKnownHosts();
  };

  const handleKeySaved = (key: SshKeyMeta, kind: 'generated' | 'imported' | 'renamed') => {
    setKeys((current) => upsertById(current, key));
    if (kind === 'renamed') {
      setDetailsKey((current) => (current && current.id === key.id ? key : current));
      notify('success', '密钥信息已更新', key.name);
    } else {
      setDetailsKey(key);
      notify(
        'success',
        kind === 'generated' ? 'SSH 密钥已生成' : 'SSH 密钥已导入',
        key.hasPassphrase ? '私钥已加密保存在保险库中，并设置了口令保护。' : '私钥已加密保存在本机保险库中。'
      );
    }
    void refreshKeys();
  };

  const deleteKey = async () => {
    if (!deleteKeyTarget) return;
    try {
      await api.keys.remove(deleteKeyTarget.id);
      setKeys((current) => current.filter((key) => key.id !== deleteKeyTarget.id));
      if (detailsKey?.id === deleteKeyTarget.id) setDetailsKey(null);
      notify('success', '密钥已删除', deleteKeyTarget.name);
    } catch (error) {
      const inUse = isKeyInUseError(error);
      const hostNames = keyInUseHostNames(error);
      notify(
        'error',
        '无法删除密钥',
        inUse
          ? `该密钥仍被${hostNames.length > 0 ? `主机 ${hostNames.join('、')} ` : '主机'}使用，请先在主机配置中更换密钥后再删除。`
          : friendlyApiError(error)
      );
    } finally {
      setDeleteKeyTarget(null);
    }
  };

  const deleteKnownHost = async () => {
    if (!deleteKnownHostTarget) return;
    try {
      await api.knownHosts.remove(deleteKnownHostTarget.id);
      setKnownHosts((current) => current.filter((entry) => entry.id !== deleteKnownHostTarget.id));
      notify('success', '已删除 Known Host 记录', `${deleteKnownHostTarget.hostname}:${deleteKnownHostTarget.port}`);
    } catch (error) {
      notify('error', '删除 Known Host 失败', friendlyApiError(error));
    } finally {
      setDeleteKnownHostTarget(null);
    }
  };

  const vaultBadge = vault?.protected ? (
    vault.unlocked ? (
      <StatusPill tone="success" dot>
        保险库已解锁
      </StatusPill>
    ) : (
      <StatusPill tone="warning" dot>
        保险库已锁定
      </StatusPill>
    )
  ) : (
    <StatusPill tone="neutral" dot>
      本地密钥库
    </StatusPill>
  );

  return (
    <div className="view-scroll">
      <div className="page">
        <PageHeader
          eyebrow="Security"
          title="密钥与 Known Hosts"
          subtitle="管理本机 SSH 密钥、公钥分发，以及受信任的主机指纹。"
          badge={vaultBadge}
          actions={
            <Tooltip content="刷新列表" relationship="label">
              <Button
                appearance="subtle"
                icon={<ArrowSyncRegular />}
                onClick={refreshActive}
                disabled={tab === 'keys' ? keysLoading : knownHostsLoading}
                aria-label="刷新"
                data-testid="security-refresh"
              />
            </Tooltip>
          }
        />

        <TabList
          selectedValue={tab}
          onTabSelect={(_, data) => setTab(data.value as TabValue)}
          className={styles.tabs}
          data-testid="security-tabs"
        >
          <Tab value="keys" icon={<KeyRegular />} data-testid="security-tab-keys">
            SSH 密钥
          </Tab>
          <Tab value="known-hosts" icon={<ShieldKeyholeRegular />} data-testid="security-tab-known-hosts">
            Known Hosts
          </Tab>
        </TabList>

        {tab === 'keys' ? (
          <SectionCard
            title="SSH 密钥"
            subtitle={`${keys.length} 个密钥 · 私钥保存在本机加密保险库中`}
            flush
          >
            <div className={styles.toolbar}>
              <Input
                value={keysQuery}
                onChange={(_, data) => setKeysQuery(data.value)}
                placeholder="搜索名称、指纹或算法…"
                contentBefore={<SearchRegular />}
                size="small"
                className={styles.search}
                data-testid="key-search"
              />
              <span className={styles.spacer} />
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowImportRegular />}
                onClick={() => setImportOpen(true)}
                data-testid="key-import"
              >
                导入密钥
              </Button>
              <Button
                appearance="primary"
                size="small"
                icon={<AddRegular />}
                onClick={() => setGenerateOpen(true)}
                data-testid="key-generate"
              >
                生成密钥
              </Button>
            </div>

            {keysError && (
              <MessageBar intent="warning" className={styles.banner}>
                <MessageBarBody>
                  <MessageBarTitle>密钥列表加载失败</MessageBarTitle>
                  {keysError}
                </MessageBarBody>
                <MessageBarActions>
                  <Button size="small" onClick={() => void refreshKeys()}>
                    重试
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}

            {keysLoading && keys.length === 0 ? (
              <div className={styles.loading}>
                <Spinner size="small" /> 正在加载 SSH 密钥…
              </div>
            ) : keys.length === 0 ? (
              <div className={styles.emptyPad}>
                {!keysError && (
                  <EmptyState
                    icon={<KeyRegular />}
                    title="还没有 SSH 密钥"
                    description="生成一对新的 ED25519 / RSA / ECDSA 密钥，或导入已有的 OpenSSH 私钥。私钥保存在本机加密保险库中。"
                    actions={
                      <>
                        <Button appearance="primary" icon={<AddRegular />} onClick={() => setGenerateOpen(true)} data-testid="key-empty-generate">
                          生成密钥
                        </Button>
                        <Button appearance="secondary" icon={<ArrowImportRegular />} onClick={() => setImportOpen(true)}>
                          导入密钥
                        </Button>
                      </>
                    }
                  />
                )}
              </div>
            ) : filteredKeys.length === 0 ? (
              <div className={styles.emptyPad}>
                <EmptyState
                  compact
                  icon={<SearchRegular />}
                  title="没有匹配的密钥"
                  description={`没有名称、指纹或算法匹配「${keysQuery}」的密钥。`}
                  actions={
                    <Button appearance="secondary" size="small" onClick={() => setKeysQuery('')}>
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
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKeyName)}>名称</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKeyAlgo)}>算法</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKeyFingerprint)}>指纹</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKeyCreated, styles.hideLg)}>创建时间</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKeyActions)} style={{ textAlign: 'right' }}>
                        操作
                      </TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredKeys.map((key) => (
                      <TableRow key={key.id} className={styles.row} data-testid="key-row">
                        <TableCell className={styles.td}>
                          <div className={styles.nameCell}>
                            <div className={styles.nameRow}>
                              <span className={styles.name}>{key.name}</span>
                              <span
                                className={mergeClasses(
                                  styles.badge,
                                  key.isGenerated ? styles.badgeGenerated : styles.badgeImported
                                )}
                              >
                                {key.isGenerated ? '本机生成' : '已导入'}
                              </span>
                              {key.hasPassphrase ? (
                                <Tooltip content="私钥受口令保护" relationship="label">
                                  <span className={mergeClasses(styles.badge, styles.badgePlain)}>
                                    <LockClosedRegular /> 口令
                                  </span>
                                </Tooltip>
                              ) : null}
                            </div>
                            <span className={styles.sub}>{key.comment || '无注释'}</span>
                          </div>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <div className={styles.algCell}>
                            <StatusPill tone="brand">{KEY_ALGORITHM_LABELS[key.algorithm]}</StatusPill>
                            <span className={styles.algMeta}>{key.bits} 位</span>
                          </div>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <span className={styles.fingerprint} title={key.fingerprint}>
                            {fingerprintPreview(key.fingerprint, 30)}
                          </span>
                        </TableCell>
                        <TableCell className={mergeClasses(styles.td, styles.hideLg)}>
                          <span className={styles.date}>{formatDateTime(key.createdAt)}</span>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <div className={styles.actions}>
                            <span data-testid="key-copy-public">
                              <CopyButton
                                value={key.publicKey}
                                successMessage={`${key.name} 的公钥已复制`}
                                tooltip="复制公钥"
                                quiet
                                size="small"
                              />
                            </span>
                            <Tooltip content="密钥详情" relationship="label">
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={<InfoRegular />}
                                onClick={() => setDetailsKey(key)}
                                aria-label="密钥详情"
                                data-testid="key-details"
                              />
                            </Tooltip>
                            <Tooltip content="重命名" relationship="label">
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={<EditRegular />}
                                onClick={() => {
                                  setDetailsKey(null);
                                  setRenameTarget(key);
                                }}
                                aria-label="重命名密钥"
                                data-testid="key-rename"
                              />
                            </Tooltip>
                            <Tooltip content="删除密钥" relationship="label">
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={<DeleteRegular />}
                                onClick={() => setDeleteKeyTarget(key)}
                                aria-label="删除密钥"
                                className={styles.danger}
                                data-testid="key-delete"
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
        ) : (
          <SectionCard
            title="Known Hosts"
            subtitle={`${knownHosts.length} 条受信任的主机密钥 · 连接时用于校验服务器身份`}
            flush
          >
            <div className={styles.toolbar}>
              <Input
                value={knownHostsQuery}
                onChange={(_, data) => setKnownHostsQuery(data.value)}
                placeholder="搜索主机、指纹或来源…"
                contentBefore={<SearchRegular />}
                size="small"
                className={styles.search}
                data-testid="knownhost-search"
              />
              <span className={styles.spacer} />
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowImportRegular />}
                onClick={() => setKnownHostsImportOpen(true)}
                data-testid="knownhost-import"
              >
                导入
              </Button>
              <Button
                appearance="secondary"
                size="small"
                icon={<ArrowExportRegular />}
                onClick={() => setKnownHostsExportOpen(true)}
                data-testid="knownhost-export"
              >
                导出
              </Button>
              <Button
                appearance="primary"
                size="small"
                icon={<ShieldCheckmarkRegular />}
                onClick={() => setTrustOpen(true)}
                data-testid="knownhost-trust"
              >
                信任主机
              </Button>
            </div>

            {knownHostsError && (
              <MessageBar intent="warning" className={styles.banner}>
                <MessageBarBody>
                  <MessageBarTitle>Known Hosts 加载失败</MessageBarTitle>
                  {knownHostsError}
                </MessageBarBody>
                <MessageBarActions>
                  <Button size="small" onClick={() => void refreshKnownHosts()}>
                    重试
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}

            {knownHostsLoading && knownHosts.length === 0 ? (
              <div className={styles.loading}>
                <Spinner size="small" /> 正在加载 Known Hosts…
              </div>
            ) : knownHosts.length === 0 ? (
              <div className={styles.emptyPad}>
                {!knownHostsError && (
                  <EmptyState
                    icon={<ShieldKeyholeRegular />}
                    title="还没有 Known Hosts 记录"
                    description="首次连接主机会验证服务器指纹，信任后自动写入；你也可以手动添加，或导入已有的 known_hosts 文件。"
                    actions={
                      <>
                        <Button
                          appearance="primary"
                          icon={<ShieldCheckmarkRegular />}
                          onClick={() => setTrustOpen(true)}
                          data-testid="knownhost-empty-trust"
                        >
                          信任主机
                        </Button>
                        <Button appearance="secondary" icon={<ArrowImportRegular />} onClick={() => setKnownHostsImportOpen(true)}>
                          导入 known_hosts
                        </Button>
                      </>
                    }
                  />
                )}
              </div>
            ) : filteredKnownHosts.length === 0 ? (
              <div className={styles.emptyPad}>
                <EmptyState
                  compact
                  icon={<SearchRegular />}
                  title="没有匹配的 Known Host"
                  description={`没有主机、指纹或来源匹配「${knownHostsQuery}」的记录。`}
                  actions={
                    <Button appearance="secondary" size="small" onClick={() => setKnownHostsQuery('')}>
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
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKhHost)}>主机</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKhType)}>密钥类型</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKhFingerprint)}>SHA256 指纹</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKhAdded, styles.hideLg)}>添加时间</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKhSeen, styles.hideMd)}>最近使用</TableHeaderCell>
                      <TableHeaderCell className={mergeClasses(styles.th, styles.colKhActions)} style={{ textAlign: 'right' }}>
                        操作
                      </TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredKnownHosts.map((entry) => (
                      <TableRow key={entry.id} className={styles.row} data-testid="knownhost-row">
                        <TableCell className={styles.td}>
                          <div className={styles.nameCell}>
                            <div className={styles.nameRow}>
                              <span className={styles.hostName}>
                                {entry.hostname}:{entry.port}
                              </span>
                              <StatusPill tone={knownHostSourceTone(entry.source)}>{sourceLabel(entry.source)}</StatusPill>
                            </div>
                            <span className={styles.sub}>
                              最近使用：{formatRelativeTime(entry.lastSeenAt)} · 来源：{sourceLabel(entry.source)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <span className={styles.keyType}>{entry.keyType}</span>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <span className={styles.fingerprint} title={entry.fingerprint}>
                            {fingerprintPreview(entry.fingerprint, 34)}
                          </span>
                        </TableCell>
                        <TableCell className={mergeClasses(styles.td, styles.hideLg)}>
                          <span className={styles.date}>{formatDateTime(entry.addedAt)}</span>
                        </TableCell>
                        <TableCell className={mergeClasses(styles.td, styles.hideMd)}>
                          <span className={styles.date}>{formatDateTime(entry.lastSeenAt)}</span>
                        </TableCell>
                        <TableCell className={styles.td}>
                          <div className={styles.actions}>
                            <span data-testid="knownhost-copy">
                              <CopyButton
                                value={entry.fingerprint}
                                successMessage="指纹已复制"
                                tooltip="复制指纹"
                                quiet
                                size="small"
                              />
                            </span>
                            <Tooltip content="删除记录" relationship="label">
                              <Button
                                appearance="subtle"
                                size="small"
                                icon={<DeleteRegular />}
                                onClick={() => setDeleteKnownHostTarget(entry)}
                                aria-label="删除 Known Host"
                                className={styles.danger}
                                data-testid="knownhost-delete"
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
        )}
      </div>

      <KeyGenerateDialog open={generateOpen} onDismiss={() => setGenerateOpen(false)} onSaved={(key) => handleKeySaved(key, 'generated')} />
      <KeyImportDialog open={importOpen} onDismiss={() => setImportOpen(false)} onSaved={(key) => handleKeySaved(key, 'imported')} />
      <KeyRenameDialog
        open={Boolean(renameTarget)}
        keyMeta={renameTarget}
        onDismiss={() => setRenameTarget(null)}
        onSaved={(key) => handleKeySaved(key, 'renamed')}
      />
      <KeyDetailsDrawer
        keyMeta={detailsKey}
        onClose={() => setDetailsKey(null)}
      />
      <TrustKnownHostDialog
        open={trustOpen}
        onDismiss={() => setTrustOpen(false)}
        onSaved={(knownHost) => {
          setKnownHosts((current) => upsertById(current, knownHost));
          notify('success', '已信任主机密钥', `${knownHost.hostname}:${knownHost.port}`);
          void refreshKnownHosts();
        }}
      />
      <ImportKnownHostsDialog
        open={knownHostsImportOpen}
        onDismiss={() => setKnownHostsImportOpen(false)}
        onImported={(result) => {
          notify(
            result.imported > 0 ? 'success' : 'info',
            'Known Hosts 导入完成',
            `新增 ${result.imported} 条，跳过 ${result.skipped} 条。`
          );
          void refreshKnownHosts();
        }}
      />
      <ExportKnownHostsDialog open={knownHostsExportOpen} onDismiss={() => setKnownHostsExportOpen(false)} />

      <ConfirmDialog
        open={Boolean(deleteKeyTarget)}
        title="删除 SSH 密钥"
        message={
          deleteKeyTarget
            ? `确定要删除密钥「${deleteKeyTarget.name}」吗？\n使用该密钥的主机将无法再用它登录，此操作不可撤销。`
            : ''
        }
        confirmLabel="删除密钥"
        danger
        onConfirm={deleteKey}
        onCancel={() => setDeleteKeyTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(deleteKnownHostTarget)}
        title="删除 Known Host"
        message={
          deleteKnownHostTarget
            ? `删除后，下次连接 ${deleteKnownHostTarget.hostname}:${deleteKnownHostTarget.port} 将重新验证主机密钥。\n确定继续吗？`
            : ''
        }
        confirmLabel="删除记录"
        danger
        onConfirm={deleteKnownHost}
        onCancel={() => setDeleteKnownHostTarget(null)}
      />
    </div>
  );
}
