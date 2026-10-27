import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Switch,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowRoutingRegular,
  ArrowRightRegular,
  DesktopMacRegular,
  GlobeRegular,
  InfoRegular,
  PlugConnectedRegular,
  ServerRegular
} from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import type { HostProfile, TunnelInfo, TunnelInput, TunnelType } from '@shared/types';
import { errorMessage } from '../../api';
import { TUNNEL_TYPE_HINTS, TUNNEL_TYPE_LABELS } from './tunnel-utils';

const useStyles = makeStyles({
  surface: { width: '680px', maxWidth: 'calc(100vw - 32px)' },
  title: { display: 'flex', alignItems: 'center', gap: '9px' },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxHeight: '68vh',
    overflowY: 'auto',
    paddingRight: '2px'
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  typeRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' },
  typeCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    textAlign: 'left',
    padding: '10px 11px',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
    ':hover': { background: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke1}` },
    ':disabled': { cursor: 'not-allowed', opacity: 0.6 }
  },
  typeCardSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    background: tokens.colorNeutralBackground3,
    boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke1}`,
    ':hover': { border: `1px solid ${tokens.colorBrandStroke1}`, background: tokens.colorNeutralBackground3 }
  },
  typeIcon: { fontSize: '17px', marginTop: '1px', color: tokens.colorBrandForeground1 },
  typeText: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  typeTitle: { fontSize: '12.5px', fontWeight: 600 },
  typeDesc: { fontSize: '10.5px', color: tokens.colorNeutralForeground3, lineHeight: 1.4 },
  hostOption: { display: 'flex', flexDirection: 'column' },
  hint: { fontSize: '11px', color: tokens.colorNeutralForeground3, lineHeight: 1.45 },
  warnHint: { color: tokens.colorPaletteYellowForeground1 },
  preview: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    padding: '11px 13px',
    borderRadius: '10px',
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke3}`
  },
  previewTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.3px',
    color: tokens.colorNeutralForeground3
  },
  previewRoute: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    color: tokens.colorNeutralForeground1
  },
  endpoint: {
    padding: '2px 7px',
    borderRadius: '6px',
    background: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`
  },
  endpointTarget: { border: `1px dashed ${tokens.colorBrandStroke2}`, color: tokens.colorBrandForeground1 },
  previewHint: { fontSize: '11px', color: tokens.colorNeutralForeground3 },
  hostChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    color: tokens.colorNeutralForeground2
  },
  noHosts: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    padding: '9px 11px',
    borderRadius: '9px',
    background: tokens.colorPaletteYellowBackground2,
    border: `1px solid ${tokens.colorPaletteYellowBorder2}`,
    color: tokens.colorPaletteYellowForeground1,
    fontSize: '12px'
  },
  error: { marginTop: '2px' },
  mono: { fontFamily: tokens.fontFamilyMonospace }
});

interface FormState {
  name: string;
  hostId: string;
  type: TunnelType;
  bindHost: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
  autoStart: boolean;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

const DEFAULT_BIND_PORTS: Record<TunnelType, string> = { local: '8080', remote: '8080', dynamic: '1080' };

function emptyState(hosts: HostProfile[]): FormState {
  return {
    name: '',
    hostId: hosts[0]?.id ?? '',
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: '8080',
    targetHost: '127.0.0.1',
    targetPort: '80',
    autoStart: false
  };
}

function fromTunnel(tunnel: TunnelInfo): FormState {
  return {
    name: tunnel.name,
    hostId: tunnel.hostId,
    type: tunnel.type,
    bindHost: tunnel.bindHost || '127.0.0.1',
    bindPort: String(tunnel.bindPort ?? ''),
    targetHost: tunnel.targetHost || '127.0.0.1',
    targetPort: tunnel.targetPort ? String(tunnel.targetPort) : '',
    autoStart: tunnel.autoStart
  };
}

function parsePort(value: string, allowZero: boolean): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port)) return null;
  if (port < (allowZero ? 0 : 1) || port > 65535) return null;
  return port;
}

