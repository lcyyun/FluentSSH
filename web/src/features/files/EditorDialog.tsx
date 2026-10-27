import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  DismissRegular,
  SaveRegular,
  WarningRegular
} from '@fluentui/react-icons';
import type { SftpEntry, SftpReadResult } from '@shared/types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAppStore } from '../../store/app';
import { FileIcon } from './FileIcon';
import { EDITOR_MAX_BYTES, isEditableReadResult } from './file-utils';

const useStyles = makeStyles({
  surface: {
    maxWidth: 'min(1120px, 96vw)',
    width: 'min(1120px, 96vw)',
    height: 'min(780px, 90vh)',
    maxHeight: '90vh',
    display: 'flex'
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    padding: 0,
    gap: 0
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px 10px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0
  },
  titleName: {
    fontSize: '13.5px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flexShrink: 0,
    maxWidth: '40%'
  },
  titlePath: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0
  },
  dirty: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    color: tokens.colorPaletteYellowForeground1,
    whiteSpace: 'nowrap'
  },
  dirtyDot: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: tokens.colorPaletteYellowForeground1 },
  titleActions: { display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', flexShrink: 0 },
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1
  },
  editorArea: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1
  },
  gutter: {
    flex: '0 0 auto',
    minWidth: '44px',
    margin: 0,
    padding: '10px 8px 40px 10px',
    textAlign: 'right',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    lineHeight: '20px',
    color: tokens.colorNeutralForeground4,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke3}`,
    overflow: 'hidden',
    userSelect: 'none',
    whiteSpace: 'pre'
  },
  textarea: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    resize: 'none',
    border: 'none',
    outline: 'none',
    padding: '10px 14px 40px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    lineHeight: '20px',
    tabSize: 2,
    whiteSpace: 'pre',
    overflow: 'auto'
  },
  textareaWrap: { whiteSpace: 'pre-wrap', overflowX: 'hidden' },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '7px 14px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
    minHeight: '32px',
    flexWrap: 'wrap'
  },
  footerItem: { display: 'inline-flex', alignItems: 'center', gap: '4px' },
  footerSpacer: { flex: 1 },
  kbd: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '10px',
    padding: '1px 5px',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1
  },
  saveError: { color: tokens.colorPaletteRedForeground1 },
  stateWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px 24px',
    textAlign: 'center'
  },
  stateIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '26px',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2
  },
  stateIconWarning: {
    color: tokens.colorPaletteYellowForeground1,
    backgroundColor: tokens.colorPaletteYellowBackground2
  },
  stateTitle: { fontSize: '15px', fontWeight: 600, color: tokens.colorNeutralForeground1 },
  stateText: { fontSize: '12.5px', color: tokens.colorNeutralForeground3, maxWidth: '520px', lineHeight: 1.6 },
  stateActions: { display: 'flex', gap: '8px', marginTop: '4px' },
  savingIndicator: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: tokens.colorNeutralForeground3 }
});

export interface EditorDialogProps {
  open: boolean;
  sessionId: string;
  entry: SftpEntry | null;
  onClose: () => void;
  onSaved: () => void;
  onDownload: (entry: SftpEntry) => void;
}

type EditorStatus = 'loading' | 'ready' | 'guarded' | 'error';

export function EditorDialog({ open, sessionId, entry, onClose, onSaved, onDownload }: EditorDialogProps) {
  const styles = useStyles();
  const settings = useAppStore((state) => state.settings);
  const notify = useAppStore((state) => state.notify);
  const targetPath = entry?.path ?? '';
  const [status, setStatus] = useState<EditorStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guardReason, setGuardReason] = useState<'binary' | 'too-large' | null>(null);
  const [readResult, setReadResult] = useState<SftpReadResult | null>(null);
  const [text, setText] = useState('');
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardIntent, setDiscardIntent] = useState<'close' | 'reload'>('close');
  const [wrap, setWrap] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const gutterRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = status === 'ready' && text !== original;
  const fontSize = settings?.files.editorFontSize ?? 13;

  // Load file contents when opened (or reloaded).
  useEffect(() => {
    if (!open || !targetPath) return;
    let cancelled = false;
    setStatus('loading');
    setLoadError(null);
    setSaveError(null);
    setGuardReason(null);
    setReadResult(null);
    setDiscardOpen(false);
    void api.sftp
      .read(sessionId, targetPath, EDITOR_MAX_BYTES)
      .then((result) => {
        if (cancelled) return;
        setReadResult(result);
        if (!isEditableReadResult(result)) {
          setStatus('guarded');
          setGuardReason(result.binary ? 'binary' : result.truncated || result.size > EDITOR_MAX_BYTES ? 'too-large' : 'binary');
          return;
        }
        setText(result.content);
        setOriginal(result.content);
        setStatus('ready');
      })
      .catch((caught) => {
        if (cancelled) return;
        setStatus('error');
        setLoadError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, targetPath, reloadKey]);

  const save = useCallback(async () => {
    if (status !== 'ready' || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.sftp.write(sessionId, targetPath, text, 'utf8');
      setOriginal(text);
      notify('success', '文件已保存', targetPath);
      onSaved();
    } catch (caught) {
      const message = errorMessage(caught);
      setSaveError(message);
      notify('error', '保存失败', message);
    } finally {
      setSaving(false);
    }
  }, [dirty, notify, onSaved, saving, sessionId, status, targetPath, text]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty) {
      setDiscardIntent('close');
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, onClose, saving]);

  const requestReload = useCallback(() => {
    if (dirty) {
      setDiscardIntent('reload');
      setDiscardOpen(true);
      return;
    }
    setReloadKey((key) => key + 1);
  }, [dirty]);

  // Ctrl/Cmd+S saves while the dialog is open; Esc is handled by Dialog.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, save]);

  const lineCount = useMemo(() => (text ? text.split('\n').length : 0), [text]);
  const gutterText = useMemo(() => {
    if (lineCount === 0 || lineCount > 5000) return '';
    const lines: string[] = [];
    for (let line = 1; line <= lineCount; line += 1) lines.push(String(line));
    return lines.join('\n');
  }, [lineCount]);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    const gutter = gutterRef.current;
    if (textarea && gutter) gutter.scrollTop = textarea.scrollTop;
  };

  const insertTab = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const element = event.currentTarget;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${text.slice(0, start)}  ${text.slice(end)}`;
    setText(next);
    window.requestAnimationFrame(() => {
      element.selectionStart = start + 2;
      element.selectionEnd = start + 2;
    });
  };

  const guardTitle =
    guardReason === 'binary' ? '这是二进制文件，无法在编辑器中打开' : '文件过大，无法在编辑器中安全编辑';
  const guardText =
    guardReason === 'binary'
      ? '为避免损坏内容，SFTP 文件管理器不会把二进制文件载入文本编辑器。可以将其下载到本地后使用专用工具编辑，或先转为文本文件再上传。'
      : `文件超过 ${Math.round(EDITOR_MAX_BYTES / 1024 / 1024)} MB 编辑器上限（大小 ${readResult?.size ? `${(readResult.size / 1024 / 1024).toFixed(1)} MB` : '未知'}），只能下载后编辑。保存截断的内容会造成数据丢失。`;

  return (
    <>
      <Dialog open={open} onOpenChange={(_, data) => (!data.open ? requestClose() : undefined)}>
        <DialogSurface className={styles.surface} aria-label="文件编辑器">
          <DialogBody className={styles.body} data-testid="editor-dialog">
            <DialogTitle className={styles.title}>
              {entry && <FileIcon entry={entry} size={17} />}
              <span className={styles.titleName} title={entry?.name}>
                {entry?.name ?? '编辑器'}
              </span>
              <span className={styles.titlePath} title={targetPath} data-testid="editor-path">
                {targetPath}
              </span>
              {dirty && (
                <span className={styles.dirty} data-testid="editor-dirty">
                  <span className={styles.dirtyDot} /> 未保存
                </span>
              )}
              <span className={styles.titleActions}>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<ArrowClockwiseRegular />}
                  onClick={requestReload}
                  aria-label="重新加载"
                  title="重新加载（放弃未保存的更改）"
                  data-testid="editor-reload"
                />
                <Button
                  appearance="primary"
                  size="small"
                  icon={saving ? <Spinner size="tiny" /> : <SaveRegular />}
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  data-testid="editor-save"
                >
                  保存
                </Button>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DismissRegular />}
                  onClick={requestClose}
                  aria-label="关闭编辑器"
                  data-testid="editor-close"
                />
              </span>
            </DialogTitle>
            <DialogContent className={styles.content}>
              {status === 'loading' && (
                <div className={styles.stateWrap} data-testid="editor-loading">
                  <Spinner />
                  <span className={styles.stateText}>正在读取远程文件…</span>
                </div>
              )}
              {status === 'error' && (
                <div className={styles.stateWrap} data-testid="editor-error">
                  <span className={mergeClasses(styles.stateIcon, styles.stateIconWarning)}>
                    <WarningRegular />
                  </span>
                  <span className={styles.stateTitle}>无法打开文件</span>
                  <span className={styles.stateText}>{loadError}</span>
                  <div className={styles.stateActions}>
                    <Button icon={<ArrowClockwiseRegular />} onClick={() => setReloadKey((key) => key + 1)}>
                      重试
                    </Button>
                    {entry && (
                      <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={() => onDownload(entry)}>
                        下载
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {status === 'guarded' && (
                <div className={styles.stateWrap} data-testid="editor-guard">
                  <span className={mergeClasses(styles.stateIcon, styles.stateIconWarning)}>
                    <WarningRegular />
                  </span>
                  <span className={styles.stateTitle}>{guardTitle}</span>
                  <span className={styles.stateText}>{guardText}</span>
                  <div className={styles.stateActions}>
                    {entry && (
                      <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={() => onDownload(entry)}>
                        下载文件
                      </Button>
                    )}
                    <Button appearance="secondary" onClick={requestClose}>
                      关闭
                    </Button>
                  </div>
                </div>
              )}
              {status === 'ready' && (
                <div className={styles.editorArea}>
                  {gutterText && (
                    <pre className={styles.gutter} ref={gutterRef} aria-hidden>
                      {gutterText}
                    </pre>
                  )}
                  <textarea
                    ref={textareaRef}
                    className={mergeClasses(styles.textarea, wrap && styles.textareaWrap)}
                    style={{ fontSize: `${fontSize}px` }}
                    value={text}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    wrap={wrap ? 'soft' : 'off'}
                    onChange={(event) => {
                      setText(event.target.value);
                      if (saveError) setSaveError(null);
                    }}
                    onScroll={syncScroll}
                    onKeyDown={insertTab}
                    data-testid="editor-textarea"
                  />
                </div>
              )}
            </DialogContent>
            <div className={styles.footer}>
              <span className={styles.footerItem} data-testid="editor-lines">
                行 {lineCount} · 字符 {text.length}
              </span>
              <span className={styles.footerItem}>UTF-8</span>
              <span className={styles.footerItem}>SFTP</span>
              <button
                type="button"
                onClick={() => setWrap((value) => !value)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: wrap ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3,
                  font: 'inherit',
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                自动换行：{wrap ? '开' : '关'}
              </button>
              <span className={styles.footerSpacer} />
              {saveError && <span className={styles.saveError}>保存失败：{saveError}</span>}
              {saving ? (
                <span className={styles.savingIndicator}>
                  <Spinner size="tiny" /> 正在保存…
                </span>
              ) : (
                <span className={styles.footerItem}>
                  <span className={styles.kbd}>Ctrl</span>+<span className={styles.kbd}>S</span> 保存
                </span>
              )}
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <ConfirmDialog
        open={discardOpen}
        title="放弃未保存的更改？"
        message={`“${entry?.name ?? ''}”有未保存的修改，${
          discardIntent === 'reload' ? '重新加载后将丢失这些更改。' : '关闭后将丢失这些更改。'
        }`}
        confirmLabel={discardIntent === 'reload' ? '放弃并重新加载' : '放弃更改'}
        cancelLabel={discardIntent === 'reload' ? '继续编辑' : '继续编辑'}
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          if (discardIntent === 'reload') {
            setText(original);
            setReloadKey((key) => key + 1);
          } else {
            onClose();
          }
        }}
      />
    </>
  );
}
