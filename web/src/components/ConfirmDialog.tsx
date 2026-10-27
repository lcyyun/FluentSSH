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
import { WarningRegular } from '@fluentui/react-icons';
import { useState, type ReactNode } from 'react';

const useStyles = makeStyles({
  surface: { maxWidth: '460px', width: '460px' },
  title: { display: 'flex', alignItems: 'center', gap: '9px' },
  warningIcon: { color: tokens.colorPaletteYellowForeground1 },
  body: { color: tokens.colorNeutralForeground2, fontSize: '13px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }
});

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger,
  busy: busyProp,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const isBusy = busyProp ?? busy;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onCancel() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            {danger && <WarningRegular className={styles.warningIcon} />}
            {title}
          </DialogTitle>
          <DialogContent>
            <div className={styles.body}>{message}</div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onCancel} disabled={isBusy}>
              {cancelLabel}
            </Button>
            <Button
              appearance="primary"
              style={danger ? { background: tokens.colorPaletteRedBackground3 } : undefined}
              onClick={() => void handleConfirm()}
              disabled={isBusy}
              icon={isBusy ? <Spinner size="tiny" /> : undefined}
            >
              {confirmLabel}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