function validate(form: FormState, hosts: HostProfile[]): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = '请填写隧道名称。';
  else if (name.length > 120) errors.name = '名称不能超过 120 个字符。';

  const host = hosts.find((item) => item.id === form.hostId);
  if (!form.hostId) errors.hostId = '请选择隧道使用的 SSH 主机。';
  else if (!host) errors.hostId = '所选主机已不存在，请重新选择。';

  if (!form.bindHost.trim()) errors.bindHost = '请填写绑定地址，例如 127.0.0.1。';

  const allowZeroBind = form.type === 'remote';
  const bindPort = parsePort(form.bindPort, allowZeroBind);
  if (bindPort === null) {
    errors.bindPort = allowZeroBind
      ? '端口需为 0–65535 的整数（0 表示由服务器分配）。'
      : '端口需为 1–65535 的整数。';
  }

  let targetHost: string | null = null;
  let targetPort: number | null = null;
  if (form.type !== 'dynamic') {
    targetHost = form.targetHost.trim();
    if (!targetHost) errors.targetHost = '请填写目标地址，例如 10.0.0.12 或 db.internal。';
    targetPort = parsePort(form.targetPort, false);
    if (targetPort === null) errors.targetPort = '目标端口需为 1–65535 的整数。';
  }

  // Loop / self-reference guards.
  if (bindPort !== null && targetHost && targetPort !== null && form.type === 'local') {
    const bindAddress = form.bindHost.trim().toLowerCase();
    const normalizedTarget = targetHost.toLowerCase();
    if (bindAddress === normalizedTarget && bindPort === targetPort) {
      errors.bindPort = '绑定端口与目标相同且位于同一地址，会形成转发环路。';
    }
    if (host && targetPort === host.port && (normalizedTarget === host.hostname.toLowerCase() || normalizedTarget === host.name.toLowerCase())) {
      errors.targetPort = '目标与本连接主机的 SSH 端口相同，会形成转发环路。';
    }
  }

  return errors;
}

export interface TunnelFormDialogProps {
  open: boolean;
  editing: TunnelInfo | null;
  hosts: HostProfile[];
  onDismiss: () => void;
  onSubmit: (input: TunnelInput) => Promise<void>;
  onManageHosts: () => void;
}

