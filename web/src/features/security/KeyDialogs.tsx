import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  OverlayDrawer,
  Spinner,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  AddRegular,
  ArrowImportRegular,
  DismissRegular,
  KeyRegular,
  LockClosedRegular,
  ShieldKeyholeRegular
} from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { KeyAlgorithm, KeyGenerateInput, KeyImportInput, SshKeyMeta } from '@shared/types';
import { api, errorMessage } from '../../api';
import { CopyButton } from '../../components/CopyButton';
import { formatDateTime } from '../../lib/format';
import {
  KEY_ALGORITHM_LABELS,
  KEY_ALGORITHM_OPTIONS,
  friendlyApiError,
  keyBitsOptions
} from './security-utils';

const useStyles = makeStyles({
  surface: { width: '560px', maxWidth: 'calc(100vw - 32px)' },
  surfaceWide: { width: '620px', maxWidth: 'calc(100vw - 32px)' },
  title: { display: 'flex', alignItems: 'center', gap: '9px' },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxHeight: '68vh',
    overflowY: 'auto',
    paddingRight: '2px'
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  hint: { fontSize: '11px', color: tokens.colorNeutralForeground3, lineHeight: 1.5 },
  algoRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' },
  algoCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    padding: '9px 11px',
    borderRadius: '9px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'border-color 120ms ease, background 120ms ease',
    ':hover': { background: tokens.colorNeutralBackground2 },
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  algoCardSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground3,
    boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke1}`,
    ':hover': { border: `1px solid ${tokens.colorBrandStroke1}`, background: tokens.colorNeutralBackground3 }
  },
  algoTitle: { fontSize: '12.5px', fontWeight: 600, letterSpacing: '0.2px' },
  algoDesc: { fontSize: '10.5px', color: tokens.colorNeutralForeground3, lineHeight: 1.35 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  textarea: { minHeight: '150px', fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', lineHeight: 1.5 },
  error: { marginTop: '2px' },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: '108px 1fr',
    gap: '9px 12px',
    fontSize: '12.5px',
    alignItems: 'center'
  },
  metaLabel: { color: tokens.colorNeutralForeground3, fontSize: '11.5px' },
  metaValue: { color: tokens.colorNeutralForeground1, fontWeight: 500 },
  fingerprintBox: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    wordBreak: 'break-all',
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: '7px',
    padding: '7px 9px',
    color: tokens.colorNeutralForeground1
  },
  publicKeyBlock: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    lineHeight: 1.55,
    wordBreak: 'break-all',
    whiteSpace: 'pre-wrap',
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: '8px',
    padding: '10px 11px',
    color: tokens.colorNeutralForeground1,
    maxHeight: '190px',
    overflow: 'auto'
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    color: tokens.colorNeutralForeground3
  },
  drawerSurface: { width: '480px', maxWidth: 'calc(100vw - 32px)' },
  drawerTitle: { display: 'flex', alignItems: 'center', gap: '8px' },
  inline: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  spacer: { flex: 1 },
  notice: { fontSize: '11px', color: tokens.colorNeutralForeground3, lineHeight: 1.55 }
});

function useReset(open: boolean, reset: () => void) {
  useEffect(() => {
    if (!open) return;
    reset();
    // Reset only when the dialog transitions to open; `reset` is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export function KeyGenerateDialog({
  open,
  onDismiss,
  onSaved
}: {
  open: boolean;
  onDismiss: () => void;
  onSaved: (key: SshKeyMeta) => void;
}) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>('ed25519');
  const [bits, setBits] = useState(256);
  const [comment, setComment] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useReset(open, () => {
    setName('');
    setAlgorithm('ed25519');
    setBits(256);
    setComment('');
    setPassphrase('');
    setNameError(null);
    setError(null);
    setBusy(false);
    busyRef.current = false;
  });

  const changeAlgorithm = (next: KeyAlgorithm) => {
    setAlgorithm(next);
    setBits(keyBitsOptions(next)[0] ?? 256);
  };

  const submit = async () => {
    if (busyRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('请填写密钥名称。');
      return;
    }
    const input: KeyGenerateInput = {
      name: trimmed,
      algorithm,
      comment: comment.trim() || undefined,
      passphrase: passphrase.length > 0 ? passphrase : undefined
    };
    if (algorithm !== 'ed25519') input.bits = bits;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { key } = await api.keys.generate(input);
      onSaved(key);
      onDismiss();
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open && !busy ? onDismiss() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            <ShieldKeyholeRegular />
            生成 SSH 密钥
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <Field label="密钥名称" required validationMessage={nameError ?? undefined} validationState={nameError ? 'error' : 'none'}>
                <Input
                  value={name}
                  onChange={(_, data) => {
                    setName(data.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="例如：id_ed25519_工作机"
                  data-testid="key-generate-name"
                  disabled={busy}
                />
              </Field>

              <Field label="算法" required>
                <div className={styles.algoRow} role="radiogroup" aria-label="密钥算法">
                  {KEY_ALGORITHM_OPTIONS.map((option) => {
                    const selected = algorithm === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={mergeClasses(styles.algoCard, selected && styles.algoCardSelected)}
                        onClick={() => changeAlgorithm(option.value)}
                        disabled={busy}
                        data-testid={`key-generate-algo-${option.value}`}
                      >
                        <span className={styles.algoTitle}>{option.label}</span>
                        <span className={styles.algoDesc}>{option.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {algorithm === 'ed25519' ? (
                <div className={styles.hint}>ED25519 密钥长度固定为 256 位，无需选择。</div>
              ) : (
                <Field label="密钥长度（位）" hint={algorithm === 'rsa' ? '越长越安全，但认证握手也更慢。' : 'NIST P 曲线长度。'}>
                  <Dropdown
                    value={`${bits} 位`}
                    selectedOptions={[String(bits)]}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) setBits(Number(data.optionValue));
                    }}
                    disabled={busy}
                    data-testid="key-generate-bits"
                  >
                    {keyBitsOptions(algorithm).map((value) => (
                      <Option key={value} value={String(value)} text={`${value} 位`}>
                        {value} 位
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}

              <Field label="注释" hint="可选，会写入公钥末尾，例如 user@host。">
                <Input
                  value={comment}
                  onChange={(_, data) => setComment(data.value)}
                  placeholder="user@host"
                  className={styles.mono}
                  data-testid="key-generate-comment"
                  disabled={busy}
                />
              </Field>

              <Field label="私钥口令" hint="可选。设置后将加密保存私钥，口令保存在本机加密保险库中。">
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(_, data) => setPassphrase(data.value)}
                  placeholder="留空表示无口令"
                  data-testid="key-generate-passphrase"
                  disabled={busy}
                />
              </Field>

              <div className={styles.notice}>
                <LockClosedRegular /> 私钥只保存在本机加密保险库中，不会上传到任何服务器；公钥可随时复制并安装到远端。
              </div>

              {error && (
                <MessageBar intent="error" className={styles.error}>
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              icon={busy ? <Spinner size="tiny" /> : <AddRegular />}
              onClick={() => void submit()}
              disabled={busy}
              data-testid="key-generate-submit"
            >
              生成密钥
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function KeyImportDialog({
  open,
  onDismiss,
  onSaved
}: {
  open: boolean;
  onDismiss: () => void;
  onSaved: (key: SshKeyMeta) => void;
}) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<{ name?: string; privateKey?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useReset(open, () => {
    setName('');
    setPrivateKey('');
    setPassphrase('');
    setComment('');
    setErrors({});
    setError(null);
    setBusy(false);
    busyRef.current = false;
  });

  const submit = async () => {
    if (busyRef.current) return;
    const nextErrors: { name?: string; privateKey?: string } = {};
    if (!name.trim()) nextErrors.name = '请填写密钥名称。';
    if (!privateKey.trim()) nextErrors.privateKey = '请粘贴私钥内容。';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const input: KeyImportInput = {
      name: name.trim(),
      privateKey,
      passphrase: passphrase.length > 0 ? passphrase : undefined,
      comment: comment.trim() || undefined
    };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { key } = await api.keys.import(input);
      onSaved(key);
      onDismiss();
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open && !busy ? onDismiss() : undefined)}>
      <DialogSurface className={styles.surfaceWide}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            <ArrowImportRegular />
            导入 SSH 密钥
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <MessageBar intent="info">
                <MessageBarBody>
                  粘贴 OpenSSH 私钥（<span className={styles.mono}>-----BEGIN OPENSSH PRIVATE KEY-----</span>
                  ）。私钥会被加密保存在本机保险库，不会上传。
                </MessageBarBody>
              </MessageBar>

              <div className={styles.grid2}>
                <Field label="密钥名称" required validationMessage={errors.name} validationState={errors.name ? 'error' : 'none'}>
                  <Input
                    value={name}
                    onChange={(_, data) => setName(data.value)}
                    placeholder="例如：公司跳板机密钥"
                    data-testid="key-import-name"
                    disabled={busy}
                  />
                </Field>
                <Field label="私钥口令" hint="如果私钥本身带口令，请填写。">
                  <Input
                    type="password"
                    value={passphrase}
                    onChange={(_, data) => setPassphrase(data.value)}
                    placeholder="留空表示无私钥口令"
                    data-testid="key-import-passphrase"
                    disabled={busy}
                  />
                </Field>
              </div>

              <Field
                label="私钥内容"
                required
                validationMessage={errors.privateKey}
                validationState={errors.privateKey ? 'error' : 'none'}
              >
                <Textarea
                  value={privateKey}
                  onChange={(_, data) => setPrivateKey(data.value)}
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
                  resize="vertical"
                  className={styles.textarea}
                  data-testid="key-import-private-key"
                  disabled={busy}
                />
              </Field>

              <Field label="注释" hint="可选，会写入公钥末尾。">
                <Input
                  value={comment}
                  onChange={(_, data) => setComment(data.value)}
                  placeholder="user@host"
                  className={styles.mono}
                  data-testid="key-import-comment"
                  disabled={busy}
                />
              </Field>

              {error && (
                <MessageBar intent="error" className={styles.error}>
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              icon={busy ? <Spinner size="tiny" /> : <ArrowImportRegular />}
              onClick={() => void submit()}
              disabled={busy}
              data-testid="key-import-submit"
            >
              导入密钥
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function KeyRenameDialog({
  open,
  keyMeta,
  onDismiss,
  onSaved
}: {
  open: boolean;
  keyMeta: SshKeyMeta | null;
  onDismiss: () => void;
  onSaved: (key: SshKeyMeta) => void;
}) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useReset(open, () => {
    setName(keyMeta?.name ?? '');
    setComment(keyMeta?.comment ?? '');
    setNameError(null);
    setError(null);
    setBusy(false);
    busyRef.current = false;
  });

  const submit = async () => {
    if (busyRef.current || !keyMeta) return;
    if (!name.trim()) {
      setNameError('请填写密钥名称。');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { key } = await api.keys.update(keyMeta.id, { name: name.trim(), comment: comment.trim() });
      onSaved(key);
      onDismiss();
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open && !busy ? onDismiss() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            <KeyRegular />
            重命名密钥
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <Field label="密钥名称" required validationMessage={nameError ?? undefined} validationState={nameError ? 'error' : 'none'}>
                <Input value={name} onChange={(_, data) => setName(data.value)} data-testid="key-rename-name" disabled={busy} />
              </Field>
              <Field label="注释">
                <Input
                  value={comment}
                  onChange={(_, data) => setComment(data.value)}
                  className={styles.mono}
                  data-testid="key-rename-comment"
                  disabled={busy}
                />
              </Field>
              {keyMeta && (
                <div className={styles.fingerprintBox}>
                  {KEY_ALGORITHM_LABELS[keyMeta.algorithm]} · {keyMeta.bits} 位 · {keyMeta.fingerprint}
                </div>
              )}
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              onClick={() => void submit()}
              disabled={busy}
              icon={busy ? <Spinner size="tiny" /> : undefined}
              data-testid="key-rename-submit"
            >
              保存
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function KeyDetailsDrawer({ keyMeta, onClose }: { keyMeta: SshKeyMeta | null; onClose: () => void }) {
  const styles = useStyles();
  if (!keyMeta) return null;
  return (
    <OverlayDrawer
      open
      position="end"
      size="medium"
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
      className={styles.drawerSurface}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" icon={<DismissRegular />} onClick={onClose} aria-label="关闭" />}
        >
          <div className={styles.drawerTitle}>
            <KeyRegular />
            {keyMeta.name}
          </div>
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className={styles.metaGrid}>
            <span className={styles.metaLabel}>算法</span>
            <span className={styles.metaValue}>
              {KEY_ALGORITHM_LABELS[keyMeta.algorithm]} · {keyMeta.bits} 位
            </span>
            <span className={styles.metaLabel}>来源</span>
            <span className={styles.metaValue}>{keyMeta.isGenerated ? '本机生成' : '外部导入'}</span>
            <span className={styles.metaLabel}>口令保护</span>
            <span className={styles.metaValue}>
              {keyMeta.hasPassphrase ? (
                <span className={styles.inline}>
                  <LockClosedRegular /> 已设置口令
                </span>
              ) : (
                '未设置'
              )}
            </span>
            <span className={styles.metaLabel}>创建时间</span>
            <span className={styles.metaValue}>{formatDateTime(keyMeta.createdAt)}</span>
            <span className={styles.metaLabel}>注释</span>
            <span className={styles.metaValue}>{keyMeta.comment || '—'}</span>
            <span className={styles.metaLabel}>SHA256 指纹</span>
            <span className={styles.metaValue}>
              <span className={styles.fingerprintBox}>{keyMeta.fingerprint}</span>
            </span>
          </div>

          <div className={styles.sectionLabel}>
            <span>公钥</span>
            <span className={styles.spacer} />
            <span data-testid="key-details-copy-public">
              <CopyButton
                value={keyMeta.publicKey}
                label="复制公钥"
                successMessage="公钥已复制"
                appearance="secondary"
                size="small"
                quiet={false}
              />
            </span>
          </div>
          <div className={styles.publicKeyBlock} data-testid="key-public-key">
            {keyMeta.publicKey}
          </div>

          <div className={styles.notice}>
            <LockClosedRegular /> 私钥保存在本机加密保险库中，API 不会返回私钥内容。在远端服务器安装公钥即可使用该密钥认证。
          </div>
        </div>
      </DrawerBody>
      <DrawerFooter>
        <CopyButton value={keyMeta.publicKey} label="复制公钥" successMessage="公钥已复制" appearance="primary" size="medium" quiet={false} />
        <Button appearance="secondary" onClick={onClose}>
          关闭
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
