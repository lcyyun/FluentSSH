import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  ProgressBar,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowSyncRegular,
  ArrowUploadRegular,
  ChevronDownRegular,
  DismissRegular,
  ArrowClockwiseRegular
} from '@fluentui/react-icons';
import { useMemo } from 'react';
import { formatBytes } from '../../lib/format';
import {
  countActiveTransfers,
  transferStatusLabel,
  useTransferStore,
  type TransferTask
} from './transfers';

const useStyles = makeStyles({
  drawer: {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '248px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    minHeight: '34px'
  },
  headerIcon: { color: tokens.colorBrandForeground1, display: 'flex' },
  title: { fontSize: '12px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  summary: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap'
  },
  headerSpacer: { flex: 1 },
  list: { overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    padding: '5px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    minHeight: '46px'
  },
  directionIcon: {
    width: '22px',
    height: '22px',
    borderRadius: '6px',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2
  },
  directionUpload: { color: tokens.colorBrandForeground1, backgroundColor: tokens.colorBrandBackground2 },
  directionDownload: { color: tokens.colorPaletteGreenForeground1, backgroundColor: tokens.colorPaletteGreenBackground2 },
  info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' },
  infoTop: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
  name: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0
  },
  statusText: { fontSize: '10.5px', color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', flexShrink: 0 },
  statusRunning: { color: tokens.colorBrandForeground1 },
  statusCompleted: { color: tokens.colorPaletteGreenForeground1 },
  statusError: { color: tokens.colorPaletteRedForeground1 },
  infoBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap'
  },
  remotePath: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '10px',
    color: tokens.colorNeutralForeground4
  },
  progressWrap: { flex: '0 0 150px', minWidth: '90px' },
  actions: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 },
  actionButton: { minWidth: '26px', width: '26px', height: '26px' },
  collisionSurface: { maxWidth: '500px', width: '500px' },
  collisionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '220px',
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    padding: '8px',
    backgroundColor: tokens.colorNeutralBackground2
  },
  collisionRow: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', minWidth: 0 },
  collisionName: {
    fontFamily: tokens.fontFamilyMonospace,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  collisionDir: {
    marginLeft: 'auto',
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '200px',
    flexShrink: 0
  },
  collisionHint: { fontSize: '12px', color: tokens.colorNeutralForeground2, lineHeight: 1.55 },
  collisionActions: { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }
});

const STATUS_RANK: Record<string, number> = {
  running: 0,
  queued: 1,
  error: 2,
  completed: 3,
  cancelled: 4
};

