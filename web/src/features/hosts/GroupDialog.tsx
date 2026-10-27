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
import { FolderAddRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { HostGroup } from '@shared/types';
import { HOST_COLORS } from '@shared/types';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';

const useStyles = makeStyles({
  surface: { width: '420px', maxWidth: 'calc(100vw - 32px)' },
  colors: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  swatch: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    border: `2px solid ${tokens.colorNeutralBackground1}`,
    boxShadow: `0 0 0 1px ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer'
  },
  active: { boxShadow: `0 0 0 2px ${tokens.colorBrandStroke1}` },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '8px' }
});

export function GroupDialog({
  open,
  group,
  onClose,
  onSaved
}: {
  open: boolean;
  group: HostGroup | null;
  onClose: () => void;
  onSaved: (group: HostGroup) => void;
}) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(HOST_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setColor(group?.color ?? HOST_COLORS[0]);
    setError(null);
    setBusy(false);
  }, [open, group]);

  const submit = async () => {
    if (!name.trim()) {
      setError('请输入分组名称。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = group
        ? await api.groups.update(group.id, { name: name.trim(), color })
        : await api.groups.create({ name: name.trim(), color });
      notify('success', group ? '分组已更新' : '分组已创建', name.trim());
      onSaved(result.group);
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
              <FolderAddRegular />
              {group ? '编辑分组' : '新建分组'}
            </div>
          </DialogTitle>
          <DialogContent>
            <div className="stack" style={{ gap: 12 }}>
              <Field label="分组名称" required>
                <Input
                  autoFocus
                  value={name}
                  onChange={(_, data) => setName(data.value)}
                  placeholder="例如：生产环境"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submit();
                  }}
                />
              </Field>
              <Field label="颜色">
                <div className={styles.colors}>
                  {HOST_COLORS.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={`${styles.swatch}${option === color ? ` ${styles.active}` : ''}`}
                      style={{ background: option }}
                      onClick={() => setColor(option)}
                      aria-label={`颜色 ${option}`}
                    />
                  ))}
                </div>
              </Field>
              {error && <div className={styles.error}>{error}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button appearance="primary" onClick={() => void submit()} disabled={busy} icon={busy ? <Spinner size="tiny" /> : undefined}>
              保存
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
