import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import { FolderAddRegular, KeyRegular, LinkRegular, RenameRegular } from '@fluentui/react-icons';
import type { SftpEntry } from '@shared/types';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { formatBytes, formatDateTime } from '../../lib/format';
import { FileIcon } from './FileIcon';
import {
  describeEntryType,
  describePermissions,
  formatPermissionBits,
  octalPermissions,
  octalToInput,
  parseOctalMode,
  permissionSummary,
  summarizeSelection
} from './file-utils';

const useStyles = makeStyles({
  wideSurface: { maxWidth: '540px', width: '540px' },
  body: { display: 'flex', flexDirection: 'column', gap: '10px' },
  title: { display: 'flex', alignItems: 'center', gap: '8px' },
  hint: { fontSize: '12px', color: tokens.colorNeutralForeground3, lineHeight: 1.5 },
  pathLine: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: '5px',
    padding: '6px 8px',
    wordBreak: 'break-all',
    maxHeight: '54px',
    overflow: 'auto'
  },
  error: { fontSize: '12px', color: tokens.colorPaletteRedForeground1 },
  fileList: {
    maxHeight: '180px',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
    padding: '6px'
  },
  fileListRow: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', minWidth: 0 },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dangerText: { color: tokens.colorPaletteRedForeground1 },
  chmodGrid: { display: 'flex', gap: '14px', alignItems: 'flex-start' },
  octalBox: { display: 'flex', flexDirection: 'column', gap: '6px', width: '120px' },
  octalInput: { fontFamily: tokens.fontFamilyMonospace, fontSize: '15px', letterSpacing: '2px' },
  preview: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '8px 10px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
    flex: 1
  },
  previewLabel: { fontSize: '11px', color: tokens.colorNeutralForeground3 },
  previewBits: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '15px',
    letterSpacing: '1.5px',
    color: tokens.colorNeutralForeground1
  },
  previewOctal: {
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace
  },
  matrix: { display: 'flex', flexDirection: 'column', gap: '2px' },
  matrixRow: { display: 'flex', alignItems: 'center', gap: '4px' },
  matrixLabel: {
    width: '58px',
    fontSize: '11.5px',
    color: tokens.colorNeutralForeground3,
    flexShrink: 0
  },
  matrixCell: { width: '52px' },
  details: { display: 'flex', flexDirection: 'column', gap: '0' },
  detailRow: {
    display: 'grid',
    gridTemplateColumns: '104px minmax(0, 1fr)',
    gap: '10px',
    padding: '7px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    fontSize: '12px',
    alignItems: 'start'
  },
  detailLabel: { color: tokens.colorNeutralForeground3 },
  detailValue: { color: tokens.colorNeutralForeground1, wordBreak: 'break-all', minWidth: 0 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: '11.5px' },
  detailsHead: { display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '8px' },
  detailsName: {
    fontSize: '14px',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
});

/** Shared "press Enter submits" form wrapper for the small dialogs. */
function DialogForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function useSeededValue(open: boolean, seed: string) {
  const [value, setValue] = useState(seed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValue(seed);
    setError(null);
    setBusy(false);
  }, [open, seed]);
  return { value, setValue, error, setError, busy, setBusy };
}

/* ------------------------------------------------------------------ */
/* New folder                                                          */
/* ------------------------------------------------------------------ */

