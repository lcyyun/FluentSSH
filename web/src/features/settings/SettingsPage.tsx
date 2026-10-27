import {
  Badge,
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
  Option,
  Spinner,
  Switch,
  makeStyles,
  mergeClasses,
  tokens
} from '@fluentui/react-components';
import {
  ArrowResetRegular,
  CheckmarkCircleRegular,
  DataUsageRegular,
  DeleteRegular,
  DesktopMacRegular,
  FolderOpenRegular,
  KeyRegular,
  LockClosedRegular,
  LockOpenRegular,
  PaintBrushRegular,
  PasswordRegular,
  SettingsRegular,
  ShieldKeyholeRegular,
  WindowConsoleRegular
} from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import type { AccentName, ThemeMode } from '@shared/types';
import { api, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SectionCard } from '../../components/SectionCard';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/StatusPill';
import { useAppStore, type AppView } from '../../store/app';
import { ACCENT_LABELS, ACCENT_SWATCH, useEffectiveMode } from '../../theme';

const useStyles = makeStyles({
  layout: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '14px', alignItems: 'start' },
  full: { gridColumn: '1 / -1' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '18px',
    padding: '10px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ':last-child': { borderBottom: 'none', paddingBottom: 0 },
    ':first-child': { paddingTop: 0 }
  },
  rowText: { minWidth: 0, flex: 1 },
  rowTitle: { fontSize: '13px', fontWeight: 500, color: tokens.colorNeutralForeground1 },
  rowDesc: { fontSize: '11.5px', color: tokens.colorNeutralForeground3, marginTop: '2px', lineHeight: 1.5 },
  rowControl: { flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' },
  themeGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '8px' },
  themeCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '9px',
    padding: '9px',
    cursor: 'pointer',
    background: tokens.colorNeutralBackground1,
    position: 'relative',
    ':hover': { border: `1px solid ${tokens.colorNeutralStroke1}` }
  },
  themeCardActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    boxShadow: `0 0 0 1px ${tokens.colorBrandStroke2}`
  },
  themePreview: {
    height: '46px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke3}`,
    overflow: 'hidden',
    display: 'flex',
    marginBottom: '7px'
  },
  themeSideLight: { width: '26%', background: '#eef2f8' },
  themeMainLight: { flex: 1, background: 'linear-gradient(180deg,#ffffff,#f4f7fc)' },
  themeSideDark: { width: '26%', background: '#0d121a' },
  themeMainDark: { flex: 1, background: 'linear-gradient(180deg,#161d27,#0c1119)' },
  themeSideSystem: { width: '26%', background: 'linear-gradient(180deg,#eef2f8 50%,#0d121a 50%)' },
  themeMainSystem: { flex: 1, background: 'linear-gradient(180deg,#ffffff 50%,#161d27 50%)' },
  themeLabel: { fontSize: '11.5px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '5px' },
  swatches: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  swatch: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    cursor: 'pointer',
    border: `2px solid ${tokens.colorNeutralBackground1}`,
    boxShadow: `0 0 0 1px ${tokens.colorNeutralStroke2}`,
    padding: 0
  },
  swatchActive: { boxShadow: `0 0 0 2px ${tokens.colorBrandStroke1}` },
  terminalPreview: {
    marginTop: '10px',
    background: '#0c1119',
    color: '#d7e0ee',
    borderRadius: '8px',
    padding: '10px 12px',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '12px',
    lineHeight: 1.5,
    border: `1px solid ${tokens.colorNeutralStroke2}`
  },
  prompt: { color: '#7dd3a7' },
  cursor: { color: '#d7e0ee', animation: 'blink 1s step-end infinite' },
  infoGrid: { display: 'grid', gridTemplateColumns: '130px 1fr', gap: '8px 14px', fontSize: '12px' },
  infoLabel: { color: tokens.colorNeutralForeground3 },
  infoValue: { color: tokens.colorNeutralForeground1, fontFamily: tokens.fontFamilyMonospace, wordBreak: 'break-all' },
  vaultPanel: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    borderRadius: '9px',
    background: tokens.colorNeutralBackground3,
    marginBottom: '6px'
  },
  vaultIcon: {
    width: '36px',
    height: '36px',
    borderRadius: '9px',
    display: 'grid',
    placeItems: 'center',
    fontSize: '18px',
    color: tokens.colorBrandForeground1,
    background: tokens.colorBrandBackground2
  },
  vaultIconLocked: {
    color: tokens.colorPaletteRedForeground1,
    background: tokens.colorPaletteRedBackground2
  },
  error: { color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '8px' },
  hint: { fontSize: '11.5px', color: tokens.colorNeutralForeground3, lineHeight: 1.55 }
});

