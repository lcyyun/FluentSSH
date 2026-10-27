import {
  Badge,
  Button,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowRoutingRegular,
  CloudArrowUpRegular,
  CodeRegular,
  CopyRegular,
  DeleteRegular,
  EditRegular,
  FolderOpenRegular,
  MoreHorizontalRegular,
  StarFilled,
  StarRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import type { HostProfile } from '@shared/types';
import { formatRelativeTime, initials } from '../../lib/format';

const useStyles = makeStyles({
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    cursor: 'pointer',
    transitionProperty: 'box-shadow, transform, border-color',
    transitionDuration: '0.16s',
    ':hover': {
      boxShadow: tokens.shadow8,
      border: `1px solid ${tokens.colorNeutralStroke1}`,
      transform: 'translateY(-1px)'
    }
  },
  activeCard: { border: `1px solid ${tokens.colorBrandStroke2}` },
  topRow: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
  avatar: {
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    display: 'grid',
    placeItems: 'center',
    color: '#fff',
    fontWeight: 650,
    fontSize: '15px',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25)',
    flexShrink: 0
  },
  titleWrap: { flex: 1, minWidth: 0, lineHeight: 1.3 },
  name: {
    fontSize: '13.5px',
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden'
  },
  address: {
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    marginTop: '3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  topActions: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 },
  tags: { display: 'flex', gap: '4px', flexWrap: 'wrap', minHeight: '20px' },
  tag: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '4px',
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground4
  },
  actions: {
    display: 'flex',
    gap: '6px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    paddingTop: '9px',
    marginTop: '1px'
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: '12px',
    padding: '9px 12px',
    boxShadow: 'none',
    ':hover': { transform: 'none', boxShadow: tokens.shadow2 }
  },
  listAvatar: { width: '30px', height: '30px', borderRadius: '8px', fontSize: '12px' },
  listMeta: { display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 },
  listTag: { display: 'none' },
  star: { minWidth: '24px', minHeight: '24px', padding: 0 },
  sessionDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: tokens.colorPaletteGreenBackground3,
    boxShadow: `0 0 0 3px ${tokens.colorPaletteGreenBackground1}`,
    marginLeft: '2px'
  }
});

interface HostCardProps {
  host: HostProfile;
  groupName?: string;
  view: 'grid' | 'list';
  activeSessions?: number;
  onConnect: () => void;
  onFiles: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onRunCommand: () => void;
  onExport: () => void;
}

export function HostCard({
  host,
  groupName,
  view,
  activeSessions = 0,
  onConnect,
  onFiles,
  onEdit,
  onDuplicate,
  onDelete,
  onFavorite,
  onRunCommand,
  onExport
}: HostCardProps) {
  const styles = useStyles();
  const list = view === 'list';
  return (
    <div
      className={mergeClasses(styles.card, list && styles.listRow, activeSessions > 0 && styles.activeCard)}
      onDoubleClick={onConnect}
      data-testid="host-card"
      data-host-name={host.name}
    >
      <div className={styles.topRow} style={list ? { flex: 1, alignItems: 'center' } : undefined}>
        <div
          className={mergeClasses(styles.avatar, list && styles.listAvatar)}
          style={{ background: `linear-gradient(145deg, ${host.color}, color-mix(in srgb, ${host.color} 72%, #000))` }}
        >
          {initials(host.name)}
        </div>
        <div className={styles.titleWrap}>
          <div className={styles.name}>
            <span className="truncate">{host.name}</span>
            {activeSessions > 0 && (
              <Tooltip content={`${activeSessions} 个活跃会话`} relationship="label">
                <span className={styles.sessionDot} />
              </Tooltip>
            )}
            {host.favorite && <StarFilled style={{ color: '#e8b339', fontSize: 12 }} />}
          </div>
          <div className={styles.address}>
            {host.username}@{host.hostname}:{host.port}
          </div>
          {!list && (
            <div className={styles.tags} style={{ marginTop: 7 }}>
              {groupName && <span className={styles.tag}>{groupName}</span>}
              {host.tags.slice(0, 3).map((tag) => (
                <span className={styles.tag} key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {!list && (
          <div className={styles.topActions}>
            <Tooltip content={host.favorite ? '取消收藏' : '收藏'} relationship="label">
              <Button
                className={styles.star}
                appearance="subtle"
                size="small"
                icon={host.favorite ? <StarFilled style={{ color: '#e8b339' }} /> : <StarRegular />}
                onClick={(event) => {
                  event.stopPropagation();
                  onFavorite();
                }}
                aria-label="收藏"
              />
            </Tooltip>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<MoreHorizontalRegular />}
                  onClick={(event) => event.stopPropagation()}
                  aria-label="更多操作"
                />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<EditRegular />} onClick={onEdit}>
                    编辑主机
                  </MenuItem>
                  <MenuItem icon={<CopyRegular />} onClick={onDuplicate}>
                    复制主机
                  </MenuItem>
                  <MenuItem icon={<ArrowDownloadRegular />} onClick={onExport}>
                    导出 SSH Config
                  </MenuItem>
                  <MenuItem icon={<DeleteRegular />} onClick={onDelete}>
                    删除主机
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        )}
        {list && (
          <div className={styles.listMeta}>
            {groupName && <span className={styles.tag}>{groupName}</span>}
            <span className="tertiary">{formatRelativeTime(host.lastConnectedAt)}</span>
            <div className={styles.actions} style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
              <Tooltip content="打开终端" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<WindowConsoleRegular />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onConnect();
                  }}
                  aria-label="打开终端"
                />
              </Tooltip>
              <Tooltip content="SFTP 文件" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<FolderOpenRegular />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFiles();
                  }}
                  aria-label="打开文件管理"
                />
              </Tooltip>
              <Tooltip content="编辑" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<EditRegular />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit();
                  }}
                  aria-label="编辑主机"
                />
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      {!list && (
        <>
          <div className={styles.metaRow}>
            <span>{host.lastConnectedAt ? `上次连接 ${formatRelativeTime(host.lastConnectedAt)}` : '从未连接'}</span>
            <Badge appearance="tint" size="small" color={host.authType === 'password' ? 'informative' : 'success'}>
              {authLabel(host.authType)}
            </Badge>
          </div>
          <div className={styles.actions}>
            <Button size="small" appearance="primary" icon={<WindowConsoleRegular />} onClick={onConnect} data-testid="host-connect">
              连接
            </Button>
            <Button size="small" appearance="secondary" icon={<FolderOpenRegular />} onClick={onFiles}>
              文件
            </Button>
            <Button size="small" appearance="subtle" icon={<CodeRegular />} onClick={onRunCommand}>
              命令
            </Button>
            <div style={{ flex: 1 }} />
            <Tooltip content="编辑" relationship="label">
              <Button appearance="subtle" size="small" icon={<EditRegular />} onClick={onEdit} aria-label="编辑主机" />
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}

function authLabel(authType: HostProfile['authType']) {
  switch (authType) {
    case 'password':
      return '密码';
    case 'key':
      return '密钥';
    case 'agent':
      return 'Agent';
    case 'keyboard-interactive':
      return '交互式';
  }
}

export const HostCardIcons = { ArrowRoutingRegular, CloudArrowUpRegular };