export function NewFolderDialog({
  open,
  parentPath,
  onClose,
  onCreate
}: {
  open: boolean;
  parentPath: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const styles = useStyles();
  const { value, setValue, error, setError, busy, setBusy } = useSeededValue(open, '新建文件夹');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  const submit = async () => {
    const name = value.trim();
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
      setError('请输入不包含 / 或 \\ 的有效名称。');
      return;
    }
    setBusy(true);
    try {
      await onCreate(name);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.wideSurface}>
        <DialogForm onSubmit={() => void submit()}>
          <DialogBody>
            <DialogTitle className={styles.title}>
              <FolderAddRegular /> 新建文件夹
            </DialogTitle>
            <DialogContent className={styles.body}>
              {parentPath && <div className={styles.pathLine}>{parentPath}</div>}
              <Field label="文件夹名称" validationMessage={error ?? undefined} validationState={error ? 'error' : 'none'}>
                <Input
                  ref={inputRef}
                  value={value}
                  onChange={(_, data) => {
                    setValue(data.value);
                    setError(null);
                  }}
                  data-testid="new-folder-input"
                  placeholder="文件夹名称"
                  spellCheck={false}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose} disabled={busy}>
                取消
              </Button>
              <Button
                appearance="primary"
                type="submit"
                disabled={busy || !value.trim()}
                icon={busy ? <Spinner size="tiny" /> : undefined}
                data-testid="new-folder-submit"
              >
                创建
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogForm>
      </DialogSurface>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Rename                                                              */
/* ------------------------------------------------------------------ */

export function RenameDialog({
  open,
  entry,
  onClose,
  onRename
}: {
  open: boolean;
  entry: SftpEntry | null;
  onClose: () => void;
  onRename: (nextName: string) => Promise<void>;
}) {
  const styles = useStyles();
  const seed = entry?.name ?? '';
  const { value, setValue, error, setError, busy, setBusy } = useSeededValue(open, seed);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const dot = seed.lastIndexOf('.');
      const end = dot > 0 ? dot : seed.length;
      input.setSelectionRange(0, end);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, seed]);

  const submit = async () => {
    const name = value.trim();
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
      setError('请输入不包含 / 或 \\ 的有效名称。');
      return;
    }
    if (name === entry?.name) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onRename(name);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.wideSurface}>
        <DialogForm onSubmit={() => void submit()}>
          <DialogBody>
            <DialogTitle className={styles.title}>
              <RenameRegular /> 重命名
            </DialogTitle>
            <DialogContent className={styles.body}>
              {entry && <div className={styles.pathLine}>{entry.path}</div>}
              <Field label="新名称" validationMessage={error ?? undefined} validationState={error ? 'error' : 'none'}>
                <Input
                  ref={inputRef}
                  value={value}
                  onChange={(_, data) => {
                    setValue(data.value);
                    setError(null);
                  }}
                  data-testid="rename-input"
                  spellCheck={false}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose} disabled={busy}>
                取消
              </Button>
              <Button
                appearance="primary"
                type="submit"
                disabled={busy || !value.trim()}
                icon={busy ? <Spinner size="tiny" /> : undefined}
                data-testid="rename-submit"
              >
                重命名
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogForm>
      </DialogSurface>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Delete confirmation                                                 */
/* ------------------------------------------------------------------ */