export function TunnelFormDialog({ open, editing, hosts, onDismiss, onSubmit, onManageHosts }: TunnelFormDialogProps) {
  const styles = useStyles();
  const [form, setForm] = useState<FormState>(() => emptyState(hosts));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? fromTunnel(editing) : emptyState(hosts));
    setErrors({});
    setSubmitError(null);
    setBusy(false);
    busyRef.current = false;
    // Intentionally not depending on `hosts` identity: refreshing hosts while the
    // dialog is open should not wipe user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const changeType = (type: TunnelType) => {
    setForm((current) => {
      const bindPort = current.bindPort === '' || current.bindPort === '1080' || current.bindPort === '8080'
        ? DEFAULT_BIND_PORTS[type]
        : current.bindPort;
      return { ...current, type, bindPort };
    });
    setErrors({});
  };

  const selectedHost = hosts.find((host) => host.id === form.hostId);
  const bindPort = parsePort(form.bindPort, form.type === 'remote');
  const targetPort = parsePort(form.targetPort, false);

  const previewFrom = `${form.bindHost.trim() || '0.0.0.0'}:${bindPort ?? (form.bindPort || '—')}`;
  const previewTo = form.type === 'dynamic'
    ? null
    : `${form.targetHost.trim() || '—'}:${targetPort ?? (form.targetPort || '—')}`;
  const bindExposed = form.bindHost.trim() === '0.0.0.0';

  const handleSubmit = async () => {
    if (busyRef.current) return;
    const nextErrors = validate(form, hosts);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const bindValue = parsePort(form.bindPort, form.type === 'remote') as number;
    const targetValue = form.type === 'dynamic' ? null : (parsePort(form.targetPort, false) as number);
    const input: TunnelInput = {
      name: form.name.trim(),
      hostId: form.hostId,
      type: form.type,
      bindHost: form.bindHost.trim(),
      bindPort: bindValue,
      autoStart: form.autoStart
    };
    if (form.type !== 'dynamic' && targetValue !== null) {
      input.targetHost = form.targetHost.trim();
      input.targetPort = targetValue;
    }

    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit(input);
      onDismiss();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => (!data.open && !busy ? onDismiss() : undefined)}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle className={styles.title}>
            <ArrowRoutingRegular />
            {editing ? `编辑隧道 · ${editing.name}` : '新建 SSH 隧道'}
          </DialogTitle>
          <DialogContent>
            <div className={styles.content}>
              <Field
                label="隧道名称"
                required
                validationMessage={errors.name}
                validationState={errors.name ? 'error' : 'none'}
              >
                <Input
                  value={form.name}
                  onChange={(_, data) => update('name', data.value)}
                  placeholder="例如：内网数据库 / GitHub 代理"
                  data-testid="tunnel-name"
                  disabled={busy}
                />
              </Field>

              <Field label="转发类型" required>
                <div className={styles.typeRow} role="radiogroup" aria-label="隧道类型">
                  {(['local', 'remote', 'dynamic'] as TunnelType[]).map((type) => {
                    const selected = form.type === type;
                    const icon = type === 'local' ? <DesktopMacRegular /> : type === 'remote' ? <ServerRegular /> : <GlobeRegular />;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={mergeClasses(styles.typeCard, selected && styles.typeCardSelected)}
                        onClick={() => changeType(type)}
                        disabled={busy}
                        data-testid={`tunnel-type-${type}`}
                      >
                        <span className={styles.typeIcon}>{icon}</span>
                        <span className={styles.typeText}>
                          <span className={styles.typeTitle}>{TUNNEL_TYPE_LABELS[type]}</span>
                          <span className={styles.typeDesc}>{TUNNEL_TYPE_HINTS[type]}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {hosts.length === 0 ? (
                <div className={styles.noHosts}>
                  <InfoRegular />
                  <span className="grow">至少需要一台 SSH 主机才能创建隧道。</span>
                  <Button size="small" appearance="secondary" onClick={onManageHosts}>
                    去添加主机
                  </Button>
                </div>
              ) : (
                <Field
                  label="SSH 主机"
                  required
                  validationMessage={errors.hostId}
                  validationState={errors.hostId ? 'error' : 'none'}
                  hint="隧道通过该主机的 SSH 连接建立。"
                >
                  <Dropdown
                    value={selectedHost ? `${selectedHost.name} · ${selectedHost.username}@${selectedHost.hostname}:${selectedHost.port}` : ''}
                    selectedOptions={form.hostId ? [form.hostId] : []}
                    onOptionSelect={(_, data) => {
                      if (data.optionValue) update('hostId', data.optionValue);
                    }}
                    placeholder="选择一台 SSH 主机"
                    disabled={busy}
                    data-testid="tunnel-host"
                  >
                    {hosts.map((host) => (
                      <Option key={host.id} value={host.id} text={`${host.name} · ${host.username}@${host.hostname}:${host.port}`}>
                        <span className={styles.hostOption}>
                          <span>{host.name}</span>
                          <span className={styles.hint}>
                            {host.username}@{host.hostname}:{host.port}
                          </span>
                        </span>
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}

              <div className={styles.grid2}>
                <Field
                  label={form.type === 'remote' ? '远端绑定地址' : '本地绑定地址'}
                  validationMessage={errors.bindHost}
                  validationState={errors.bindHost ? 'error' : 'none'}
                  hint={
                    bindExposed ? (
                      <span className={styles.warnHint}>绑定 0.0.0.0 会暴露给所有网卡，请确认可信网络。</span>
                    ) : (
                      '通常使用 127.0.0.1。'
                    )
                  }
                >
                  <Input
                    value={form.bindHost}
                    onChange={(_, data) => update('bindHost', data.value)}
                    placeholder="127.0.0.1"
                    className={styles.mono}
                    data-testid="tunnel-bind-host"
                    disabled={busy}
                  />
                </Field>
                <Field
                  label="绑定端口"
                  required
                  validationMessage={errors.bindPort}
                  validationState={errors.bindPort ? 'error' : 'none'}
                  hint={form.type === 'remote' ? '0 表示由远端服务器自动分配。' : '1–65535。'}
                >
                  <Input
                    value={form.bindPort}
                    onChange={(_, data) => update('bindPort', data.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                    placeholder={form.type === 'dynamic' ? '1080' : '8080'}
                    className={styles.mono}
                    data-testid="tunnel-bind-port"
                    disabled={busy}
                  />
                </Field>
              </div>

              {form.type !== 'dynamic' && (
                <div className={styles.grid2}>
                  <Field
                    label={form.type === 'remote' ? '本机目标地址' : '目标地址'}
                    required
                    validationMessage={errors.targetHost}
                    validationState={errors.targetHost ? 'error' : 'none'}
                  >
                    <Input
                      value={form.targetHost}
                      onChange={(_, data) => update('targetHost', data.value)}
                      placeholder="10.0.0.12"
                      className={styles.mono}
                      data-testid="tunnel-target-host"
                      disabled={busy}
                    />
                  </Field>
                  <Field
                    label="目标端口"
                    required
                    validationMessage={errors.targetPort}
                    validationState={errors.targetPort ? 'error' : 'none'}
                  >
                    <Input
                      value={form.targetPort}
                      onChange={(_, data) => update('targetPort', data.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder="5432"
                      className={styles.mono}
                      data-testid="tunnel-target-port"
                      disabled={busy}
                    />
                  </Field>
                </div>
              )}

              <Field label="自动启动" hint="服务启动且主机凭据可用时自动建立隧道。">
                <Switch
                  checked={form.autoStart}
                  onChange={(_, data) => update('autoStart', data.checked)}
                  label={form.autoStart ? '已启用自动启动' : '手动启动'}
                  data-testid="tunnel-autostart"
                  disabled={busy}
                />
              </Field>

              <div className={styles.preview}>
                <div className={styles.previewTitle}>
                  <PlugConnectedRegular /> 转发预览
                </div>
                <div className={styles.previewRoute}>
                  <span className={styles.endpoint}>{form.type === 'dynamic' ? `SOCKS5 ${previewFrom}` : previewFrom}</span>
                  {previewTo ? (
                    <>
                      <ArrowRightRegular />
                      <span className={mergeClasses(styles.endpoint, styles.endpointTarget)}>{previewTo}</span>
                    </>
                  ) : null}
                  {selectedHost && (
                    <span className={styles.hostChip}>
                      <ServerRegular /> {selectedHost.name}
                    </span>
                  )}
                </div>
                <div className={styles.previewHint}>
                  {form.type === 'local' && `本机 ${previewFrom} 的流量将经 ${selectedHost?.name ?? '所选主机'} 转发到 ${previewTo ?? '目标'}。`}
                  {form.type === 'remote' && `远端 ${previewFrom} 将转发到本机可访问的 ${previewTo ?? '目标'}。`}
                  {form.type === 'dynamic' && `本机 ${previewFrom} 将作为 SOCKS5 代理，流量按需经 ${selectedHost?.name ?? '所选主机'} 转发。`}
                </div>
              </div>

              {submitError && (
                <MessageBar intent="error" className={styles.error}>
                  <MessageBarBody>{submitError}</MessageBarBody>
                </MessageBar>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onDismiss} disabled={busy}>
              取消
            </Button>
            <Tooltip content={hosts.length === 0 ? '请先添加 SSH 主机' : '保存隧道配置'} relationship="label">
              <Button
                appearance="primary"
                onClick={() => void handleSubmit()}
                disabled={busy || hosts.length === 0}
                icon={busy ? <Spinner size="tiny" /> : undefined}
                data-testid="tunnel-submit"
              >
                {editing ? '保存修改' : '创建隧道'}
              </Button>
            </Tooltip>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
