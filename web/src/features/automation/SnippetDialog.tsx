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
import { BookmarkRegular, SaveRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { Snippet } from '@shared/types';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';

const useStyles = makeStyles({
  surface: { width: '620px', maxWidth: 'calc(100vw - 32px)' },
  form: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' },
  hint: { fontSize: '11px', color: tokens.colorNeutralForeground3 },
  command: { minHeight: '110px', fontFamily: tokens.fontFamilyMonospace, fontSize: '12px' },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px' }
});

export interface SnippetDialogProps {
  open: boolean;
  /** `null` creates a new snippet, a value edits that snippet. */
  snippet: Snippet | null;
  onClose: () => void;
  onSaved: (snippet: Snippet) => void;
}

export function SnippetDialog({ open, snippet, onClose, onSaved }: SnippetDialogProps) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(snippet?.name ?? '');
    setCommand(snippet?.command ?? '');
    setDescription(snippet?.description ?? '');
    setTags(snippet?.tags.join(', ') ?? '');
    setError(null);
    setBusy(false);
  }, [open, snippet]);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName) {
      setError('请填写片段名称。');
      return;
    }
    if (!trimmedCommand) {
      setError('请填写命令内容。');
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      name: trimmedName,
      command: trimmedCommand,
      description: description.trim(),
      tags: tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20)
    };
    try {
      const saved = snippet
        ? (await api.snippets.update(snippet.id, input)).snippet
        : (await api.snippets.create(input)).snippet;
      notify('success', snippet ? '片段已更新' : '片段已创建', saved.name);
      onSaved(saved);
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
              <BookmarkRegular />
              {snippet ? '编辑命令片段' : '新建命令片段'}
            </div>
          </DialogTitle>
          <DialogContent>
            <div className={styles.form}>
              <Field label="名称" required>
                <Input
                  autoFocus
                  value={name}
                  onChange={(_, data) => setName(data.value)}
                  placeholder="例如：查看磁盘占用"
                  data-testid="snippet-name-input"
                />
              </Field>
              <Field label="命令" required hint="可通过 Ctrl+Enter 在命令页快速执行">
                <Textarea
                  className={styles.command}
                  resize="vertical"
                  value={command}
                  onChange={(_, data) => setCommand(data.value)}
                  placeholder="df -h /"
                  data-testid="snippet-command-input"
                />
              </Field>
              <Field label="描述">
                <Input
                  value={description}
                  onChange={(_, data) => setDescription(data.value)}
                  placeholder="说明片段用途（可选）"
                  data-testid="snippet-description-input"
                />
              </Field>
              <Field label="标签" hint="使用逗号分隔，最多 20 个">
                <Input
                  value={tags}
                  onChange={(_, data) => setTags(data.value)}
                  placeholder="磁盘, 运维"
                  data-testid="snippet-tags-input"
                />
              </Field>
              {error && <div className={styles.error}>{error}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              onClick={() => void submit()}
              disabled={busy}
              icon={busy ? <Spinner size="tiny" /> : <SaveRegular />}
              data-testid="snippet-save"
            >
              保存片段
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
