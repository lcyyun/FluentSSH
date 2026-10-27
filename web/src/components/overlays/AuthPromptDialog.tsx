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
import { KeyRegular, ShieldLockRegular } from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';

const useStyles = makeStyles({
  surface: { width: '440px', maxWidth: 'calc(100vw - 32px)' },
  intro: {
    color: tokens.colorNeutralForeground2,
    fontSize: '12.5px',
    lineHeight: 1.55,
    marginBottom: '14px'
  },
  host: {
    fontSize: '12px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    marginBottom: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '7px'
  },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '8px' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px' }
});

export function AuthPromptDialog() {
  const styles = useStyles();
  const prompt = useAppStore((state) => state.authPrompt);
  const setAuthPrompt = useAppStore((state) => state.setAuthPrompt);
  const notify = useAppStore((state) => state.notify);
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValues(prompt ? prompt.prompts.map(() => '') : []);
    setError(null);
    setBusy(false);
    if (prompt) {
      window.setTimeout(() => firstInput.current?.focus(), 80);
    }
  }, [prompt]);

  const fields = prompt?.prompts ?? [];

  const submit = async () => {
    if (!prompt) return;
    setBusy(true);
    setError(null);
    try {
      await api.authPrompts.respond(prompt.requestId, values);
      setAuthPrompt(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!prompt) return;
    try {
      await api.authPrompts.cancel(prompt.requestId);
    } catch {
      // ignore
    }
    setAuthPrompt(null);
    notify('warning', '已取消验证', 'SSH 连接可能因此中断。');
  };

  return (
    <Dialog open={Boolean(prompt)} modalType="modal" onOpenChange={() => undefined}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            <div className="row">
              <ShieldLockRegular />
              身份验证
            </div>
          </DialogTitle>
          <DialogContent>
            <div className={styles.host}>
              <KeyRegular />
              <span>
                {prompt?.hostLabel}
                <span className="tertiary"> · 服务器请求以下信息</span>
              </span>
            </div>
            {prompt?.instructions && <div className={styles.intro}>{prompt.instructions}</div>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="stack" style={{ gap: 12 }}>
                {fields.map((field, index) => (
                  <Field key={index} label={field.prompt || `字段 ${index + 1}`}>
                    <Input
                      ref={index === 0 ? firstInput : undefined}
                      type={field.echo ? 'text' : 'password'}
                      value={values[index] ?? ''}
                      autoComplete="off"
                      onChange={(_, data) =>
                        setValues((previous) => previous.map((value, i) => (i === index ? data.value : value)))
                      }
                      data-testid={`auth-prompt-input-${index}`}
                    />
                  </Field>
                ))}
              </div>
              {error && <div className={styles.error}>{error}</div>}
            </form>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => void cancel()} disabled={busy}>
              取消连接
            </Button>
            <Button appearance="primary" onClick={() => void submit()} disabled={busy} icon={busy ? <Spinner size="tiny" /> : undefined}>
              验证
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
