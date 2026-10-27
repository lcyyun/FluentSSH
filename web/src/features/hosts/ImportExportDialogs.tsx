import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Textarea,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import { ArrowDownloadRegular, ArrowImportRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { HostProfile } from '@shared/types';
import { api, errorMessage } from '../../api';
import { CopyButton } from '../../components/CopyButton';
import { downloadTextFile } from '../../lib/format';
import { useAppStore } from '../../store/app';

const useStyles = makeStyles({
  surface: { width: '640px', maxWidth: 'calc(100vw - 32px)' },
  hint: { color: tokens.colorNeutralForeground3, fontSize: '12px', lineHeight: 1.6 },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '8px' },
  codeArea: { fontFamily: tokens.fontFamilyMonospace, fontSize: '12px', minHeight: '260px' },
  summary: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '8px',
    background: tokens.colorNeutralBackground3,
    fontSize: '12px',
    color: tokens.colorNeutralForeground2
  }
});

export function ImportSshConfigDialog({
  open,
  onClose,
  onImported
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const [content, setContent] = useState('');
  const [groupName, setGroupName] = useState('SSH Config 导入');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setContent('');
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async () => {
    if (!content.trim()) {
      setError('请粘贴 SSH Config 内容。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { result } = await api.hosts.importSshConfig(content, groupName.trim() || undefined);
      notify(
        'success',
        `已导入 ${result.imported.length} 台主机`,
        result.skipped ? `跳过 ${result.skipped} 条无效配置` : result.groupName ?? undefined
      );
      onImported();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            <div className="row">
              <ArrowImportRegular />
              从 SSH Config 导入
            </div>
          </DialogTitle>
          <DialogContent>
            <div className="stack" style={{ gap: 12 }}>
              <div className={styles.hint}>
                粘贴 ~/.ssh/config 内容。支持 Host / HostName / User / Port / ProxyJump 字段；通配符 Host
                会被跳过，导入的主机默认使用 SSH Agent 认证（可在编辑中调整）。
              </div>
              <Field label="分组名称">
                <Input value={groupName} onChange={(_, data) => setGroupName(data.value)} />
              </Field>
              <Field label="SSH Config 内容" required>
                <Textarea
                  value={content}
                  onChange={(_, data) => setContent(data.value)}
                  rows={14}
                  className={styles.codeArea}
                  placeholder={'Host prod-web\n  HostName 10.0.0.10\n  User deploy\n  Port 22'}
                />
              </Field>
              {error && <div className={styles.error}>{error}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button appearance="primary" onClick={() => void submit()} disabled={busy} icon={busy ? <Spinner size="tiny" /> : undefined}>
              导入
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ExportSshConfigDialog({
  open,
  onClose,
  hosts
}: {
  open: boolean;
  onClose: () => void;
  hosts: HostProfile[];
}) {
  const styles = useStyles();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    setError(null);
    void api.hosts
      .exportConfig()
      .then((result) => setContent(result.content))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            <div className="row">
              <ArrowDownloadRegular />
              导出 SSH Config
            </div>
          </DialogTitle>
          <DialogContent>
            <div className="stack" style={{ gap: 12 }}>
              <div className={styles.summary}>共 {hosts.length} 台主机。导出的配置不包含密码或私钥。</div>
              {error && <div className={styles.error}>{error}</div>}
              <Textarea
                readOnly
                value={content}
                rows={16}
                className={styles.codeArea}
                placeholder={busy ? '正在生成…' : ''}
              />
            </div>
          </DialogContent>
          <DialogActions>
            <CopyButton value={content} label="复制" appearance="secondary" quiet={false} disabled={!content} />
            <Button
              appearance="secondary"
              icon={<ArrowDownloadRegular />}
              disabled={!content}
              onClick={() => downloadTextFile('fluentssh-config', content, 'text/plain')}
            >
              下载文件
            </Button>
            <Button appearance="primary" onClick={onClose}>
              完成
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