export function DeleteDialog({
  open,
  entries,
  onCancel,
  onConfirm
}: {
  open: boolean;
  entries: SftpEntry[];
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const styles = useStyles();
  const hasDirectory = entries.some((entry) => entry.type === 'directory');
  return (
    <ConfirmDialog
      open={open}
      title={`删除${entries.length > 1 ? ` ${entries.length} 个项目` : '项目'}`}
      confirmLabel="删除"
      cancelLabel="取消"
      danger
      onCancel={onCancel}
      onConfirm={onConfirm}
      message={
        <div className={styles.body} data-testid="delete-dialog">
          <span>确定要删除以下{entries.length > 1 ? '项目' : '文件'}吗？此操作无法撤销。</span>
          <div className={styles.fileList}>
            {entries.map((entry, index) => (
              <div className={styles.fileListRow} key={`${entry.name}-${index}`}>
                <FileIcon entry={entry} size={14} />
                <span className={mergeClasses(styles.fileName, 'mono')}>{entry.name}</span>
              </div>
            ))}
          </div>
          {entries.length > 1 && <span className={styles.hint}>已选择：{summarizeSelection(entries)}</span>}
          {hasDirectory && <span className={styles.dangerText}>文件夹内的所有内容都会被递归删除。</span>}
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Symlink                                                             */
/* ------------------------------------------------------------------ */

export function SymlinkDialog({
  open,
  parentPath,
  onClose,
  onCreate
}: {
  open: boolean;
  parentPath: string | null;
  onClose: () => void;
  onCreate: (target: string, name: string) => Promise<void>;
}) {
  const styles = useStyles();
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTarget('');
    setName('');
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async () => {
    if (!target.trim() || !name.trim() || /[\\/]/.test(name)) {
      setError('请填写链接目标和不包含 / 的名称。');
      return;
    }
    setBusy(true);
    try {
      await onCreate(target.trim(), name.trim());
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.wideSurface}>
        <DialogForm onSubmit={() => void submit()}>
          <DialogBody>
            <DialogTitle className={styles.title}>
              <LinkRegular /> 新建符号链接
            </DialogTitle>
            <DialogContent className={styles.body}>
              {parentPath && <div className={styles.pathLine}>{parentPath}</div>}
              <Field
                label="链接目标（绝对路径）"
                validationMessage={error ?? undefined}
                validationState={error ? 'error' : 'none'}
              >
                <Input
                  value={target}
                  onChange={(_, data) => {
                    setTarget(data.value);
                    setError(null);
                  }}
                  placeholder="/etc/nginx/nginx.conf"
                  spellCheck={false}
                  data-testid="symlink-target"
                />
              </Field>
              <Field label="链接名称">
                <Input
                  value={name}
                  onChange={(_, data) => {
                    setName(data.value);
                    setError(null);
                  }}
                  placeholder="nginx.conf"
                  spellCheck={false}
                  data-testid="symlink-name"
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose} disabled={busy}>
                取消
              </Button>
              <Button
                appearance="primary"
                type="submit"
                disabled={busy || !target.trim() || !name.trim()}
                icon={busy ? <Spinner size="tiny" /> : undefined}
                data-testid="symlink-submit"
              >
                创建
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogForm>
      </DialogSurface>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Permissions (chmod)                                                 */
/* ------------------------------------------------------------------ */

const PERMISSION_ROWS: Array<{ key: 'owner' | 'group' | 'other'; label: string; shift: number }> = [
  { key: 'owner', label: '所有者', shift: 6 },
  { key: 'group', label: '用户组', shift: 3 },
  { key: 'other', label: '其他人', shift: 0 }
];

const BIT_LABELS = ['r', 'w', 'x'];

export function ChmodDialog({
  open,
  targets,
  onClose,
  onApply
}: {
  open: boolean;
  targets: SftpEntry[];
  onClose: () => void;
  onApply: (mode: number) => Promise<void>;
}) {
  const styles = useStyles();
  const seedMode = (targets[0]?.mode ?? 0o644) & 0o7777;
  const [mode, setMode] = useState(seedMode);
  const [text, setText] = useState(octalToInput(seedMode));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = (targets[0]?.mode ?? 0o644) & 0o7777;
    setMode(base);
    setText(octalToInput(base));
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targets.length, targets[0]?.path]);

  const toggleBit = (shift: number, bit: number) => {
    setMode((previous) => previous ^ (bit << shift));
    setError(null);
  };

  const handleText = (raw: string) => {
    setText(raw);
    const parsed = parseOctalMode(raw);
    if (parsed === null) {
      setError('请输入 3-4 位八进制权限，例如 755 或 0644。');
      return;
    }
    setError(null);
    setMode(parsed);
  };

  const submit = async () => {
    const parsed = parseOctalMode(text);
    if (parsed === null) {
      setError('请输入 3-4 位八进制权限，例如 755 或 0644。');
      return;
    }
    setBusy(true);
    try {
      await onApply(parsed);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const title = targets.length > 1 ? `修改权限（${targets.length} 个项目）` : '修改权限';
  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.wideSurface}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            <KeyRegular /> {title}
          </DialogTitle>
          <DialogContent className={styles.body} data-testid="chmod-dialog">
            {targets.length > 0 && (
              <div className={styles.pathLine} title={targets.map((entry) => entry.path).join('\n')}>
                {targets.length === 1 ? targets[0]?.path : summarizeSelection(targets)}
              </div>
            )}
            <div className={styles.chmodGrid}>
              <div className={styles.octalBox}>
                <Field label="八进制" validationMessage={error ?? undefined} validationState={error ? 'error' : 'none'}>
                  <Input
                    className={styles.octalInput}
                    value={text}
                    onChange={(_, data) => handleText(data.value)}
                    maxLength={5}
                    spellCheck={false}
                    data-testid="chmod-input"
                  />
                </Field>
                <span className={styles.previewOctal}>当前：{octalPermissions(mode)}</span>
              </div>
              <div className={styles.preview}>
                <span className={styles.previewLabel}>权限预览</span>
                <span className={styles.previewBits} data-testid="chmod-preview">
                  {formatPermissionBits(mode)}
                </span>
                <span className={styles.previewOctal}>{describePermissions(mode)}</span>
                {mode > 0o777 && (
                  <span className={styles.previewOctal}>包含特殊权限位（setuid/setgid/sticky）</span>
                )}
              </div>
            </div>
            <div className={styles.matrix}>
              <div className={styles.matrixRow}>
                <span className={styles.matrixLabel} />
                <span className={styles.matrixCell}>
                  <span className={styles.hint}>读取</span>
                </span>
                <span className={styles.matrixCell}>
                  <span className={styles.hint}>写入</span>
                </span>
                <span className={styles.matrixCell}>
                  <span className={styles.hint}>执行</span>
                </span>
              </div>
              {PERMISSION_ROWS.map((row) => (
                <div className={styles.matrixRow} key={row.key}>
                  <span className={styles.matrixLabel}>{row.label}</span>
                  {[4, 2, 1].map((bit, index) => (
                    <span className={styles.matrixCell} key={bit}>
                      <Checkbox
                        checked={(mode & (bit << row.shift)) !== 0}
                        onChange={() => toggleBit(row.shift, bit)}
                        label={BIT_LABELS[index]}
                        aria-label={`${row.label}${['读取', '写入', '执行'][index]}`}
                      />
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <span className={styles.hint}>
              权限将应用到 {targets.length} 个项目。八进制格式示例：755（所有者可读写执行，其他用户只读执行）。
            </span>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              onClick={() => void submit()}
              disabled={busy || error !== null}
              icon={busy ? <Spinner size="tiny" /> : undefined}
              data-testid="chmod-apply"
            >
              应用
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

export function DetailsDialog({
  open,
  entry,
  onClose
}: {
  open: boolean;
  entry: SftpEntry | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  if (!entry) return null;
  const rows: Array<{ label: string; value: ReactNode; mono?: boolean }> = [
    { label: '名称', value: entry.name },
    { label: '完整路径', value: entry.path, mono: true },
    { label: '类型', value: describeEntryType(entry) },
    {
      label: '大小',
      value:
        entry.type === 'directory'
          ? '—'
          : `${formatBytes(entry.size)}（${entry.size.toLocaleString('zh-CN')} 字节）`
    },
    { label: '权限', value: permissionSummary(entry), mono: true },
    { label: '所有者', value: entry.owner ?? String(entry.uid ?? '—') },
    { label: '用户组', value: entry.group ?? String(entry.gid ?? '—') },
    { label: '修改时间', value: formatDateTime(entry.mtime) },
    { label: '访问时间', value: formatDateTime(entry.atime) }
  ];
  if (entry.type === 'symlink' && entry.linkTarget) {
    rows.push({ label: '链接目标', value: entry.linkTarget, mono: true });
  }
  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.wideSurface}>
        <DialogBody>
          <DialogTitle className={styles.title}>属性</DialogTitle>
          <DialogContent>
            <div className={styles.details} data-testid="details-dialog">
              <div className={styles.detailsHead}>
                <FileIcon entry={entry} size={30} />
                <span className={styles.detailsName} title={entry.name}>
                  {entry.name}
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <CopyButton value={entry.path} tooltip="复制完整路径" successMessage="路径已复制" />
                </span>
              </div>
              {rows.map((row) => (
                <div className={styles.detailRow} key={row.label}>
                  <span className={styles.detailLabel}>{row.label}</span>
                  <span className={mergeClasses(styles.detailValue, row.mono && styles.mono)}>{row.value}</span>
                </div>
              ))}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              关闭
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