function TransferRow({ task }: { task: TransferTask }) {
  const styles = useStyles();
  const running = task.status === 'running';
  const progress = task.size > 0 ? Math.min(1, task.transferred / task.size) : task.status === 'completed' ? 1 : 0;
  const cancel = useTransferStore((state) => state.cancel);
  const retry = useTransferStore((state) => state.retry);
  const remove = useTransferStore((state) => state.remove);
  const statusLabel = transferStatusLabel(task);
  return (
    <div className={styles.row} data-testid="transfer-item" data-direction={task.direction} data-status={task.status}>
      <span
        className={mergeClasses(
          styles.directionIcon,
          task.direction === 'upload' ? styles.directionUpload : styles.directionDownload
        )}
        aria-hidden
      >
        {task.direction === 'upload' ? <ArrowUploadRegular /> : <ArrowDownloadRegular />}
      </span>
      <div className={styles.info}>
        <div className={styles.infoTop}>
          <span className={styles.name} title={`${task.remotePath}\n${task.localName}`}>
            {task.localName}
          </span>
          <span
            className={mergeClasses(
              styles.statusText,
              running && styles.statusRunning,
              task.status === 'completed' && styles.statusCompleted,
              task.status === 'error' && styles.statusError
            )}
            data-testid="transfer-status"
          >
            {statusLabel}
            {running && task.speedBps > 0 ? ` · ${formatBytes(task.speedBps)}/s` : ''}
          </span>
        </div>
        <div className={styles.infoBottom}>
          <span data-testid="transfer-progress">
            {formatBytes(task.transferred)}
            {task.size > 0 ? ` / ${formatBytes(task.size)}` : ''}
            {task.size > 0 ? ` · ${Math.round(progress * 100)}%` : ''}
          </span>
          <span className={styles.remotePath} title={task.remotePath}>
            {task.hostLabel} · {task.remotePath}
          </span>
          {task.status === 'error' && task.error && (
            <Tooltip content={task.error} relationship="description">
              <span className={styles.statusError} style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {task.error}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <div className={styles.progressWrap}>
        <ProgressBar
          value={task.status === 'queued' ? 0 : progress}
          thickness="medium"
          aria-label={`${task.localName} 传输进度`}
        />
      </div>
      <div className={styles.actions}>
        {(task.status === 'running' || task.status === 'queued') && (
          <Tooltip content="取消传输" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              className={styles.actionButton}
              icon={<DismissRegular />}
              onClick={() => cancel(task.id)}
              aria-label={`取消 ${task.localName}`}
              data-testid="transfer-cancel"
            />
          </Tooltip>
        )}
        {(task.status === 'error' || task.status === 'cancelled') && task.direction === 'upload' && task.file && (
          <Tooltip content="重试" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              className={styles.actionButton}
              icon={<ArrowClockwiseRegular />}
              onClick={() => retry(task.id)}
              aria-label={`重试 ${task.localName}`}
              data-testid="transfer-retry"
            />
          </Tooltip>
        )}
        {(task.status === 'error' || task.status === 'cancelled') && task.direction === 'download' && (
          <Tooltip content="重试" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              className={styles.actionButton}
              icon={<ArrowClockwiseRegular />}
              onClick={() => retry(task.id)}
              aria-label={`重试 ${task.localName}`}
              data-testid="transfer-retry"
            />
          </Tooltip>
        )}
        {task.status !== 'running' && task.status !== 'queued' && (
          <Tooltip content="从列表中移除" relationship="label">
            <Button
              appearance="subtle"
              size="small"
              className={styles.actionButton}
              icon={<DismissRegular />}
              onClick={() => remove(task.id)}
              aria-label={`移除 ${task.localName}`}
              data-testid="transfer-remove"
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Docked transfer panel rendered by the file manager above the status bar. */
export function TransferDrawer() {
  const styles = useStyles();
  const items = useTransferStore((state) => state.items);
  const drawerOpen = useTransferStore((state) => state.drawerOpen);
  const setDrawerOpen = useTransferStore((state) => state.setDrawerOpen);
  const clearFinished = useTransferStore((state) => state.clearFinished);

  const ordered = useMemo(
    () =>
      [...items].sort((a, b) => {
        const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
        if (rank !== 0) return rank;
        return a.createdAt - b.createdAt;
      }),
    [items]
  );

  const active = countActiveTransfers(items);
  const finished = items.filter((item) => item.status === 'completed' || item.status === 'error' || item.status === 'cancelled').length;

  if (items.length === 0 || !drawerOpen) return null;

  const runningBytes = items.reduce(
    (total, item) => {
      if (item.status !== 'running') return total;
      return { transferred: total.transferred + item.transferred, size: total.size + (item.size || 0) };
    },
    { transferred: 0, size: 0 }
  );
  const overall = runningBytes.size > 0 ? Math.min(1, runningBytes.transferred / runningBytes.size) : 0;

  return (
    <section className={styles.drawer} data-testid="transfer-drawer" aria-label="传输队列">
      <header className={styles.header}>
        <span className={styles.headerIcon}>
          <ArrowSyncRegular />
        </span>
        <span className={styles.title}>传输队列</span>
        <span className={styles.summary} data-testid="transfer-summary">
          {active > 0 ? `${items.filter((item) => item.status === 'running').length} 进行中 · ${items.filter((item) => item.status === 'queued').length} 等待` : '没有进行中的传输'}
          {runningBytes.size > 0 ? ` · ${formatBytes(runningBytes.transferred)} / ${formatBytes(runningBytes.size)}` : ''}
        </span>
        {runningBytes.size > 0 && <ProgressBar value={overall} thickness="medium" style={{ width: '120px' }} />}
        <span className={styles.headerSpacer} />
        <Button
          appearance="subtle"
          size="small"
          disabled={finished === 0}
          onClick={clearFinished}
          data-testid="transfer-clear"
        >
          清除已完成
        </Button>
        <Tooltip content="收起传输面板" relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<ChevronDownRegular />}
            onClick={() => setDrawerOpen(false)}
            aria-label="收起传输面板"
            data-testid="transfer-close"
          />
        </Tooltip>
      </header>
      <div className={styles.list} data-testid="transfer-list">
        {ordered.map((task) => (
          <TransferRow key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

/** Modal shown when uploads would overwrite existing remote files. */
export function TransferCollisionDialog() {
  const styles = useStyles();
  const items = useTransferStore((state) => state.items);
  const collisionIds = useTransferStore((state) => state.collisionIds);
  const resolveCollisions = useTransferStore((state) => state.resolveCollisions);
  const conflicts = useMemo(
    () => items.filter((item) => collisionIds.includes(item.id)),
    [collisionIds, items]
  );

  return (
    <Dialog
      open={collisionIds.length > 0}
      modalType="alert"
      onOpenChange={() => {
        /* must be resolved explicitly */
      }}
    >
      <DialogSurface className={styles.collisionSurface}>
        <DialogBody>
          <DialogTitle>目标文件已存在</DialogTitle>
          <DialogContent>
            <div className={styles.collisionHint} data-testid="collision-dialog">
              以下 {conflicts.length} 个文件在目标目录中已存在，请选择处理方式：
            </div>
            <div className={styles.collisionList}>
              {conflicts.map((task) => (
                <div className={styles.collisionRow} key={task.id} data-testid="collision-item">
                  <span className={styles.collisionName} title={task.remotePath}>
                    {task.localName}
                  </span>
                  <span className={styles.collisionDir} title={task.remoteDir}>
                    {task.remoteDir}
                  </span>
                </div>
              ))}
            </div>
          </DialogContent>
          <DialogActions>
            <div className={styles.collisionActions}>
              <Button appearance="subtle" onClick={() => resolveCollisions('cancel')} data-testid="collision-cancel">
                取消传输
              </Button>
              <Button appearance="secondary" onClick={() => resolveCollisions('skip')} data-testid="collision-skip">
                跳过重复文件
              </Button>
              <Button appearance="secondary" onClick={() => resolveCollisions('rename')} data-testid="collision-rename">
                自动重命名
              </Button>
              <Button appearance="primary" onClick={() => resolveCollisions('overwrite')} data-testid="collision-overwrite">
                覆盖已有文件
              </Button>
            </div>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