const THEMES: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
];

export default function SettingsPage() {
  const styles = useStyles();
  const settings = useAppStore((state) => state.settings);
  const info = useAppStore((state) => state.info);
  const vault = useAppStore((state) => state.vault);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const lockVault = useAppStore((state) => state.lockVault);
  const setVault = useAppStore((state) => state.setVault);
  const notify = useAppStore((state) => state.notify);
  const setView = useAppStore((state) => state.setView);
  const effectiveMode = useEffectiveMode(settings?.theme ?? 'light');
  const [vaultDialog, setVaultDialog] = useState<'protect' | 'change' | 'remove' | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [clearAuditConfirm, setClearAuditConfirm] = useState(false);
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);

  if (!settings) return null;

  const security = settings.security;
  const terminal = settings.terminal;

  return (
    <div className="view-scroll">
      <div className="page">
        <PageHeader
          eyebrow="Preferences"
          title="设置"
          subtitle="外观、终端、安全与连接默认值会立即生效并保存在本地。"
          actions={
            <Button appearance="secondary" icon={<ArrowResetRegular />} onClick={() => setResetConfirm(true)}>
              恢复默认
            </Button>
          }
        />

        <div className={styles.layout}>
          <SectionCard title={<><PaintBrushRegular /> 外观</>} subtitle="Fluent 主题与界面密度">
            <div className={styles.themeGrid}>
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  className={mergeClasses(styles.themeCard, settings.theme === theme.value && styles.themeCardActive)}
                  onClick={() => void updateSettings({ theme: theme.value })}
                >
                  <div className={styles.themePreview}>
                    <div
                      className={
                        theme.value === 'dark'
                          ? styles.themeSideDark
                          : theme.value === 'system'
                            ? styles.themeSideSystem
                            : styles.themeSideLight
                      }
                    />
                    <div
                      className={
                        theme.value === 'dark'
                          ? styles.themeMainDark
                          : theme.value === 'system'
                            ? styles.themeMainSystem
                            : styles.themeMainLight
                      }
                    />
                  </div>
                  <div className={styles.themeLabel}>
                    {theme.label}
                    {settings.theme === theme.value && <CheckmarkCircleRegular style={{ color: tokens.colorBrandForeground1 }} />}
                  </div>
                </button>
              ))}
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>强调色</div>
                <div className={styles.rowDesc}>应用于按钮、选中状态与链接</div>
              </div>
              <div className={styles.swatches}>
                {(Object.keys(ACCENT_SWATCH) as AccentName[]).map((accent) => (
                  <button
                    type="button"
                    key={accent}
                    title={ACCENT_LABELS[accent]}
                    className={mergeClasses(styles.swatch, settings.accent === accent && styles.swatchActive)}
                    style={{ background: ACCENT_SWATCH[accent] }}
                    onClick={() => void updateSettings({ accent })}
                    aria-label={ACCENT_LABELS[accent]}
                  />
                ))}
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>减少动画</div>
                <div className={styles.rowDesc}>关闭界面过渡与入场动画</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={settings.reduceMotion} onChange={(_, data) => void updateSettings({ reduceMotion: data.checked })} />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>紧凑模式</div>
                <div className={styles.rowDesc}>缩小列表与工具栏的垂直间距</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={settings.compactMode} onChange={(_, data) => void updateSettings({ compactMode: data.checked })} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title={<><WindowConsoleRegular /> 终端</>} subtitle="xterm.js 渲染参数，应用于所有会话">
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>字体</div>
                <div className={styles.rowDesc}>支持 Cascadia Code、JetBrains Mono 等本地字体</div>
              </div>
              <div className={styles.rowControl} style={{ width: 240 }}>
                <Input
                  value={terminal.fontFamily}
                  onChange={(_, data) => void updateSettings({ terminal: { fontFamily: data.value } })}
                  size="small"
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>字号</div>
                <div className={styles.rowDesc}>{terminal.fontSize}px</div>
              </div>
              <div className={styles.rowControl}>
                <Button size="small" appearance="secondary" onClick={() => void updateSettings({ terminal: { fontSize: Math.max(9, terminal.fontSize - 1) } })}>
                  A-
                </Button>
                <Button size="small" appearance="secondary" onClick={() => void updateSettings({ terminal: { fontSize: Math.min(32, terminal.fontSize + 1) } })}>
                  A+
                </Button>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>光标</div>
                <div className={styles.rowDesc}>形状与闪烁</div>
              </div>
              <div className={styles.rowControl}>
                <Dropdown
                  value={terminal.cursorStyle === 'bar' ? '竖线' : terminal.cursorStyle === 'underline' ? '下划线' : '方块'}
                  selectedOptions={[terminal.cursorStyle]}
                  onOptionSelect={(_, data) =>
                    void updateSettings({ terminal: { cursorStyle: data.optionValue as 'bar' | 'underline' | 'block' } })
                  }
                >
                  <Option value="bar">竖线</Option>
                  <Option value="underline">下划线</Option>
                  <Option value="block">方块</Option>
                </Dropdown>
                <Switch checked={terminal.cursorBlink} onChange={(_, data) => void updateSettings({ terminal: { cursorBlink: data.checked } })} label="闪烁" />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>回滚缓冲</div>
                <div className={styles.rowDesc}>{terminal.scrollback.toLocaleString()} 行</div>
              </div>
              <div className={styles.rowControl}>
                <Dropdown
                  value={`${terminal.scrollback / 1000}K`}
                  selectedOptions={[String(terminal.scrollback)]}
                  onOptionSelect={(_, data) => void updateSettings({ terminal: { scrollback: Number(data.optionValue) } })}
                >
                  {[2000, 5000, 10000, 20000, 50000].map((value) => (
                    <Option key={value} value={String(value)} text={`${value / 1000}K 行`}>
                      {`${value / 1000}K 行`}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>终端提示音</div>
                <div className={styles.rowDesc}>收到 BEL 时发出提示</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={terminal.bell} onChange={(_, data) => void updateSettings({ terminal: { bell: data.checked } })} />
              </div>
            </div>
            <div className={styles.terminalPreview}>
              <div>
                <span className={styles.prompt}>demo@server</span>:<span style={{ color: '#7cb7ff' }}>~</span>$ echo &quot;Hello, FluentSSH&quot;
              </div>
              <div>Hello, FluentSSH</div>
              <div>
                <span className={styles.prompt}>demo@server</span>:<span style={{ color: '#7cb7ff' }}>~</span>${' '}
                <span className={styles.cursor}>▌</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={<><ShieldKeyholeRegular /> 安全</>} subtitle="保险库、主机密钥与审计">
            <div className={styles.vaultPanel}>
              <div className={mergeClasses(styles.vaultIcon, vault && !vault.unlocked ? styles.vaultIconLocked : undefined)}>
                {vault?.unlocked ? <LockOpenRegular /> : <LockClosedRegular />}
              </div>
              <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>凭据保险库</strong>
                  {vault?.protected ? (
                    <StatusPill tone={vault.unlocked ? 'success' : 'danger'} dot>
                      {vault.unlocked ? '主密码保护 · 已解锁' : '已锁定'}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="warning" dot>
                      未设置主密码
                    </StatusPill>
                  )}
                </div>
                <div className={styles.hint} style={{ marginTop: 3 }}>
                  密码、私钥与私钥口令使用 AES-256-GCM 加密存储；设置主密码后，数据密钥会再用 scrypt 派生的密钥包裹。
                </div>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>主密码</div>
                <div className={styles.rowDesc}>
                  {vault?.protected ? '更换主密码会重新包裹数据密钥；移除后将退回到本地密钥保护。' : '为保险库添加主密码，启动或锁定时需要输入。'}
                </div>
              </div>
              <div className={styles.rowControl}>
                {vault?.protected ? (
                  <>
                    <Button size="small" appearance="secondary" icon={<KeyRegular />} onClick={() => setVaultDialog('change')}>
                      更换
                    </Button>
                    <Button size="small" appearance="secondary" icon={<LockClosedRegular />} onClick={() => setVaultDialog('remove')}>
                      移除
                    </Button>
                    <Button size="small" appearance="primary" icon={<PasswordRegular />} onClick={() => void lockVault()} disabled={!vault.unlocked}>
                      立即锁定
                    </Button>
                  </>
                ) : (
                  <Button size="small" appearance="primary" icon={<PasswordRegular />} onClick={() => setVaultDialog('protect')}>
                    设置主密码
                  </Button>
                )}
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>自动锁定</div>
                <div className={styles.rowDesc}>超过指定时间无操作后锁定保险库（不影响已建立会话）</div>
              </div>
              <div className={styles.rowControl}>
                <Dropdown
                  value={security.autoLockMinutes === 0 ? '从不' : `${security.autoLockMinutes} 分钟`}
                  selectedOptions={[String(security.autoLockMinutes)]}
                  onOptionSelect={(_, data) => void updateSettings({ security: { autoLockMinutes: Number(data.optionValue) } })}
                >
                  <Option value="0">从不</Option>
                  {[1, 5, 10, 15, 30, 60, 120].map((value) => (
                    <Option key={value} value={String(value)} text={`${value} 分钟`}>
                      {`${value} 分钟`}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>严格主机密钥校验</div>
                <div className={styles.rowDesc}>未知主机密钥必须手动信任；建议保持开启</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={security.strictHostKeys} onChange={(_, data) => void updateSettings({ security: { strictHostKeys: data.checked } })} />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>记录终端输出</div>
                <div className={styles.rowDesc}>在本地 logs 目录保存会话记录，可在日志页下载</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={security.recordSessions} onChange={(_, data) => void updateSettings({ security: { recordSessions: data.checked } })} />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>管理密钥与 Known Hosts</div>
                <div className={styles.rowDesc}>SSH 密钥、受信任指纹与导入导出</div>
              </div>
              <div className={styles.rowControl}>
                <Button size="small" appearance="secondary" icon={<ShieldKeyholeRegular />} onClick={() => setView('security')}>
                  打开
                </Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={<><DesktopMacRegular /> 连接</>} subtitle="新主机的默认连接参数">
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>默认用户名</div>
                <div className={styles.rowDesc}>新建主机与快速连接时预填</div>
              </div>
              <div className={styles.rowControl} style={{ width: 160 }}>
                <Input
                  size="small"
                  value={settings.connections.defaultUsername}
                  onChange={(_, data) => void updateSettings({ connections: { defaultUsername: data.value } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>默认端口</div>
                <div className={styles.rowDesc}>通常为 22</div>
              </div>
              <div className={styles.rowControl} style={{ width: 100 }}>
                <Input
                  size="small"
                  type="number"
                  value={String(settings.connections.defaultPort)}
                  onChange={(_, data) => void updateSettings({ connections: { defaultPort: Number(data.value) || 22 } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>Keepalive 间隔</div>
                <div className={styles.rowDesc}>毫秒，0 表示禁用；防止空闲连接被中断</div>
              </div>
              <div className={styles.rowControl} style={{ width: 140 }}>
                <Input
                  size="small"
                  type="number"
                  value={String(settings.connections.keepaliveInterval)}
                  onChange={(_, data) => void updateSettings({ connections: { keepaliveInterval: Number(data.value) || 0 } })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>连接超时</div>
                <div className={styles.rowDesc}>毫秒</div>
              </div>
              <div className={styles.rowControl} style={{ width: 140 }}>
                <Input
                  size="small"
                  type="number"
                  value={String(settings.connections.connectTimeout)}
                  onChange={(_, data) => void updateSettings({ connections: { connectTimeout: Number(data.value) || 20000 } })}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard title={<><FolderOpenRegular /> 文件</>} subtitle="SFTP 文件管理器行为">
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>显示隐藏文件</div>
                <div className={styles.rowDesc}>显示以 . 开头的文件与目录</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={settings.files.showHidden} onChange={(_, data) => void updateSettings({ files: { showHidden: data.checked } })} />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>删除前确认</div>
                <div className={styles.rowDesc}>删除远程文件与目录时弹出确认</div>
              </div>
              <div className={styles.rowControl}>
                <Switch checked={settings.files.confirmDelete} onChange={(_, data) => void updateSettings({ files: { confirmDelete: data.checked } })} />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>编辑器字号</div>
                <div className={styles.rowDesc}>{settings.files.editorFontSize}px</div>
              </div>
              <div className={styles.rowControl} style={{ width: 120 }}>
                <Input
                  size="small"
                  type="number"
                  value={String(settings.files.editorFontSize)}
                  onChange={(_, data) => void updateSettings({ files: { editorFontSize: Number(data.value) || 13 } })}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard title={<><DataUsageRegular /> 数据与关于</>} subtitle="本地服务信息与数据维护" className={styles.full}>
            <div className={styles.infoGrid}>
              <span className={styles.infoLabel}>应用版本</span>
              <span className={styles.infoValue}>{info?.name} {info?.version}</span>
              <span className={styles.infoLabel}>运行环境</span>
              <span className={styles.infoValue}>Node {info?.nodeVersion} · {info?.platform}</span>
              <span className={styles.infoLabel}>数据目录</span>
              <span className={styles.infoValue}>{info?.dataDir}</span>
              <span className={styles.infoLabel}>界面主题</span>
              <span className={styles.infoValue}>{settings.theme === 'system' ? `跟随系统（当前 ${effectiveMode === 'dark' ? '深色' : '浅色'}）` : settings.theme === 'dark' ? '深色' : '浅色'}</span>
            </div>
            <div className={styles.row} style={{ marginTop: 10 }}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>命令历史</div>
                <div className={styles.rowDesc}>清除已记录的一次性命令执行结果</div>
              </div>
              <div className={styles.rowControl}>
                <Button size="small" appearance="secondary" icon={<DeleteRegular />} onClick={() => setClearHistoryConfirm(true)}>
                  清除
                </Button>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>审计日志</div>
                <div className={styles.rowDesc}>清除连接、安全与传输事件记录</div>
              </div>
              <div className={styles.rowControl}>
                <Button size="small" appearance="secondary" icon={<DeleteRegular />} onClick={() => setClearAuditConfirm(true)}>
                  清除
                </Button>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>恢复默认设置</div>
                <div className={styles.rowDesc}>仅重置偏好设置，不会删除主机、密钥或日志</div>
              </div>
              <div className={styles.rowControl}>
                <Button size="small" appearance="secondary" icon={<ArrowResetRegular />} onClick={() => setResetConfirm(true)}>
                  恢复默认
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>

      <VaultSecurityDialog
        mode={vaultDialog}
        onClose={() => setVaultDialog(null)}
        onDone={(status) => {
          setVault(status);
          setVaultDialog(null);
        }}
      />
      <ConfirmDialog
        open={resetConfirm}
        title="恢复默认设置"
        message="所有外观、终端、连接与安全偏好将恢复默认值。主机、密钥、日志和保险库中的凭据不会被删除。"
        confirmLabel="恢复默认"
        onCancel={() => setResetConfirm(false)}
        onConfirm={async () => {
          const { settings: next } = await api.settings.reset();
          useAppStore.setState({ settings: next });
          notify('success', '已恢复默认设置');
          setResetConfirm(false);
        }}
      />
      <ConfirmDialog
        open={clearAuditConfirm}
        title="清除审计日志"
        message="此操作会删除所有连接、安全与传输事件记录，无法撤销。"
        confirmLabel="清除"
        danger
        onCancel={() => setClearAuditConfirm(false)}
        onConfirm={async () => {
          await api.audit.clear();
          notify('success', '审计日志已清除');
          setClearAuditConfirm(false);
        }}
      />
      <ConfirmDialog
        open={clearHistoryConfirm}
        title="清除命令历史"
        message="此操作会删除所有一次性命令的执行记录。"
        confirmLabel="清除"
        danger
        onCancel={() => setClearHistoryConfirm(false)}
        onConfirm={async () => {
          await api.commands.clearHistory();
          notify('success', '命令历史已清除');
          setClearHistoryConfirm(false);
        }}
      />
    </div>
  );
}

function VaultSecurityDialog({
  mode,
  onClose,
  onDone
}: {
  mode: 'protect' | 'change' | 'remove' | null;
  onClose: () => void;
  onDone: (status: NonNullable<ReturnType<typeof useAppStore.getState>['vault']>) => void;
}) {
  const styles = useStyles();
  const notify = useAppStore((state) => state.notify);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setBusy(false);
  }, [mode]);

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      if (mode === 'remove') {
        const { status } = await api.vault.unprotect(current);
        notify('warning', '已移除保险库主密码', '凭据仍使用本地密钥加密。');
        onDone(status);
        return;
      }
      if (next.length < 6) throw new Error('主密码至少需要 6 个字符。');
      if (next !== confirm) throw new Error('两次输入的主密码不一致。');
      if (mode === 'change') {
        await api.vault.unprotect(current);
        const { status } = await api.vault.protect(next);
        notify('success', '主密码已更新');
        onDone(status);
      } else {
        const { status } = await api.vault.protect(next);
        notify('success', '主密码已设置', '下次锁定后需要输入主密码解锁。');
        onDone(status);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'remove' ? '移除保险库主密码' : mode === 'change' ? '更换主密码' : '设置主密码';
  return (
    <Dialog open={Boolean(mode)} onOpenChange={(_, data) => (!data.open ? onClose() : undefined)}>
      <DialogSurface style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}>
        <DialogBody>
          <DialogTitle>
            <div className="row">
              <LockClosedRegular />
              {title}
            </div>
          </DialogTitle>
          <DialogContent>
            <div className={styles.hint} style={{ marginBottom: 12 }}>
              {mode === 'remove'
                ? '移除后，凭据改由本机 keyring 文件中的随机密钥保护，无需再输入主密码。'
                : '主密码用于包裹本地数据密钥。请妥善保存；忘记主密码将无法恢复已保存的凭据。'}
            </div>
            <div className="stack" style={{ gap: 12 }}>
              {mode !== 'protect' && (
                <Field label="当前主密码">
                  <Input autoFocus type="password" value={current} onChange={(_, data) => setCurrent(data.value)} />
                </Field>
              )}
              {mode !== 'remove' && (
                <>
                  <Field label="新主密码" hint="至少 6 个字符">
                    <Input type="password" value={next} onChange={(_, data) => setNext(data.value)} />
                  </Field>
                  <Field label="确认新主密码">
                    <Input type="password" value={confirm} onChange={(_, data) => setConfirm(data.value)} />
                  </Field>
                </>
              )}
              {error && <div className={styles.error}>{error}</div>}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button appearance="primary" onClick={() => void submit()} disabled={busy} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {mode === 'remove' ? '移除' : '确认'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export type { AppView };
