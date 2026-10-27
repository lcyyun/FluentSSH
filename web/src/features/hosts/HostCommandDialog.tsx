import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import { CodeRegular, PlayRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { ExecResult, HostProfile } from '@shared/types';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';
import { ConfirmDialog } from '../../components/ConfirmDialog';

const useStyles = makeStyles({
  surface: { width: '720px', maxWidth: 'calc(100vw - 32px)' },
  commandRow: { display: 'flex', gap: '8px', marginTop: '12px' },
  output: {
    marginTop: '12px',
    background: tokens.colorNeutralBackgroundInverted,
    color: tokens.colorNeutralForegroundInverted,
    borderRadius: '8px',
    padding: '12px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    lineHeight: 1.55,
    minHeight: '180px',
    maxHeight: '42vh',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  meta: { display: 'flex', gap: '10px', fontSize: '11px', color: tokens.colorNeutralForeground3, marginTop: '8px' },
  stderr: { color: tokens.colorPaletteRedForeground3 },
  hint: { fontSize: '11.5px', color: tokens.colorNeutralForeground3, marginTop: '4px' }
});

export function HostCommandDialog({
  host,
  open,
  onClose
}: {
  host: HostProfile | null;
  open: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const [command, setCommand] = useState('uptime');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostKeyPrompt, setHostKeyPrompt] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!open) return;
    setCommand('uptime');
    setResult(null);
    setError(null);
    setBusy(false);
  }, [open, host]);

  const run = async () => {
    if (!host || !command.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { result } = await api.exec.run({ hostId: host.id, command: command.trim(), timeoutMs: 60_000 });
      setResult(result);
    } catch (err) {
      const apiError = err as { code?: string; details?: Record<string, unknown>; message?: string };
      if (apiError.code === 'HOST_KEY_UNKNOWN' || apiError.code === 'HOST_KEY_MISMATCH') {
        setHostKeyPrompt(apiError.details ?? {});
      } else {
        setError(errorMessage(err));
        notify('error', '命令执行失败', errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const trustAndRetry = async () => {
    if (!hostKeyPrompt) return;
    try {
      await api.knownHosts.trust({
        hostname: String(hostKeyPrompt.hostname ?? ''),
        port: Number(hostKeyPrompt.port ?? 22),
        keyType: String(hostKeyPrompt.keyType ?? 'unknown'),
        fingerprint: String(hostKeyPrompt.fingerprint ?? '')
      });
      setHostKeyPrompt(null);
      notify('success', '主机密钥已信任', '正在重新执行命令…');
      await run();
    } catch (err) {
      notify('error', '信任主机密钥失败', errorMessage(err));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
        <DialogSurface className={styles.surface}>
          <DialogBody>
            <DialogTitle>
              <div className="row">
                <CodeRegular />
                运行命令 · {host?.name}
              </div>
            </DialogTitle>
            <DialogContent>
              <div className="mono" style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>
                {host?.username}@{host?.hostname}:{host?.port}
              </div>
              <div className={styles.commandRow}>
                <Input
                  className="grow"
                  value={command}
                  onChange={(_, data) => setCommand(data.value)}
                  placeholder="输入要执行的远程命令"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void run();
                    }
                  }}
                  data-testid="host-command-input"
                />
                <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <PlayRegular />} onClick={() => void run()} disabled={busy}>
                  执行
                </Button>
              </div>
              <div className={styles.hint}>通过 SSH exec 通道执行一次命令，不会打开交互式终端。</div>
              {error && <div style={{ color: tokens.colorPaletteRedForeground1, fontSize: 12, marginTop: 10 }}>{error}</div>}
              {result && (
                <>
                  <div className={styles.output}>
                    {result.stdout}
                    {result.stderr && <span className={styles.stderr}>{result.stdout ? '\n' : ''}{result.stderr}</span>}
                    {!result.stdout && !result.stderr && <span className="tertiary">（无输出）</span>}
                  </div>
                  <div className={styles.meta}>
                    <span>退出码：{result.exitCode ?? '—'}</span>
                    <span>耗时：{result.durationMs} ms</span>
                    {result.truncated && <span>输出已截断</span>}
                  </div>
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose}>
                关闭
              </Button>
              <Button appearance="primary" icon={<PlayRegular />} onClick={() => void run()} disabled={busy || !command.trim()}>
                再次执行
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <ConfirmDialog
        open={Boolean(hostKeyPrompt)}
        title="需要信任主机密钥"
        message={`首次连接 ${String(hostKeyPrompt?.hostname ?? '')}:${String(hostKeyPrompt?.port ?? 22)}。指纹：${String(hostKeyPrompt?.fingerprint ?? '')}`}
        confirmLabel="信任并执行"
        onCancel={() => setHostKeyPrompt(null)}
        onConfirm={() => void trustAndRetry()}
      />
    </>
  );
}
