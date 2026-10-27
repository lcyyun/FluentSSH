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
  makeStyles,
  tokens
} from '@fluentui/react-components';
import { LockClosedRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/app';

const useStyles = makeStyles({
  surface: { width: '420px', maxWidth: 'calc(100vw - 32px)' },
  intro: {
    color: tokens.colorNeutralForeground2,
    fontSize: '12.5px',
    lineHeight: 1.6,
    marginBottom: '12px'
  },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '8px' }
});

export function VaultUnlockDialog() {
  const styles = useStyles();
  const vault = useAppStore((state) => state.vault);
  const unlockVault = useAppStore((state) => state.unlockVault);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = Boolean(vault?.protected && !vault.unlocked);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await unlockVault(password);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} modalType="modal" onOpenChange={() => undefined}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            <div className="row">
              <LockClosedRegular />
              保险库已锁定
            </div>
          </DialogTitle>
          <DialogContent>
            <p className={styles.intro}>
              输入主密码解锁保险库。解锁后才能使用已保存的密码、私钥口令，并建立新的连接。
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field label="主密码">
                <Input
                  autoFocus
                  type="password"
                  value={password}
                  onChange={(_, data) => setPassword(data.value)}
                  data-testid="vault-unlock-password"
                />
              </Field>
            </form>
            {error && <div className={styles.error}>{error}</div>}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={() => void submit()} disabled={busy || !password} icon={busy ? <Spinner size="tiny" /> : undefined}>
              解锁
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
