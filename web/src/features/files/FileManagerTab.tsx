import {
  Button,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  ProgressBar,
  Spinner,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  ArrowUpRegular,
  CopyRegular,
  DeleteRegular,
  EditRegular,
  ErrorCircleRegular,
  EyeRegular,
  EyeOffRegular,
  FolderAddRegular,
  FolderOpenRegular,
  GridRegular,
  HomeRegular,
  InfoRegular,
  KeyRegular,
  LinkRegular,
  ListRegular,
  MoreHorizontalRegular,
  PlugConnectedRegular,
  RenameRegular,
  SearchRegular,
  ArrowUploadRegular,
  DismissRegular,
  ChevronRightRegular,
  DocumentEditRegular,
  WarningRegular
} from '@fluentui/react-icons';
import type { SftpEntry } from '@shared/types';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { copyText } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { useWorkspaceStore, type WorkspaceTab } from '../workspace/store';
import { closeTab, openTerminal, reconnectTab } from '../workspace/session-actions';
import { EditorDialog } from './EditorDialog';
import { FileIcon } from './FileIcon';
import { FileTable } from './FileTable';
import {
  ChmodDialog,
  DeleteDialog,
  DetailsDialog,
  NewFolderDialog,
  RenameDialog,
  SymlinkDialog
} from './FileDialogs';
import {
  buildCrumbs,
  isDirectory,
  itemCountLabel,
  remoteParent,
  searchSummary,
  type Crumb
} from './file-utils';
import { TransferCollisionDialog, TransferDrawer } from './TransferDrawer';
import {
  countActiveTransfers,
  onTransferFinished,
  useTransferStore,
  type UploadCandidate
} from './transfers';
import { useFileBrowser, type FileBrowser } from './useFileBrowser';

