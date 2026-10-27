import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import { ShieldKeyholeRegular, WarningRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';
import { CopyButton } from '../CopyButton';

const useStyles = makeStyles({
  surface: { width: '520px', maxWidth: 'calc(100vw - 32px)' },
  warning: {
    display: 'flex',
    gap: '10px',
    padding: '12px',
    borderRadius: '9px',
    background: tokens.colorPaletteYellowBackground2,
    border: `1px solid ${tokens.colorPaletteYellowBorder2}`,
    color: tokens.colorPaletteYellowForeground1,
    fontSize: '12.5px',
    lineHeight: 1.55,
    marginBottom: '14px'
  },
  danger: {
    background: tokens.colorPaletteRedBackground2,
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    color: tokens.colorPaletteRedForeground1
  },
  labelRow: {
    display: 'grid',
    gridTemplateColumns: '110px 1fr',
    gap: '8px 10px',
    fontSize: '12.5px',
    alignItems: 'center',
    margin: '12px 0'
  },
  label: { color: tokens.colorNeutralForeground3 },
  fingerprint: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '11.5px',
    wordBreak: 'break-all',
    background: tokens.colorNeutralBackground3,
    borderRadius: '6px',
    padding: '7px 9px',
    color: tokens.colorNeutralForeground1
  },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px' }
});

export function HostKeyDialog() {
  const styles = useStyles();
  const challenge = useAppStore((state) => state.hostKeyChallenge);
  const close = useAppStore((state) => state.closeHostKeyChallenge);
  const notify = useAppStore((state) => state.notify);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const details = challenge?.details ?? {};
  const hostname = String(details.hostname ?? '');
  const port = Number(details.port ?? 22);
  const keyType = String(details.keyType ?? 'unknown');
  const fingerprint = String(details.fingerprint ?? '');
  const expected = details.expectedFingerprint ? String(details.expectedFingerprint) : null;
  const mismatch = Boolean(expected && expected !== fingerprint);

  const trust = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api.knownHosts.trust({ hostname, port, keyType, fingerprint });
      notify('success', '已信任主机密钥', `${hostname}:${port}`);
      close();
      await challenge.retry();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(challenge)} onOpenChange={(_, data) => (!data.open ? close() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            <div className="row">
              <ShieldKeyholeRegular />
              {mismatch ? '主机密钥已更改' : '验证主机密钥'}
            </div>
          </DialogTitle>
          <DialogContent>
            <div className={`${styles.warning} ${mismatch ? styles.danger : ''}`}>
              {mismatch ? <WarningRegular /> : <ShieldKeyholeRegular />}
              <div>
                {mismatch ? (
                  <>
                    存储的密钥与服务器当前提供的密钥不一致。这可能意味着服务器被重装，也可能存在
                    <strong> 中间人攻击 </strong>
                    风险。请通过可信渠道核对指纹后再继续。
                  </>
                ) : (
                  <>
                    这是首次连接该主机。请确认下面的指纹与服务端管理员提供的一致，再信任它。
                    信任后，该密钥将保存在 Known Hosts 中。
                  </>
                )}
              </div>
            </div>
            <div className={styles.labelRow}>
              <span className={styles.label}>主机</span>
              <span className="mono">
                {hostname}:{port}
              </span>
              <span className={styles.label}>密钥类型</span>
              <span className="mono">{keyType}</span>
              <span className={styles.label}>SHA256 指纹</span>
              <span className={styles.fingerprint}>{fingerprint}</span>
              {expected && (
                <>
                  <span className={styles.label}>已信任指纹</span>
                  <span className={styles.fingerprint}>{expected}</span>
                </>
              )}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <CopyButton value={fingerprint} label="复制指纹" appearance="secondary" size="small" quiet={false} />
              <span className="tertiary" style={{ fontSize: 11 }}>
                仅在你确认服务器身份时继续
              </span>
            </div>
            {error && <div className={styles.error}>{error}</div>}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={close} disabled={busy}>
              取消
            </Button>
            <Button appearance="primary" onClick={() => void trust()} disabled={busy || !fingerprint} icon={busy ? <Spinner size="tiny" /> : undefined}>
              信任并继续
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
