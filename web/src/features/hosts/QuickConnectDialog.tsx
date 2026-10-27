import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components';
import { FlashRegular, SaveRegular, WindowConsoleRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { AuthType, InlineConnection } from '@shared/types';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';
import { openTerminal } from '../workspace/session-actions';

const useStyles = makeStyles({
  surface: { width: '520px', maxWidth: 'calc(100vw - 32px)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  hint: { fontSize: '11.5px', color: tokens.colorNeutralForeground3, lineHeight: 1.5, marginTop: '4px' },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '8px' }
});

export function QuickConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const settings = useAppStore((state) => state.settings);
  const notify = useAppStore((state) => state.notify);
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [save, setSave] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHostname('');
    setPort(String(settings?.connections.defaultPort ?? 22));
    setUsername(settings?.connections.defaultUsername ?? 'root');
    setAuthType('password');
    setPassword('');
    setSave(false);
    setName('');
    setError(null);
    setBusy(false);
  }, [open, settings]);

  const submit = async () => {
    if (!hostname.trim() || !username.trim()) {
      setError('请输入主机地址和用户名。');
      return;
    }
    if (authType === 'password' && !password) {
      setError('请输入密码，或选择其他认证方式。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const inline: InlineConnection = {
        hostname: hostname.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        password: authType === 'password' ? password : undefined
      };
      if (save) {
        const { host } = await api.hosts.create({
          name: name.trim() || `${username.trim()}@${hostname.trim()}`,
          hostname: inline.hostname,
          port: inline.port,
          username: inline.username,
          authType,
          password: authType === 'password' ? password : undefined
        });
        useAppStore.getState().upsertHost(host);
        notify('success', '主机已保存', host.name);
        await openTerminal({ hostId: host.id, host });
      } else {
        await openTerminal({ inline });
      }
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
              <FlashRegular />
              快速连接
            </div>
          </DialogTitle>
          <DialogContent>
            <div className={styles.grid}>
              <Field label="主机地址" required className="grow">
                <Input
                  autoFocus
                  value={hostname}
                  onChange={(_, data) => setHostname(data.value)}
                  placeholder="server.example.com"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submit();
                  }}
                  data-testid="quick-host"
                />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8 }}>
                <Field label="端口">
                  <Input type="number" value={port} onChange={(_, data) => setPort(data.value)} />
                </Field>
                <Field label="用户名" required>
                  <Input value={username} onChange={(_, data) => setUsername(data.value)} />
                </Field>
              </div>
              <Field label="认证方式">
                <Dropdown
                  value={authLabel(authType)}
                  selectedOptions={[authType]}
                  onOptionSelect={(_, data) => setAuthType(data.optionValue as AuthType)}
                >
                  <Option value="password">密码</Option>
                  <Option value="agent">SSH Agent</Option>
                  <Option value="keyboard-interactive">交互式验证（OTP）</Option>
                </Dropdown>
              </Field>
              <Field label="密码" hint={authType === 'password' ? undefined : '当前认证方式无需密码'}>
                <Input
                  type="password"
                  value={password}
                  onChange={(_, data) => setPassword(data.value)}
                  disabled={authType !== 'password'}
                  placeholder="输入密码"
                  data-testid="quick-password"
                />
              </Field>
              <div className={styles.hint}>
                快速连接不会保存任何信息。需要密钥、跳板机或更多选项时，请创建完整主机配置。
              </div>
              <div className={styles.hint}>首次连接会要求确认主机密钥指纹。</div>
              <div className="grow">
                <Checkbox checked={save} onChange={(_, data) => setSave(Boolean(data.checked))} label="保存为主机" />
                {save && (
                  <Input
                    style={{ marginTop: 8 }}
                    value={name}
                    onChange={(_, data) => setName(data.value)}
                    placeholder="主机名称（可选）"
                  />
                )}
              </div>
              {error && <div className={`${styles.error} grow`}>{error}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              icon={busy ? <Spinner size="tiny" /> : save ? <SaveRegular /> : <WindowConsoleRegular />}
              onClick={() => void submit()}
              disabled={busy}
              data-testid="quick-connect-submit"
            >
              连接
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function authLabel(authType: AuthType) {
  switch (authType) {
    case 'password':
      return '密码';
    case 'agent':
      return 'SSH Agent';
    case 'keyboard-interactive':
      return '交互式验证（OTP）';
    case 'key':
      return 'SSH 密钥';
  }
}