const useStyles = makeStyles({
  root: {
    flex: 1,
    minHeight: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    outline: 'none',
    position: 'relative'
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '5px 8px',
    minHeight: '44px',
    flex: '0 0 auto',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0
  },
  toolbarGroup: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 },
  divider: { width: '1px', height: '20px', backgroundColor: tokens.colorNeutralStroke2, margin: '0 5px', flexShrink: 0 },
  toolButton: { minWidth: '30px', width: '30px', height: '30px', flexShrink: 0 },
  iconButtonLabeled: { flexShrink: 0 },
  breadcrumbBar: {
    flex: 1,
    minWidth: '80px',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    height: '30px',
    padding: '0 2px 0 6px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    overflow: 'hidden'
  },
  breadcrumbBarEditing: { paddingLeft: '4px' },
  crumbs: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '0px',
    minWidth: 0,
    overflow: 'hidden',
    height: '100%'
  },
  crumbButton: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: tokens.colorNeutralForeground2,
    fontFamily: 'inherit',
    fontSize: '12px',
    height: '22px',
    padding: '0 4px',
    borderRadius: '4px',
    cursor: 'pointer',
    maxWidth: '190px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'left',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, color: tokens.colorNeutralForeground1 },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '-1px' }
  },
  crumbCurrent: { color: tokens.colorNeutralForeground1, fontWeight: 600 },
  crumbSeparator: { color: tokens.colorNeutralForeground4, display: 'flex', flexShrink: 0 },
  crumbEllipsis: {
    color: tokens.colorNeutralForeground3,
    fontSize: '12px',
    padding: '0 3px',
    flexShrink: 0,
    cursor: 'default'
  },
  pathInput: { flex: 1, minWidth: 0 },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 8px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: '38px',
    flex: '0 0 auto'
  },
  searchInput: { flex: 1, minWidth: '120px', maxWidth: '520px' },
  searchMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  searchError: { color: tokens.colorPaletteRedForeground1 },
  selectionBar: {
    position: 'absolute',
    bottom: '36px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 26,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
    width: 'max-content',
    maxWidth: 'calc(100% - 24px)'
  },
  selectionText: { fontSize: '12px', fontWeight: 600, color: tokens.colorBrandForeground1, whiteSpace: 'nowrap' },
  selectionSpacer: { flex: 1 },
  listWrap: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' },
  loadingLine: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 12, height: '2px' },
  centerState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '32px 24px',
    textAlign: 'center'
  },
  stateIcon: {
    width: '54px',
    height: '54px',
    borderRadius: '14px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '25px',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2
  },
  stateIconError: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1
  },
  stateTitle: { fontSize: '15px', fontWeight: 600 },
  stateText: { fontSize: '12.5px', color: tokens.colorNeutralForeground3, maxWidth: '520px', lineHeight: 1.6, wordBreak: 'break-word' },
  stateActions: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '2px' },
  dropOverlay: {
    position: 'absolute',
    inset: '8px',
    zIndex: 30,
    borderRadius: '10px',
    border: `2px dashed ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    pointerEvents: 'none',
    color: tokens.colorBrandForeground1
  },
  dropTitle: { fontSize: '15px', fontWeight: 600 },
  dropSub: { fontSize: '12px', color: tokens.colorNeutralForeground2, fontFamily: tokens.fontFamilyMonospace },
  statusBar: {
    flex: '0 0 26px',
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    padding: '0 10px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: '10.5px',
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    userSelect: 'none'
  },
  statusItem: { display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 },
  statusDot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: tokens.colorPaletteGreenForeground1 },
  statusPath: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground2
  },
  statusSpacer: { flex: 0.0001 },
  transferBadge: {
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '999px',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: '9.5px',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '2px'
  },
  sessionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
    minHeight: '36px',
    flex: '0 0 auto'
  },
  sessionTitleText: { fontWeight: 600, color: tokens.colorNeutralForeground1 },
  sessionTitleSpacer: { flex: 1 },
  menu: {
    position: 'fixed',
    zIndex: 2000,
    minWidth: '196px',
    maxWidth: '280px',
    padding: '4px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    height: '30px',
    padding: '0 8px',
    border: 'none',
    borderRadius: '5px',
    background: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    fontSize: '12.5px',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '-2px' }
  },
  menuItemDanger: { color: tokens.colorPaletteRedForeground1 },
  menuItemDisabled: { color: tokens.colorNeutralForegroundDisabled, cursor: 'default', ':hover': { backgroundColor: 'transparent' } },
  menuItemIcon: { fontSize: '16px', display: 'flex', width: '16px', flexShrink: 0 },
  menuDivider: { height: '1px', backgroundColor: tokens.colorNeutralStroke3, margin: '4px 2px' },
  offlineHint: { fontSize: '11px', color: tokens.colorNeutralForeground4, fontFamily: tokens.fontFamilyMonospace, maxWidth: '560px', wordBreak: 'break-all' }
});

/* ------------------------------------------------------------------ */
/* Floating context menu                                               */
/* ------------------------------------------------------------------ */

interface FloatingMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  dividerBefore?: boolean;
  testId?: string;
}

function FloatingMenu({
  open,
  x,
  y,
  items,
  onClose,
  testId = 'context-menu'
}: {
  open: boolean;
  x: number;
  y: number;
  items: FloatingMenuItem[];
  onClose: () => void;
  testId?: string;
}) {
  const styles = useStyles();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const nextX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const nextY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    setPosition({ x: nextX, y: nextY });
  }, [open, x, y, items.length]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    const handleScroll = () => onCloseRef.current();
    document.addEventListener('mousedown', handlePointer, true);
    document.addEventListener('contextmenu', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
      role="menu"
      data-testid={testId}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.dividerBefore && <div className={styles.menuDivider} />}
          <button
            type="button"
            role="menuitem"
            className={mergeClasses(
              styles.menuItem,
              item.danger && styles.menuItemDanger,
              item.disabled && styles.menuItemDisabled
            )}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick();
            }}
            data-testid={item.testId ?? `${testId}-item`}
            data-menu-key={item.key}
          >
            {item.icon && <span className={styles.menuItemIcon}>{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function splitCrumbs(crumbs: Crumb[]): Array<Crumb | null> {
  if (crumbs.length <= 5) return crumbs;
  return [crumbs[0] ?? null, null, ...crumbs.slice(-3)];
}

function webkitEntry(item: DataTransferItem): { isDirectory: boolean; isFile: boolean } | null {
  const candidate = item as DataTransferItem & {
    webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null;
  };
  try {
    return candidate.webkitGetAsEntry?.() ?? null;
  } catch {
    return null;
  }
}

function fileNameOf(entry: SftpEntry): string {
  return entry.path || entry.name;
}

/* ------------------------------------------------------------------ */
/* File manager tab                                                    */
/* ------------------------------------------------------------------ */

export function FileManagerTab({ tab }: { tab: WorkspaceTab }) {
  const styles = useStyles();
  const settings = useAppStore((state) => state.settings);
  const notify = useAppStore((state) => state.notify);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setDrawerOpen = useTransferStore((state) => state.setDrawerOpen);
  // Primitive selectors keep progress ticks from re-rendering the whole file table.
  const activeTransfers = useTransferStore((state) => countActiveTransfers(state.items));
  const totalTransfers = useTransferStore((state) => state.items.length);
  const drawerOpen = useTransferStore((state) => state.drawerOpen);

  const sessionId = tab.sessionId;
  const connected = tab.state === 'connected' && Boolean(sessionId);
  const showHidden = settings?.files.showHidden ?? false;
  const confirmDelete = settings?.files.confirmDelete ?? true;
  const compact = settings?.compactMode ?? false;

  const browser = useFileBrowser({
    tabId: tab.id,
    sessionId,
    connected,
    initialPath: tab.initialPath,
    showHidden
  });

  /* ---------------------------------------------------------------- */
  /* Session state: poll while connecting so the tab recovers even if  */
  /* the tab strip event wiring is not mounted yet.                    */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!tab.sessionId) return;
    if (tab.state === 'connected' || tab.state === 'error' || tab.state === 'closed') return;
    let stopped = false;
    const poll = async () => {
      try {
        const { session } = await api.sessions.get(tab.sessionId);
        if (stopped) return;
        if (session.state !== tab.state) {
          useWorkspaceStore.getState().patchTab(tab.id, {
            state: session.state,
            error: session.lastError,
            errorCode: session.errorCode,
            errorDetails: session.errorDetails
          });
        }
      } catch {
        // Session may already be gone; the reconnect CTA handles it.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1600);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [tab.id, tab.sessionId, tab.state]);

  /* ---------------------------------------------------------------- */
  /* Transfers: refresh the listing when an upload into this subtree   */
  /* completes.                                                        */
  /* ---------------------------------------------------------------- */
  const pathRef = useRef(browser.path);
  pathRef.current = browser.path;
  const refreshRef = useRef(browser.refresh);
  refreshRef.current = browser.refresh;
  useEffect(() => {
    if (!tab.sessionId) return;
    let timer: number | null = null;
    const off = onTransferFinished((task) => {
      if (task.direction !== 'upload' || task.sessionId !== tab.sessionId) return;
      const current = pathRef.current;
      if (!current) return;
      const prefix = current === '/' ? '/' : `${current.replace(/\/+$/, '')}/`;
      if (task.remoteDir !== current && !task.remoteDir.startsWith(prefix)) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshRef.current(), 300);
    });
    return () => {
      off();
      if (timer) window.clearTimeout(timer);
    };
  }, [tab.sessionId]);

  /* ---------------------------------------------------------------- */
  /* Local UI state                                                    */
  /* ---------------------------------------------------------------- */
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameEntry, setRenameEntry] = useState<SftpEntry | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<SftpEntry[]>([]);
  const [chmodTargets, setChmodTargets] = useState<SftpEntry[]>([]);
  const [symlinkOpen, setSymlinkOpen] = useState(false);
  const [detailsEntry, setDetailsEntry] = useState<SftpEntry | null>(null);
  const [editorEntry, setEditorEntry] = useState<SftpEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entries: SftpEntry[] } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // `webkitdirectory` is not part of the TS JSX typings; set it imperatively.
  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
  }, []);

  /* ---------------------------------------------------------------- */
  /* File operations                                                   */
  /* ---------------------------------------------------------------- */
  const performDelete = useCallback(
    async (entries: SftpEntry[]): Promise<boolean> => {
      if (!sessionId || entries.length === 0) return false;
      const recursive = entries.some((entry) => entry.type === 'directory');
      try {
        await api.sftp.remove(
          sessionId,
          entries.map((entry) => entry.path),
          recursive
        );
        notify('success', '已删除', `已删除 ${entries.length} 个项目。`);
        browser.clearSelection();
        await browser.refresh();
        return true;
      } catch (caught) {
        notify('error', '删除失败', errorMessage(caught));
        return false;
      }
    },
    [browser, notify, sessionId]
  );

  const requestDelete = useCallback(
    (entries: SftpEntry[]) => {
      if (!entries.length) return;
      if (confirmDelete) {
        setDeleteTargets(entries);
      } else {
        void performDelete(entries);
      }
    },
    [confirmDelete, performDelete]
  );

  const handleDeleteConfirm = useCallback(async () => {
    const targets = deleteTargets;
    if (!targets.length) return;
    await performDelete(targets);
    setDeleteTargets([]);
  }, [deleteTargets, performDelete]);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (!sessionId || !browser.path) throw new Error('会话或目录不可用。');
      const target = `${browser.path === '/' ? '' : browser.path.replace(/\/+$/, '')}/${name}`;
      await api.sftp.mkdir(sessionId, target || '/');
      notify('success', '文件夹已创建', target);
      await browser.refresh();
    },
    [browser, notify, sessionId]
  );

  const handleRename = useCallback(
    async (nextName: string) => {
      if (!sessionId || !renameEntry) throw new Error('请选择要重命名的项目。');
      const dir = remoteParent(renameEntry.path) || browser.path || '/';
      const target = `${dir === '/' ? '' : dir.replace(/\/+$/, '')}/${nextName}`;
      await api.sftp.rename(sessionId, renameEntry.path, target || '/');
      notify('success', '重命名成功', `${renameEntry.name} → ${nextName}`);
      await browser.refresh();
      browser.setSelectedPaths([target]);
    },
    [browser, notify, renameEntry, sessionId]
  );

  const handleChmod = useCallback(
    async (mode: number) => {
      if (!sessionId || chmodTargets.length === 0) throw new Error('请选择项目。');
      for (const target of chmodTargets) {
        await api.sftp.chmod(sessionId, target.path, mode);
      }
      notify(
        'success',
        '权限已更新',
        `${chmodTargets.length} 个项目 · ${mode.toString(8).padStart(3, '0')}`
      );
      await browser.refresh();
    },
    [browser, chmodTargets, notify, sessionId]
  );

  const handleCreateSymlink = useCallback(
    async (target: string, name: string) => {
      if (!sessionId || !browser.path) throw new Error('会话或目录不可用。');
      const linkPath = `${browser.path === '/' ? '' : browser.path.replace(/\/+$/, '')}/${name}`;
      await api.sftp.symlink(sessionId, target, linkPath);
      notify('success', '符号链接已创建', linkPath);
      await browser.refresh();
    },
    [browser, notify, sessionId]
  );

  const downloadEntry = useCallback(
    (entry: SftpEntry) => {
      if (!sessionId || isDirectory(entry)) return;
      useTransferStore.getState().enqueueDownload({
        sessionId,
        hostLabel: `${tab.username}@${tab.hostname}`,
        dir: remoteParent(entry.path) || browser.path || '/',
        path: entry.path,
        fileName: entry.name,
        size: entry.size
      });
    },
    [browser.path, sessionId, tab.hostname, tab.username]
  );

  const downloadEntries = useCallback(
    (entries: SftpEntry[]) => {
      const files = entries.filter((entry) => !isDirectory(entry));
      if (files.length === 0) {
        notify('warning', '无法下载文件夹', '请选择文件后再下载。');
        return;
      }
      for (const entry of files) downloadEntry(entry);
    },
    [downloadEntry, notify]
  );

  const copyEntryPath = useCallback(
    async (entry: SftpEntry) => {
      const ok = await copyText(entry.path);
      if (ok) notify('success', '路径已复制', entry.path);
      else notify('error', '复制失败', entry.path);
    },
    [notify]
  );

  const openEntry = useCallback(
    async (entry: SftpEntry) => {
      const fullPath = entry.path || `${browser.path === '/' ? '' : browser.path ?? ''}/${entry.name}`;
      if (entry.type === 'directory') {
        browser.navigate(fullPath);
        return;
      }
      if (entry.type === 'symlink') {
        try {
          const { entry: statEntry } = await api.sftp.stat(sessionId, fullPath);
          if (statEntry.type === 'directory') {
            browser.navigate(fullPath);
            return;
          }
        } catch {
          // Broken link: fall through to the editor/download guard.
        }
      }
      setEditorEntry(entry);
    },
    [browser, sessionId]
  );

  /* ---------------------------------------------------------------- */
  /* Uploads                                                           */
  /* ---------------------------------------------------------------- */
  const enqueueUploads = useCallback(
    (candidates: UploadCandidate[]) => {
      if (!sessionId || !browser.path || candidates.length === 0) return;
      void useTransferStore
        .getState()
        .enqueueUploads({
          sessionId,
          hostLabel: `${tab.username}@${tab.hostname}`,
          dir: browser.path,
          files: candidates,
          existingNames: browser.entries.map((entry) => entry.name)
        })
        .catch((caught) => notify('error', '无法开始上传', errorMessage(caught)));
    },
    [browser.entries, browser.path, notify, sessionId, tab.hostname, tab.username]
  );

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length === 0) return;
      enqueueUploads(files.map((file) => ({ file })));
    },
    [enqueueUploads]
  );

  const handleFolderInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length === 0) return;
      enqueueUploads(
        files.map((file) => ({
          file,
          relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined
        }))
      );
    },
    [enqueueUploads]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      let directories = 0;
      const candidates: UploadCandidate[] = [];
      const items = Array.from(event.dataTransfer.items ?? []);
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const entry = webkitEntry(item);
        if (entry?.isDirectory) {
          directories += 1;
          continue;
        }
        const file = item.getAsFile();
        if (file) candidates.push({ file });
      }
      if (candidates.length === 0 && items.length === 0) {
        for (const file of Array.from(event.dataTransfer.files ?? [])) candidates.push({ file });
      }
      if (directories > 0) {
        notify('warning', '暂不支持拖拽文件夹', '请使用工具栏“更多 → 上传文件夹”，或先打包为压缩文件。');
      }
      if (candidates.length > 0) enqueueUploads(candidates);
    },
    [enqueueUploads, notify]
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Context menu                                                      */
  /* ---------------------------------------------------------------- */
  const openContextMenu = useCallback(
    (event: { clientX: number; clientY: number }, entry: SftpEntry) => {
      const entries =
        browser.selection.has(fileNameOf(entry)) && browser.selectedEntries.length > 0
          ? browser.selectedEntries
          : [entry];
      setContextMenu({ x: event.clientX, y: event.clientY, entries });
    },
    [browser.selection, browser.selectedEntries]
  );

  const openRowMenu = useCallback(
    (event: ReactMouseEvent, entry: SftpEntry) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      openContextMenu({ clientX: rect.right - 6, clientY: rect.bottom + 2 }, entry);
    },
    [openContextMenu]
  );

  const contextMenuItems = useMemo<FloatingMenuItem[]>(() => {
    if (!contextMenu) return [];
    const entries = contextMenu.entries;
    const single = entries.length === 1 ? entries[0] : null;
    const fileCount = entries.filter((entry) => !isDirectory(entry)).length;
    return [
      {
        key: 'open',
        label: single && isDirectory(single) ? '打开文件夹' : '打开 / 编辑',
        icon: single && isDirectory(single) ? <FolderOpenRegular /> : <DocumentEditRegular />,
        disabled: !single,
        onClick: () => single && void openEntry(single),
        testId: 'context-open'
      },
      {
        key: 'download',
        label: `下载${fileCount > 1 ? ` ${fileCount} 个文件` : ''}`,
        icon: <ArrowDownloadRegular />,
        disabled: fileCount === 0,
        onClick: () => downloadEntries(entries),
        testId: 'context-download'
      },
      {
        key: 'rename',
        label: '重命名',
        icon: <RenameRegular />,
        disabled: !single,
        onClick: () => single && setRenameEntry(single),
        dividerBefore: true,
        testId: 'context-rename'
      },
      {
        key: 'chmod',
        label: '修改权限',
        icon: <KeyRegular />,
        onClick: () => setChmodTargets(entries),
        testId: 'context-chmod'
      },
      {
        key: 'copy-path',
        label: '复制完整路径',
        icon: <CopyRegular />,
        disabled: !single,
        onClick: () => single && void copyEntryPath(single),
        testId: 'context-copy-path'
      },
      {
        key: 'symlink',
        label: '新建符号链接',
        icon: <LinkRegular />,
        disabled: browser.selectedEntries.length === 0 && entries.length !== 1,
        onClick: () => setSymlinkOpen(true),
        testId: 'context-symlink'
      },
      {
        key: 'details',
        label: '属性',
        icon: <InfoRegular />,
        disabled: !single,
        onClick: () => single && setDetailsEntry(single),
        testId: 'context-details'
      },
      {
        key: 'delete',
        label: `删除${entries.length > 1 ? ` ${entries.length} 个项目` : ''}`,
        icon: <DeleteRegular />,
        danger: true,
        dividerBefore: true,
        onClick: () => requestDelete(entries),
        testId: 'context-delete'
      }
    ];
  }, [browser.selectedEntries.length, contextMenu, copyEntryPath, downloadEntries, openEntry, requestDelete]);

  /* ---------------------------------------------------------------- */
  /* Breadcrumb / path editing                                         */
  /* ---------------------------------------------------------------- */
  const crumbs = useMemo(() => splitCrumbs(buildCrumbs(browser.path ?? '/')), [browser.path]);
  const fullCrumbs = useMemo(() => buildCrumbs(browser.path ?? '/'), [browser.path]);

  const beginPathEdit = useCallback(() => {
    setPathDraft(browser.path ?? '/');
    setEditingPath(true);
    window.setTimeout(() => {
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
    }, 30);
  }, [browser.path]);

  const commitPathEdit = useCallback(() => {
    const next = pathDraft.trim();
    setEditingPath(false);
    if (!next) return;
    browser.navigate(next);
  }, [browser, pathDraft]);

  // Ctrl+L / F5 while this tab has focus.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!rootRef.current?.contains(document.activeElement)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        beginPathEdit();
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        browser.goParent();
      } else if (event.key === 'F5') {
        event.preventDefault();
        void browser.refresh();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [beginPathEdit, browser]);

  const handleRootKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        browser.selectAll();
        return;
      }
      if (event.key === 'Delete' && browser.selectedEntries.length > 0) {
        event.preventDefault();
        requestDelete(browser.selectedEntries);
        return;
      }
      if (event.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
        } else if (browser.searchOpen) {
          browser.closeSearch();
        } else if (browser.selection.size > 0) {
          browser.clearSelection();
        }
      }
    },
    [browser, contextMenu, requestDelete]
  );

  /* ---------------------------------------------------------------- */
  /* Toolbar actions                                                   */
  /* ---------------------------------------------------------------- */
  const toggleHidden = useCallback(() => {
    const current = useAppStore.getState().settings?.files.showHidden ?? false;
    void updateSettings({ files: { showHidden: !current } });
  }, [updateSettings]);

  const openTransfers = useCallback(() => {
    setDrawerOpen(!drawerOpen);
  }, [drawerOpen, setDrawerOpen]);

  const handleReconnect = useCallback(() => {
    void reconnectTab(tab.id);
  }, [tab.id]);

  const handleCloseTab = useCallback(() => {
    void closeTab(tab.id);
  }, [tab.id]);

  const handleOpenTerminal = useCallback(() => {
    if (!tab.hostId) return;
    void openTerminal({ hostId: tab.hostId, host: useAppStore.getState().hosts.find((host) => host.id === tab.hostId) });
  }, [tab.hostId]);

  /* ---------------------------------------------------------------- */
  /* Session gate                                                      */
  /* ---------------------------------------------------------------- */
  const renderSessionGate = () => {
    const awaiting = tab.state === 'awaiting-auth';
    const connecting = tab.state === 'connecting' || (!sessionId && tab.state !== 'error');
    if (connecting || awaiting) {
      return (
        <div className={styles.centerState} data-testid="file-manager-connecting">
          <Spinner />
          <span className={styles.stateTitle}>
            {awaiting ? '等待 SSH 交互式认证' : '正在建立 SFTP 会话…'}
          </span>
          <span className={styles.stateText}>
            {awaiting
              ? '请在认证对话框中完成服务器要求的验证，连接成功后文件列表会自动载入。'
              : `正在连接 ${tab.username}@${tab.hostname}:${tab.port}，首次连接可能需要几秒。`}
          </span>
          <div className={styles.stateActions}>
            <Button appearance="secondary" onClick={handleCloseTab}>
              关闭标签页
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.centerState} data-testid="file-manager-disconnected">
        <span className={mergeClasses(styles.stateIcon, styles.stateIconError)}>
          <ErrorCircleRegular />
        </span>
        <span className={styles.stateTitle}>SFTP 会话未连接</span>
        <span className={styles.stateText}>
          {tab.error && !/^[a-z._-]+$/i.test(tab.error.trim())
            ? tab.error
            : '会话已断开或连接失败。可以重新连接后继续浏览远程文件。'}
        </span>
        {(tab.errorCode || (tab.error && /^[a-z._-]+$/i.test(tab.error.trim()))) && (
          <span className={styles.offlineHint}>
            {tab.errorCode ?? tab.error}
          </span>
        )}
        <div className={styles.stateActions}>
          <Button
            appearance="primary"
            icon={<PlugConnectedRegular />}
            onClick={handleReconnect}
            disabled={!sessionId}
            data-testid="reconnect-button"
          >
            重新连接
          </Button>
          <Button appearance="secondary" onClick={() => void browser.refresh()} disabled={!sessionId}>
            重试
          </Button>
          <Button appearance="subtle" onClick={handleCloseTab} data-testid="close-tab-button">
            关闭标签页
          </Button>
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Main render                                                       */
  /* ---------------------------------------------------------------- */
  const selectionCount = browser.selection.size;
  const filesSelected = browser.selectedEntries.filter((entry) => !isDirectory(entry));
  const hasSelection = selectionCount > 0;

  const emptyState = (() => {
    if (!browser.loadedOnce && !browser.error) {
      return (
        <div className={styles.centerState} data-testid="file-manager-loading">
          <Spinner />
          <span className={styles.stateText}>正在读取 {browser.path ?? '远程目录'}…</span>
        </div>
      );
    }
    if (browser.error) {
      const sessionGone = browser.errorCode === 'SESSION_NOT_CONNECTED';
      return (
        <div className={styles.centerState} data-testid="file-manager-error">
          <span className={mergeClasses(styles.stateIcon, styles.stateIconError)}>
            <WarningRegular />
          </span>
          <span className={styles.stateTitle}>无法读取目录</span>
          <span className={styles.stateText}>{browser.error}</span>
          <div className={styles.stateActions}>
            <Button icon={<ArrowClockwiseRegular />} onClick={() => void browser.refresh()}>
              重试
            </Button>
            {sessionGone && (
              <Button appearance="primary" icon={<PlugConnectedRegular />} onClick={handleReconnect}>
                重新连接
              </Button>
            )}
          </div>
        </div>
      );
    }
    const searching = Boolean(browser.recursiveSearch) || Boolean(browser.searchQuery.trim());
    return (
      <EmptyState
        icon={searching ? <SearchRegular /> : <FolderOpenRegular />}
        title={searching ? '没有匹配的项目' : '此文件夹为空'}
        description={
          searching
            ? `没有找到与“${browser.recursiveSearch?.query ?? browser.searchQuery.trim()}”匹配的项目。`
            : '拖拽文件到这里即可上传，或使用工具栏创建文件夹。'
        }
        compact
        actions={
          searching ? (
            <Button
              appearance="secondary"
              onClick={() => {
                browser.closeSearch();
                if (browser.recursiveSearch) browser.clearRecursiveSearch();
              }}
            >
              清除搜索
            </Button>
          ) : (
            <>
              <Button appearance="primary" icon={<ArrowUploadRegular />} onClick={() => fileInputRef.current?.click()}>
                上传文件
              </Button>
              <Button appearance="secondary" icon={<FolderAddRegular />} onClick={() => setNewFolderOpen(true)}>
                新建文件夹
              </Button>
            </>
          )
        }
      />
    );
  })();

  const showTable = connected && !browser.error && browser.loadedOnce && browser.visibleCount > 0;

  return (
    <div
      className={styles.root}
      ref={rootRef}
      data-testid="file-manager"
      data-session-id={sessionId || undefined}
      data-path={browser.path ?? undefined}
      onKeyDown={handleRootKeyDown}
    >
      {connected ? (
        <>
          <div className={styles.toolbar} data-testid="file-toolbar">
            <div className={styles.toolbarGroup}>
              <Tooltip content="上一级（Backspace）" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={styles.toolButton}
                  icon={<ArrowUpRegular />}
                  onClick={browser.goParent}
                  disabled={!browser.path || browser.path === '/' || browser.path === '~'}
                  aria-label="上一级"
                  data-testid="up-button"
                />
              </Tooltip>
              <Tooltip content="主目录" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={styles.toolButton}
                  icon={<HomeRegular />}
                  onClick={browser.goHome}
                  disabled={!browser.homePath}
                  aria-label="主目录"
                  data-testid="home-button"
                />
              </Tooltip>
              <Tooltip content="刷新（F5）" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={styles.toolButton}
                  icon={browser.loading ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />}
                  onClick={() => void browser.refresh()}
                  aria-label="刷新"
                  data-testid="refresh-button"
                />
              </Tooltip>
            </div>
            <div className={styles.divider} />
            <div
              className={mergeClasses(styles.breadcrumbBar, editingPath && styles.breadcrumbBarEditing)}
              data-testid="breadcrumb"
            >
              {editingPath ? (
                <Input
                  ref={pathInputRef}
                  className={styles.pathInput}
                  value={pathDraft}
                  onChange={(_, data) => setPathDraft(data.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitPathEdit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingPath(false);
                    }
                  }}
                  placeholder="/var/log"
                  spellCheck={false}
                  data-testid="path-input"
                />
              ) : (
                <nav className={styles.crumbs} aria-label="远程路径" onDoubleClick={beginPathEdit}>
                  {crumbs.map((crumb, index) => (
                    <Fragment key={`${crumb ? crumb.path : 'ellipsis'}-${index}`}>
                      {index > 0 && (
                        <span className={styles.crumbSeparator} aria-hidden>
                          <ChevronRightRegular style={{ fontSize: '10px' }} />
                        </span>
                      )}
                      {crumb ? (
                        <button
                          type="button"
                          className={mergeClasses(
                            styles.crumbButton,
                            index === crumbs.length - 1 && styles.crumbCurrent
                          )}
                          title={crumb.path}
                          onClick={() => browser.navigate(crumb.path)}
                          data-testid="breadcrumb-item"
                        >
                          {crumb.label}
                        </button>
                      ) : (
                        <span
                          className={styles.crumbEllipsis}
                          title={fullCrumbs
                            .slice(1, -3)
                            .map((item) => item.label)
                            .join(' / ')}
                          data-testid="breadcrumb-ellipsis"
                        >
                          …
                        </span>
                      )}
                    </Fragment>
                  ))}
                </nav>
              )}
              {!editingPath && (
                <Tooltip content="编辑路径（Ctrl+L）" relationship="label">
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    onClick={beginPathEdit}
                    aria-label="编辑路径"
                    data-testid="path-edit"
                    style={{ minWidth: '24px', width: '24px', height: '24px' }}
                  />
                </Tooltip>
              )}
            </div>
            <div className={styles.divider} />
            <div className={styles.toolbarGroup}>
              <Button
                appearance="primary"
                size="small"
                icon={<ArrowUploadRegular />}
                onClick={() => fileInputRef.current?.click()}
                data-testid="upload-button"
              >
                上传
              </Button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    appearance="subtle"
                    size="small"
                    className={styles.toolButton}
                    icon={<MoreHorizontalRegular />}
                    aria-label="上传与更多"
                    data-testid="upload-more-button"
                  />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<ArrowUploadRegular />} onClick={() => fileInputRef.current?.click()}>
                      上传文件
                    </MenuItem>
                    <MenuItem icon={<FolderOpenRegular />} onClick={() => folderInputRef.current?.click()}>
                      上传文件夹
                    </MenuItem>
                    <MenuItem icon={<FolderAddRegular />} onClick={() => setNewFolderOpen(true)} data-testid="new-folder-menu">
                      新建文件夹
                    </MenuItem>
                    <MenuItem icon={<LinkRegular />} onClick={() => setSymlinkOpen(true)}>
                      新建符号链接
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem icon={<ArrowSyncRegular />} onClick={() => setDrawerOpen(true)}>
                      传输队列
                    </MenuItem>
                    {tab.hostId && (
                      <MenuItem icon={<PlugConnectedRegular />} onClick={handleOpenTerminal}>
                        在终端中打开
                      </MenuItem>
                    )}
                    <MenuDivider />
                    <MenuItem icon={<ArrowClockwiseRegular />} onClick={handleReconnect}>
                      重新连接 SFTP
                    </MenuItem>
                    <MenuItem icon={<DismissRegular />} onClick={handleCloseTab} data-testid="close-tab-menu">
                      关闭文件标签页
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Tooltip content="新建文件夹" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={styles.toolButton}
                  icon={<FolderAddRegular />}
                  onClick={() => setNewFolderOpen(true)}
                  aria-label="新建文件夹"
                  data-testid="new-folder-button"
                />
              </Tooltip>
            </div>
            <div className={styles.divider} />
            <div className={styles.toolbarGroup}>
              <Tooltip content={browser.searchOpen ? '关闭搜索' : '搜索（当前目录 / 递归）'} relationship="label">
                <Button
                  appearance={browser.searchOpen ? 'primary' : 'subtle'}
                  size="small"
                  className={styles.toolButton}
                  icon={<SearchRegular />}
                  onClick={() => (browser.searchOpen ? browser.closeSearch() : browser.openSearch())}
                  aria-label="搜索"
                  data-testid="search-toggle"
                />
              </Tooltip>
              <Tooltip content={showHidden ? '隐藏点文件' : '显示隐藏文件'} relationship="label">
                <Button
                  appearance={showHidden ? 'primary' : 'subtle'}
                  size="small"
                  className={styles.toolButton}
                  icon={showHidden ? <EyeRegular /> : <EyeOffRegular />}
                  onClick={toggleHidden}
                  aria-label={showHidden ? '隐藏点文件' : '显示隐藏文件'}
                  aria-pressed={showHidden}
                  data-testid="hidden-toggle"
                />
              </Tooltip>
              <Tooltip content={browser.viewMode === 'list' ? '切换到网格视图' : '切换到列表视图'} relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={styles.toolButton}
                  icon={browser.viewMode === 'list' ? <GridRegular /> : <ListRegular />}
                  onClick={() => browser.setViewMode(browser.viewMode === 'list' ? 'grid' : 'list')}
                  aria-label="切换视图"
                  data-testid="view-toggle"
                />
              </Tooltip>
              <Tooltip content="传输队列" relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  className={styles.toolButton}
                  icon={activeTransfers > 0 ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                  onClick={openTransfers}
                  aria-label="传输队列"
                  data-testid="transfer-button"
                  style={{ width: activeTransfers > 0 || totalTransfers > 0 ? 'auto' : '30px', paddingInline: '4px' }}
                >
                  {totalTransfers > 0 && <span className={styles.transferBadge}>{activeTransfers || totalTransfers}</span>}
                </Button>
              </Tooltip>
            </div>
          </div>

          {browser.searchOpen && (
            <div className={styles.searchBar} data-testid="search-bar">
              <Input
                className={styles.searchInput}
                value={browser.searchQuery}
                onChange={(_, data) => browser.setSearchQuery(data.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void browser.runRecursiveSearch();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    browser.closeSearch();
                  }
                }}
                placeholder="按名称筛选当前目录；回车在子目录中递归搜索"
                contentBefore={<SearchRegular />}
                autoFocus
                spellCheck={false}
                data-testid="search-input"
              />
              <Button
                appearance="secondary"
                size="small"
                icon={browser.searching ? <Spinner size="tiny" /> : <SearchRegular />}
                onClick={() => void browser.runRecursiveSearch()}
                disabled={!browser.searchQuery.trim() || browser.searching}
                data-testid="search-recursive"
              >
                递归搜索
              </Button>
              <span className={styles.searchMeta} data-testid="search-summary">
                {browser.searching && '正在搜索子目录…'}
                {!browser.searching && browser.searchError && (
                  <span className={styles.searchError}>搜索失败：{browser.searchError}</span>
                )}
                {!browser.searching && !browser.searchError && browser.recursiveSearch && (
                  <>
                    {searchSummary(browser.recursiveSearch.result, browser.recursiveSearch.query)}
                    <Button appearance="subtle" size="small" onClick={() => browser.clearRecursiveSearch()}>
                      返回目录
                    </Button>
                  </>
                )}
                {!browser.searching && !browser.searchError && !browser.recursiveSearch && browser.searchQuery.trim() && (
                  <>当前目录匹配 {browser.visibleCount} 项</>
                )}
              </span>
              <Button
                appearance="subtle"
                size="small"
                icon={<DismissRegular />}
                onClick={() => browser.closeSearch()}
                aria-label="关闭搜索"
                data-testid="search-close"
              />
            </div>
          )}

          {hasSelection && (
            <div
              className={styles.selectionBar}
              data-testid="selection-bar"
              style={{ bottom: drawerOpen && totalTransfers > 0 ? '288px' : '36px' }}
            >
              <span className={styles.selectionText} data-testid="selection-count">
                已选择 {selectionCount} 项
              </span>
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowDownloadRegular />}
                onClick={() => downloadEntries(browser.selectedEntries)}
                disabled={filesSelected.length === 0}
                data-testid="selection-download"
              >
                下载
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<DeleteRegular />}
                onClick={() => requestDelete(browser.selectedEntries)}
                data-testid="selection-delete"
              >
                删除
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<RenameRegular />}
                onClick={() => setRenameEntry(browser.selectedEntries[0] ?? null)}
                disabled={selectionCount !== 1}
                data-testid="selection-rename"
              >
                重命名
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<KeyRegular />}
                onClick={() => setChmodTargets(browser.selectedEntries)}
                data-testid="selection-chmod"
              >
                权限
              </Button>
              <span className={styles.selectionSpacer} />
              <Button
                appearance="subtle"
                size="small"
                icon={<DismissRegular />}
                onClick={() => browser.clearSelection()}
                data-testid="selection-clear"
              >
                取消选择
              </Button>
            </div>
          )}

          <div
            className={styles.listWrap}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-testid="file-drop-zone"
          >
            {browser.loading && browser.loadedOnce && (
              <div className={styles.loadingLine}>
                <ProgressBar thickness="medium" />
              </div>
            )}
            {showTable ? (
              <FileTable
                entries={browser.visibleEntries}
                sort={browser.sort}
                selection={browser.selection}
                compact={compact}
                viewMode={browser.viewMode}
                showPaths={Boolean(browser.recursiveSearch)}
                onToggleSort={browser.toggleSort}
                onSelect={browser.handleSelect}
                onSelectOnly={browser.selectOnly}
                onSelectAll={browser.selectAll}
                onClearSelection={browser.clearSelection}
                onOpen={(entry) => void openEntry(entry)}
                onDownload={downloadEntry}
                onContextMenu={(event, entry) => openContextMenu(event, entry)}
                onOpenMenu={openRowMenu}
              />
            ) : (
              emptyState
            )}
            {dragActive && (
              <div className={styles.dropOverlay} data-testid="drop-overlay">
                <ArrowUploadRegular style={{ fontSize: '30px' }} />
                <span className={styles.dropTitle}>松开鼠标即可上传</span>
                <span className={styles.dropSub}>{browser.path}</span>
              </div>
            )}
          </div>

          <TransferDrawer />

          <footer className={styles.statusBar} data-testid="status-bar">
            <span className={styles.statusItem}>
              <span className={styles.statusDot} /> SFTP
            </span>
            <span className={styles.statusItem} title={`${tab.username}@${tab.hostname}:${tab.port}`}>
              {tab.username}@{tab.hostname}:{tab.port}
            </span>
            <span className={styles.statusItem}>·</span>
            <span className={styles.statusPath} title={browser.path ?? ''} data-testid="status-path">
              {browser.path ?? '…'}
            </span>
            <span className={styles.statusItem} data-testid="status-count">
              {browser.recursiveSearch || browser.searchQuery.trim()
                ? `${browser.visibleCount} / ${browser.totalCount} 项`
                : itemCountLabel(browser.totalCount)}
            </span>
            {hasSelection && (
              <span className={styles.statusItem} data-testid="status-selection">
                已选 {selectionCount}
              </span>
            )}
            {browser.hiddenCount > 0 && !showHidden && (
              <span className={styles.statusItem}>隐藏 {browser.hiddenCount} 项</span>
            )}
            {activeTransfers > 0 && <span className={styles.statusItem}>传输 {activeTransfers}</span>}
            {browser.loading && <span className={styles.statusItem}>刷新中…</span>}
            <span className={styles.statusItem}>
              {browser.lastLoadedAt
                ? new Date(browser.lastLoadedAt).toLocaleTimeString('zh-CN', { hour12: false })
                : '—'}
            </span>
          </footer>
        </>
      ) : (
        <>
          <div className={styles.sessionTitle} data-testid="file-session-title">
            <FileIcon entry={{ name: tab.hostName, type: 'directory', isSymlink: false }} size={15} />
            <span className={styles.sessionTitleText}>{tab.title}</span>
            <span>{tab.username}@{tab.hostname}:{tab.port}</span>
            <span className={styles.sessionTitleSpacer} />
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={handleCloseTab} aria-label="关闭标签页" />
          </div>
          {renderSessionGate()}
          <TransferDrawer />
        </>
      )}

      {/* Hidden pickers */}
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInput} data-testid="upload-input" />
      <input ref={folderInputRef} type="file" multiple hidden onChange={handleFolderInput} data-testid="upload-folder-input" />

      {/* Dialogs */}
      <NewFolderDialog
        open={newFolderOpen}
        parentPath={browser.path}
        onClose={() => setNewFolderOpen(false)}
        onCreate={handleCreateFolder}
      />
      <RenameDialog
        open={renameEntry !== null}
        entry={renameEntry}
        onClose={() => setRenameEntry(null)}
        onRename={handleRename}
      />
      <DeleteDialog
        open={deleteTargets.length > 0}
        entries={deleteTargets}
        onCancel={() => setDeleteTargets([])}
        onConfirm={handleDeleteConfirm}
      />
      <ChmodDialog
        open={chmodTargets.length > 0}
        targets={chmodTargets}
        onClose={() => setChmodTargets([])}
        onApply={handleChmod}
      />
      <SymlinkDialog
        open={symlinkOpen}
        parentPath={browser.path}
        onClose={() => setSymlinkOpen(false)}
        onCreate={handleCreateSymlink}
      />
      <DetailsDialog open={detailsEntry !== null} entry={detailsEntry} onClose={() => setDetailsEntry(null)} />
      <EditorDialog
        open={editorEntry !== null}
        sessionId={sessionId}
        entry={editorEntry}
        onClose={() => setEditorEntry(null)}
        onSaved={() => void browser.refresh()}
        onDownload={(entry) => {
          setEditorEntry(null);
          downloadEntry(entry);
        }}
      />

      <FloatingMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenuItems}
        onClose={() => setContextMenu(null)}
      />
      <TransferCollisionDialog />
    </div>
  );
}

/** Exported for the workspace page / tests that need the browser type. */
export type { FileBrowser };
