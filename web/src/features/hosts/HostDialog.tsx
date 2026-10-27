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
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Tab,
  TabList,
  Textarea,
  makeStyles,
  tokens,
  type SelectTabData
} from '@fluentui/react-components';
import {
  ArrowRoutingRegular,
  CheckmarkRegular,
  KeyRegular,
  LockClosedRegular,
  PasswordRegular,
  SaveRegular,
  ServerRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import type { AuthType, HostGroup, HostInput, HostProfile, SshKeyMeta } from '@shared/types';
import { HOST_COLORS } from '@shared/types';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';
import { openTerminal } from '../workspace/session-actions';

const useStyles = makeStyles({
  surface: { width: '760px', maxWidth: 'calc(100vw - 32px)' },
  body: { display: 'flex', flexDirection: 'column', minHeight: 0 },
  tabBar: { marginBottom: '14px' },
  content: { maxHeight: '56vh', overflowY: 'auto', paddingRight: '6px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  full: { gridColumn: '1 / -1' },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: tokens.colorNeutralForeground3,
    margin: '6px 0 8px'
  },
  colorRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
  swatch: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    border: `2px solid ${tokens.colorNeutralBackground1}`,
    boxShadow: `0 0 0 1px ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer',
    padding: 0
  },
  swatchActive: { boxShadow: `0 0 0 2px ${tokens.colorBrandStroke1}` },
  authOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '9px 11px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    marginBottom: '6px',
    cursor: 'pointer'
  },
  authOptionActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorBrandBackground2
  },
  authText: { fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '1px' },
  hint: { fontSize: '11.5px', color: tokens.colorNeutralForeground3, lineHeight: 1.5 },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '6px' },
  secretSaved: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: tokens.colorPaletteGreenForeground1
  },
  envHint: { fontSize: '11px', color: tokens.colorNeutralForeground3 }
});

type TabValue = 'general' | 'auth' | 'connection' | 'terminal';

interface Props {
  open: boolean;
  host: HostProfile | null;
  groups: HostGroup[];
  hosts: HostProfile[];
  initialGroupId?: string | null;
  onClose: () => void;
  onSaved: (host: HostProfile) => void;
}

interface FormState {
  name: string;
  hostname: string;
  port: string;
  username: string;
  groupId: string | null;
  tags: string;
  favorite: boolean;
  color: string;
  authType: AuthType;
  keyId: string | null;
  password: string;
  passphrase: string;
  clearPassword: boolean;
  clearPassphrase: boolean;
  proxyJumpId: string | null;
  startupCommand: string;
  envText: string;
  keepaliveInterval: string;
  connectTimeout: string;
  compression: boolean;
  legacyAlgorithms: boolean;
  defaultPath: string;
  notes: string;
  term: string;
  fontSize: string;
}

function toForm(host: HostProfile | null, defaultGroupId?: string | null): FormState {
  return {
    name: host?.name ?? '',
    hostname: host?.hostname ?? '',
    port: String(host?.port ?? 22),
    username: host?.username ?? 'root',
    groupId: host ? host.groupId : defaultGroupId ?? null,
    tags: host?.tags.join(', ') ?? '',
    favorite: host?.favorite ?? false,
    color: host?.color ?? HOST_COLORS[0],
    authType: host?.authType ?? 'password',
    keyId: host?.keyId ?? null,
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false,
    proxyJumpId: host?.proxyJumpId ?? null,
    startupCommand: host?.startupCommand ?? '',
    envText: host ? Object.entries(host.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n') : '',
    keepaliveInterval: String(host?.keepaliveInterval ?? 20000),
    connectTimeout: String(host?.connectTimeout ?? 20000),
    compression: host?.compression ?? false,
    legacyAlgorithms: host?.legacyAlgorithms ?? false,
    defaultPath: host?.defaultPath ?? '',
    notes: host?.notes ?? '',
    term: host?.terminal?.term ?? 'xterm-256color',
    fontSize: String(host?.terminal?.fontSize ?? 14)
  };
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return env;
}

export function HostDialog({ open, host, groups, hosts, initialGroupId, onClose, onSaved }: Props) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const setView = useAppStore((state) => state.setView);
  const [tab, setTab] = useState<TabValue>('general');
  const [form, setForm] = useState<FormState>(() => toForm(host, initialGroupId));
  const [keys, setKeys] = useState<SshKeyMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(host);

  useEffect(() => {
    if (!open) return;
    setTab('general');
    setError(null);
    setForm(toForm(host, initialGroupId));
    void api.keys
      .list()
      .then(({ keys }) => setKeys(keys))
      .catch(() => setKeys([]));
  }, [open, host, initialGroupId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const jumpHosts = useMemo(
    () => hosts.filter((item) => item.id !== host?.id),
    [hosts, host?.id]
  );

  const validate = (): string | null => {
    if (!form.name.trim()) return '请输入主机名称。';
    if (!form.hostname.trim()) return '请输入主机地址。';
    if (!/^[^\s]+$/.test(form.hostname.trim())) return '主机地址不能包含空格。';
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口必须是 1-65535 之间的整数。';
    if (!form.username.trim()) return '请输入用户名。';
    if (form.authType === 'key' && !form.keyId) return '请选择用于认证的 SSH 密钥。';
    if (form.authType === 'password' && !host?.hasPassword && !form.password) return '请输入登录密码，或切换认证方式。';
    return null;
  };

  const buildInput = (): HostInput => {
    const input: HostInput = {
      name: form.name.trim(),
      hostname: form.hostname.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      groupId: form.groupId,
      tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      favorite: form.favorite,
      color: form.color,
      authType: form.authType,
      keyId: form.authType === 'key' ? form.keyId : null,
      proxyJumpId: form.proxyJumpId,
      terminal: { term: form.term || 'xterm-256color', fontSize: Number(form.fontSize) || 14 },
      startupCommand: form.startupCommand,
      env: parseEnv(form.envText),
      keepaliveInterval: Number(form.keepaliveInterval) || 0,
      connectTimeout: Number(form.connectTimeout) || 20000,
      compression: form.compression,
      legacyAlgorithms: form.legacyAlgorithms,
      defaultPath: form.defaultPath,
      notes: form.notes
    };
    if (form.clearPassword) input.password = '';
    else if (form.password) input.password = form.password;
    if (form.clearPassphrase) input.passphrase = '';
    else if (form.passphrase) input.passphrase = form.passphrase;
    return input;
  };

  const save = async (connectAfter: boolean) => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = buildInput();
      const result = isEdit ? await api.hosts.update(host!.id, input) : await api.hosts.create(input);
      notify('success', isEdit ? '主机已更新' : '主机已创建', result.host.name);
      onSaved(result.host);
      onClose();
      if (connectAfter) void openTerminal({ hostId: result.host.id, host: result.host });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const groupOptions = useMemo(() => groups, [groups]);

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <DialogTitle>
            <div className="row">
              <ServerRegular />
              {isEdit ? `编辑主机 · ${host?.name}` : '新建 SSH 主机'}
            </div>
          </DialogTitle>
          <DialogContent>
            <TabList
              className={styles.tabBar}
              selectedValue={tab}
              onTabSelect={(_, data: SelectTabData) => setTab(data.value as TabValue)}
              size="small"
            >
              <Tab value="general" icon={<ServerRegular />}>
                基本
              </Tab>
              <Tab value="auth" icon={<LockClosedRegular />}>
                认证
              </Tab>
              <Tab value="connection" icon={<ArrowRoutingRegular />}>
                连接
              </Tab>
              <Tab value="terminal" icon={<WindowConsoleRegular />}>
                终端
              </Tab>
            </TabList>
            <div className={styles.content}>
              {tab === 'general' && (
                <div className={styles.grid}>
                  <Field label="主机名称" required>
                    <Input
                      value={form.name}
                      onChange={(_, data) => set('name', data.value)}
                      placeholder="例如：生产 Web 01"
                      data-testid="host-name-input"
                    />
                  </Field>
                  <Field label="分组">
                    <Dropdown
                      value={groupOptions.find((group) => group.id === form.groupId)?.name ?? '未分组'}
                      selectedOptions={form.groupId ? [form.groupId] : ['__none']}
                      onOptionSelect={(_, data) =>
                        set('groupId', data.optionValue === '__none' ? null : data.optionValue ?? null)
                      }
                    >
                      <Option value="__none">未分组</Option>
                      {groupOptions.map((group) => (
                        <Option key={group.id} value={group.id}>
                          {group.name}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label="主机地址" required>
                    <Input
                      value={form.hostname}
                      onChange={(_, data) => set('hostname', data.value)}
                      placeholder="192.168.1.10 或 example.com"
                      contentBefore={<ServerRegular />}
                      data-testid="host-address-input"
                    />
                  </Field>
                  <div className={styles.grid} style={{ gap: 12 }}>
                    <Field label="端口" required>
                      <Input
                        type="number"
                        value={form.port}
                        onChange={(_, data) => set('port', data.value)}
                        min={1}
                        max={65535}
                        data-testid="host-port-input"
                      />
                    </Field>
                    <Field label="用户名" required>
                      <Input
                        value={form.username}
                        onChange={(_, data) => set('username', data.value)}
                        data-testid="host-username-input"
                      />
                    </Field>
                  </div>
                  <Field label="标签" hint="使用逗号分隔，最多 20 个">
                    <Input value={form.tags} onChange={(_, data) => set('tags', data.value)} placeholder="生产, web, nginx" />
                  </Field>
                  <Field label="默认远程路径" hint="打开 SFTP 时初始路径">
                    <Input value={form.defaultPath} onChange={(_, data) => set('defaultPath', data.value)} placeholder="/var/www" />
                  </Field>
                  <Field label="颜色" className={styles.full}>
                    <div className={styles.colorRow}>
                      {HOST_COLORS.map((color) => (
                        <button
                          type="button"
                          key={color}
                          className={`${styles.swatch}${form.color === color ? ` ${styles.swatchActive}` : ''}`}
                          style={{ background: color }}
                          aria-label={`颜色 ${color}`}
                          onClick={() => set('color', color)}
                        />
                      ))}
                      <Checkbox
                        checked={form.favorite}
                        onChange={(_, data) => set('favorite', Boolean(data.checked))}
                        label="收藏此主机"
                      />
                    </div>
                  </Field>
                  <Field label="备注" className={styles.full}>
                    <Textarea
                      value={form.notes}
                      onChange={(_, data) => set('notes', data.value)}
                      rows={3}
                      resize="vertical"
                      placeholder="服务器用途、维护窗口、联系人…"
                    />
                  </Field>
                </div>
              )}

              {tab === 'auth' && (
                <div>
                  <div className={styles.sectionTitle}>认证方式</div>
                  <RadioGroup
                    value={form.authType}
                    onChange={(_, data) => set('authType', data.value as AuthType)}
                  >
                    <div
                      className={`${styles.authOption}${form.authType === 'password' ? ` ${styles.authOptionActive}` : ''}`}
                      onClick={() => set('authType', 'password')}
                    >
                      <Radio value="password" />
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <PasswordRegular />
                          <strong>密码</strong>
                        </div>
                        <div className={styles.authText}>使用保存的登录密码进行认证，凭据在保险库中加密存储。</div>
                      </div>
                    </div>
                    <div
                      className={`${styles.authOption}${form.authType === 'key' ? ` ${styles.authOptionActive}` : ''}`}
                      onClick={() => set('authType', 'key')}
                    >
                      <Radio value="key" />
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <KeyRegular />
                          <strong>SSH 密钥</strong>
                        </div>
                        <div className={styles.authText}>使用私钥（可带口令）进行公钥认证，推荐的安全方式。</div>
                      </div>
                    </div>
                    <div
                      className={`${styles.authOption}${form.authType === 'agent' ? ` ${styles.authOptionActive}` : ''}`}
                      onClick={() => set('authType', 'agent')}
                    >
                      <Radio value="agent" />
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <KeyRegular />
                          <strong>SSH Agent</strong>
                        </div>
                        <div className={styles.authText}>使用本机 ssh-agent / Pageant 中已加载的密钥。</div>
                      </div>
                    </div>
                    <div
                      className={`${styles.authOption}${form.authType === 'keyboard-interactive' ? ` ${styles.authOptionActive}` : ''}`}
                      onClick={() => set('authType', 'keyboard-interactive')}
                    >
                      <Radio value="keyboard-interactive" />
                      <div>
                        <div className="row" style={{ gap: 6 }}>
                          <LockClosedRegular />
                          <strong>交互式 / 两步验证</strong>
                        </div>
                        <div className={styles.authText}>连接时由服务器发起验证提示，支持一次性验证码与 OTP。</div>
                      </div>
                    </div>
                  </RadioGroup>

                  <div className={styles.grid} style={{ marginTop: 14 }}>
                    {form.authType === 'password' && (
                      <>
                        <Field
                          label="登录密码"
                          hint={isEdit && host?.hasPassword ? '已保存密码，留空保持不变' : '凭据将被加密保存'}
                        >
                          <Input
                            type="password"
                            value={form.password}
                            onChange={(_, data) => set('password', data.value)}
                            disabled={form.clearPassword}
                            placeholder={isEdit && host?.hasPassword ? '••••••••' : '输入密码'}
                            data-testid="host-password-input"
                          />
                        </Field>
                        <div>
                          {isEdit && host?.hasPassword && (
                            <Checkbox
                              checked={form.clearPassword}
                              onChange={(_, data) => set('clearPassword', Boolean(data.checked))}
                              label="清除已保存的密码"
                            />
                          )}
                          <div className={styles.secretSaved} style={{ marginTop: 8 }}>
                            <LockClosedRegular /> AES-256-GCM 加密存储
                          </div>
                        </div>
                      </>
                    )}
                    {form.authType === 'key' && (
                      <>
                        <Field label="私钥" required>
                          <Dropdown
                            value={keys.find((key) => key.id === form.keyId)?.name ?? '选择密钥'}
                            selectedOptions={form.keyId ? [form.keyId] : []}
                            onOptionSelect={(_, data) => set('keyId', data.optionValue ?? null)}
                          >
                            {keys.length === 0 && <Option value="">尚未创建密钥</Option>}
                            {keys.map((key) => (
                              <Option key={key.id} value={key.id} text={`${key.name} · ${key.algorithm.toUpperCase()}`}>
                                {`${key.name} · ${key.algorithm.toUpperCase()}`}
                              </Option>
                            ))}
                          </Dropdown>
                        </Field>
                        <Field label="私钥口令" hint={isEdit && host?.hasPassphrase ? '已保存口令，留空保持不变' : '选填'}>
                          <Input
                            type="password"
                            value={form.passphrase}
                            onChange={(_, data) => set('passphrase', data.value)}
                            disabled={form.clearPassphrase}
                          />
                        </Field>
                        {isEdit && host?.hasPassphrase && (
                          <Checkbox
                            checked={form.clearPassphrase}
                            onChange={(_, data) => set('clearPassphrase', Boolean(data.checked))}
                            label="清除已保存的私钥口令"
                          />
                        )}
                        <Button
                          appearance="subtle"
                          size="small"
                          onClick={() => {
                            onClose();
                            setView('security');
                          }}
                        >
                          管理 SSH 密钥
                        </Button>
                      </>
                    )}
                    {form.authType === 'agent' && (
                      <div className={`${styles.hint} ${styles.full}`}>
                        将使用环境变量 SSH_AUTH_SOCK 指向的 Agent；Windows 上默认尝试 Pageant / OpenSSH Agent。
                      </div>
                    )}
                    {form.authType === 'keyboard-interactive' && (
                      <div className={`${styles.hint} ${styles.full}`}>
                        连接时若服务器要求验证，应用会弹出验证对话框（支持多字段和 OTP）。
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'connection' && (
                <div className={styles.grid}>
                  <Field label="跳板机 / ProxyJump" hint="先连接所选主机，再通过它访问当前服务器">
                    <Dropdown
                      value={hosts.find((item) => item.id === form.proxyJumpId)?.name ?? '不使用跳板机'}
                      selectedOptions={form.proxyJumpId ? [form.proxyJumpId] : ['__none']}
                      onOptionSelect={(_, data) =>
                        set('proxyJumpId', data.optionValue === '__none' ? null : data.optionValue ?? null)
                      }
                    >
                      <Option value="__none">不使用跳板机</Option>
                      {jumpHosts.map((item) => (
                        <Option
                          key={item.id}
                          value={item.id}
                          text={`${item.name} (${item.username}@${item.hostname})`}
                        >
                          {`${item.name} (${item.username}@${item.hostname})`}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label="启动命令" hint="登录后自动输入到终端">
                    <Input value={form.startupCommand} onChange={(_, data) => set('startupCommand', data.value)} placeholder="cd /var/www && sudo -i" />
                  </Field>
                  <Field label="Keepalive（毫秒）" hint="0 表示禁用">
                    <Input type="number" value={form.keepaliveInterval} onChange={(_, data) => set('keepaliveInterval', data.value)} min={0} />
                  </Field>
                  <Field label="连接超时（毫秒）">
                    <Input type="number" value={form.connectTimeout} onChange={(_, data) => set('connectTimeout', data.value)} min={1000} />
                  </Field>
                  <div className={styles.full}>
                    <Switch
                      checked={form.compression}
                      onChange={(_, data) => set('compression', data.checked)}
                      label="启用传输压缩（服务器支持时）"
                    />
                  </div>
                  <div className={styles.full}>
                    <Switch
                      checked={form.legacyAlgorithms}
                      onChange={(_, data) => set('legacyAlgorithms', data.checked)}
                      label="兼容旧版服务器（启用旧加密算法）"
                    />
                  </div>
                  <div className={`${styles.hint} ${styles.full}`}>
                    终端数据通过本地服务转发；主机密钥会在首次连接时展示指纹并要求确认。
                  </div>
                </div>
              )}

              {tab === 'terminal' && (
                <div className={styles.grid}>
                  <Field label="TERM 类型">
                    <Input value={form.term} onChange={(_, data) => set('term', data.value)} />
                  </Field>
                  <Field label="字体大小" hint="留空使用全局设置">
                    <Input type="number" value={form.fontSize} onChange={(_, data) => set('fontSize', data.value)} min={9} max={32} />
                  </Field>
                  <Field label="环境变量" hint="每行一个 KEY=VALUE" className={styles.full}>
                    <Textarea
                      value={form.envText}
                      onChange={(_, data) => set('envText', data.value)}
                      rows={5}
                      resize="vertical"
                      className="mono"
                      placeholder={'LANG=en_US.UTF-8\nTZ=Asia/Shanghai'}
                    />
                  </Field>
                  <div className={`${styles.hint} ${styles.full}`}>
                    终端字体、光标和配色可在「设置 → 终端」中全局调整。会话记录默认保存在本地审计目录。
                  </div>
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              appearance="primary"
              icon={busy ? <Spinner size="tiny" /> : <SaveRegular />}
              onClick={() => void save(false)}
              disabled={busy}
              data-testid="host-save"
            >
              保存
            </Button>
            <Button
              appearance="outline"
              icon={<WindowConsoleRegular />}
              onClick={() => void save(true)}
              disabled={busy}
            >
              保存并连接
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
