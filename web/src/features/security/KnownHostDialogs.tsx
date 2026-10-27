import {
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Textarea,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowExportRegular,
  ArrowImportRegular,
  ArrowSyncRegular,
  ShieldCheckmarkRegular
} from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { KnownHost } from '@shared/types';
import { api } from '../../api';
import { CopyButton } from '../../components/CopyButton';
import { downloadTextFile } from '../../lib/format';
import { useAppStore } from '../../store/app';
import { COMMON_KEY_TYPES, friendlyApiError } from './security-utils';

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
  grid3: { display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 1.2fr', gap: '10px' },
  hint: { fontSize: '11px', color: tokens.colorNeutralForeground3, lineHeight: 1.5 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  textarea: { minHeight: '190px', fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', lineHeight: 1.55 },
  error: { marginTop: '2px' },
  exportBlock: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    borderRadius: '8px',
    padding: '10px 11px',
    color: tokens.colorNeutralForeground1,
    maxHeight: '300px',
    overflow: 'auto',
    minHeight: '120px'
  },
  exportToolbar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  spacer: { flex: 1 },
  notice: { fontSize: '11px', color: tokens.colorNeutralForeground3, lineHeight: 1.55 }
});

export function TrustKnownHostDialog({
  open,
  onDismiss,
  onSaved
}: {
  open: boolean;
  onDismiss: () => void;
  onSaved: (knownHost: KnownHost) => void;
}) {
  const styles = useStyles();
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [keyType, setKeyType] = useState('ssh-ed25519');
  const [fingerprint, setFingerprint] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setHostname('');
    setPort('22');
    setKeyType('ssh-ed25519');
    setFingerprint('');
    setErrors({});
    setError(null);
    setBusy(false);
    busyRef.current = false;
  }, [open]);

  const submit = async () => {
    if (busyRef.current) return;
    const nextErrors: Record<string, string> = {};
    const host = hostname.trim();
    const fp = fingerprint.trim();
    const portNumber = Number(port);
    if (!host) nextErrors.hostname = '请填写主机名或 IP 地址。';
    if (!/^\d{1,5}$/.test(port.trim()) || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      nextErrors.port = '端口需为 1–65535 的整数。';
    }
    if (!keyType.trim()) nextErrors.keyType = '请填写或选择密钥类型。';
    if (!fp) nextErrors.fingerprint = '请填写 SHA256 指纹。';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { knownHost } = await api.knownHosts.trust({
        hostname: host,
        port: portNumber,
        keyType: keyType.trim(),
        fingerprint: fp
      });
      onSaved(knownHost);
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
            <ShieldCheckmarkRegular />
            信任主机密钥
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <div className={styles.hint}>
                手动添加一条 known_hosts 记录。指纹格式为 <span className={styles.mono}>SHA256:…</span>
                ，请通过可信渠道与服务端管理员核对。
              </div>
              <div className={styles.grid3}>
                <Field label="主机名 / IP" required validationMessage={errors.hostname} validationState={errors.hostname ? 'error' : 'none'}>
                  <Input
                    value={hostname}
                    onChange={(_, data) => setHostname(data.value)}
                    placeholder="example.com"
                    className={styles.mono}
                    data-testid="knownhost-trust-hostname"
                    disabled={busy}
                  />
                </Field>
                <Field label="端口" required validationMessage={errors.port} validationState={errors.port ? 'error' : 'none'}>
                  <Input
                    value={port}
                    onChange={(_, data) => setPort(data.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                    className={styles.mono}
                    data-testid="knownhost-trust-port"
                    disabled={busy}
                  />
                </Field>
                <Field label="密钥类型" required validationMessage={errors.keyType} validationState={errors.keyType ? 'error' : 'none'}>
                  <Combobox
                    freeform
                    value={keyType}
                    onChange={(event) => setKeyType(event.target.value)}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) setKeyType(data.optionValue);
                    }}
                    placeholder="ssh-ed25519"
                    className={styles.mono}
                    data-testid="knownhost-trust-keytype"
                    disabled={busy}
                  >
                    {COMMON_KEY_TYPES.map((type) => (
                      <Option key={type} value={type} text={type}>
                        {type}
                      </Option>
                    ))}
                  </Combobox>
                </Field>
              </div>
              <Field
                label="SHA256 指纹"
                required
                validationMessage={errors.fingerprint}
                validationState={errors.fingerprint ? 'error' : 'none'}
                hint="形如 SHA256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx，可从服务器管理员处获取。"
              >
                <Input
                  value={fingerprint}
                  onChange={(_, data) => setFingerprint(data.value)}
                  placeholder="SHA256:…"
                  className={styles.mono}
                  data-testid="knownhost-trust-fingerprint"
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
              icon={busy ? <Spinner size="tiny" /> : <ShieldCheckmarkRegular />}
              onClick={() => void submit()}
              disabled={busy}
              data-testid="knownhost-trust-submit"
            >
              信任此密钥
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ImportKnownHostsDialog({
  open,
  onDismiss,
  onImported
}: {
  open: boolean;
  onDismiss: () => void;
  onImported: (result: { imported: number; skipped: number }) => void;
}) {
  const styles = useStyles();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setContent('');
    setError(null);
    setContentError(null);
    setBusy(false);
    busyRef.current = false;
  }, [open]);

  const submit = async () => {
    if (busyRef.current) return;
    if (!content.trim()) {
      setContentError('请粘贴 known_hosts 内容。');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.knownHosts.import(content);
      onImported(result);
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
            导入 known_hosts
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <div className={styles.hint}>
                粘贴 <span className={styles.mono}>known_hosts</span> 文本内容，每行一条记录。支持非哈希条目；哈希条目与
                <span className={styles.mono}> @cert-authority</span> 行会被跳过。
              </div>
              <Field
                label="known_hosts 内容"
                required
                validationMessage={contentError ?? undefined}
                validationState={contentError ? 'error' : 'none'}
              >
                <Textarea
                  value={content}
                  onChange={(_, data) => {
                    setContent(data.value);
                    if (contentError) setContentError(null);
                  }}
                  placeholder={'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA…\n10.0.0.5 ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB…'}
                  resize="vertical"
                  className={styles.textarea}
                  data-testid="knownhost-import-content"
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
              data-testid="knownhost-import-submit"
            >
              导入
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ExportKnownHostsDialog({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.knownHosts.export();
      setContent(result.content);
    } catch (err) {
      setContent('');
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setContent('');
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const download = () => {
    if (!content) return;
    downloadTextFile('known_hosts', content);
    notify('success', 'known_hosts 已导出', '文件已保存到下载目录。');
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onDismiss() : undefined)}>
      <DialogSurface className={styles.surfaceWide}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            <ArrowExportRegular />
            导出 known_hosts
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <div className={styles.exportToolbar}>
                <span className={styles.hint}>
                  {loading ? '正在生成…' : content ? `共 ${content.split('\n').filter((line) => line.trim()).length} 条记录` : '暂无内容'}
                </span>
                <span className={styles.spacer} />
                <Button
                  appearance="subtle"
                  size="small"
                  icon={loading ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                  onClick={() => void load()}
                  disabled={loading}
                  data-testid="knownhost-export-refresh"
                >
                  重新生成
                </Button>
                <span data-testid="knownhost-export-copy">
                  <CopyButton
                    value={content}
                    label="复制内容"
                    successMessage="known_hosts 内容已复制"
                    appearance="secondary"
                    size="small"
                    quiet={false}
                    disabled={!content || loading}
                  />
                </span>
                <Button
                  appearance="primary"
                  size="small"
                  icon={<ArrowDownloadRegular />}
                  onClick={download}
                  disabled={!content || loading}
                  data-testid="knownhost-export-download"
                >
                  下载文件
                </Button>
              </div>
              {error ? (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              ) : (
                <div className={styles.exportBlock} data-testid="knownhost-export-content">
                  {loading ? '正在读取 known_hosts…' : content || '（没有可导出的主机记录）'}
                </div>
              )}
              <div className={styles.notice}>
                导出的内容为标准 OpenSSH known_hosts 格式，可用于备份或导入到其它客户端。
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss}>
              关闭
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
