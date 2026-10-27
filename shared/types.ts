/**
 * FluentSSH shared domain types.
 * This file is the single source of truth for the client/server contract.
 * Owned by the Lead — coordinate before changing.
 */

export type Id = string;
export type ISODate = string;

/* ------------------------------------------------------------------ */
/* Hosts                                                               */
/* ------------------------------------------------------------------ */

export type AuthType = 'password' | 'key' | 'agent' | 'keyboard-interactive';

export interface HostTerminalPrefs {
  term?: string;
  /** Per-host font size override (px) */
  fontSize?: number;
  /** Per-host color scheme id */
  colorScheme?: string;
  encoding?: string;
}

export interface HostProfile {
  id: Id;
  name: string;
  hostname: string;
  port: number;
  username: string;
  groupId: Id | null;
  tags: string[];
  favorite: boolean;
  color: string;
  authType: AuthType;
  keyId: Id | null;
  /** Secret presence flags — secrets are never returned to the browser. */
  hasPassword: boolean;
  hasPassphrase: boolean;
  proxyJumpId: Id | null;
  terminal: HostTerminalPrefs;
  startupCommand: string;
  env: Record<string, string>;
  keepaliveInterval: number;
  connectTimeout: number;
  compression: boolean;
  legacyAlgorithms: boolean;
  defaultPath: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
  connectCount: number;
}

export interface HostInput {
  name: string;
  hostname: string;
  port?: number;
  username: string;
  groupId?: Id | null;
  tags?: string[];
  favorite?: boolean;
  color?: string;
  authType?: AuthType;
  keyId?: Id | null;
  /** Write-only secrets */
  password?: string;
  passphrase?: string;
  proxyJumpId?: Id | null;
  terminal?: HostTerminalPrefs;
  startupCommand?: string;
  env?: Record<string, string>;
  keepaliveInterval?: number;
  connectTimeout?: number;
  compression?: boolean;
  legacyAlgorithms?: boolean;
  defaultPath?: string;
  notes?: string;
}

export interface HostGroup {
  id: Id;
  name: string;
  color: string;
  parentId: Id | null;
  createdAt: number;
}

/** Ad-hoc connection target used by quick connect / command runner. */
export interface InlineConnection {
  hostname: string;
  port?: number;
  username: string;
  authType?: AuthType;
  password?: string;
  keyId?: Id | null;
  passphrase?: string;
  name?: string;
  proxyJumpId?: Id | null;
  connectTimeout?: number;
  keepaliveInterval?: number;
}

/* ------------------------------------------------------------------ */
/* SSH keys / known hosts                                             */
/* ------------------------------------------------------------------ */

export type KeyAlgorithm = 'ed25519' | 'rsa' | 'ecdsa';

export interface SshKeyMeta {
  id: Id;
  name: string;
  algorithm: KeyAlgorithm;
  bits: number;
  publicKey: string;
  fingerprint: string;
  comment: string;
  hasPassphrase: boolean;
  isGenerated: boolean;
  createdAt: number;
}

export interface KeyGenerateInput {
  name: string;
  algorithm?: KeyAlgorithm;
  bits?: number;
  comment?: string;
  passphrase?: string;
}

export interface KeyImportInput {
  name: string;
  privateKey: string;
  passphrase?: string;
  comment?: string;
}

export interface KnownHost {
  id: Id;
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  addedAt: number;
  lastSeenAt: number;
  source: 'manual' | 'trusted' | 'import';
}

export interface TrustHostKeyInput {
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export type SessionKind = 'terminal' | 'sftp';
export type SessionState = 'connecting' | 'awaiting-auth' | 'connected' | 'disconnected' | 'closed' | 'error';

export interface SessionStats {
  bytesIn: number;
  bytesOut: number;
  connectedAt: number | null;
  latencyMs: number | null;
}

export interface SessionInfo {
  id: Id;
  kind: SessionKind;
  hostId: Id | null;
  hostName: string;
  hostname: string;
  port: number;
  username: string;
  title: string;
  state: SessionState;
  createdAt: number;
  connectedAt: number | null;
  closedAt: number | null;
  lastError: string | null;
  errorCode: string | null;
  errorDetails: Record<string, unknown> | null;
  cols: number;
  rows: number;
  term: string;
  stats: SessionStats;
  /** Server-side host key fingerprint used for this session. */
  hostKeyFingerprint: string | null;
}

export interface CreateTerminalSessionInput {
  hostId?: Id;
  inline?: InlineConnection;
  cols?: number;
  rows?: number;
  title?: string;
  /** Optional command to type into the shell after it opens. */
  initialCommand?: string;
}

export interface CreateSftpSessionInput {
  hostId?: Id;
  inline?: InlineConnection;
  initialPath?: string;
  title?: string;
}

/* ------------------------------------------------------------------ */
/* Auth prompts (keyboard-interactive)                                 */
/* ------------------------------------------------------------------ */

export interface AuthPromptField {
  prompt: string;
  echo: boolean;
}

export interface AuthPrompt {
  requestId: Id;
  operation: 'session' | 'exec' | 'tunnel';
  sessionId: Id | null;
  hostLabel: string;
  name: string;
  instructions: string;
  prompts: AuthPromptField[];
  createdAt: number;
  expiresAt: number;
}

export interface RespondAuthPromptInput {
  responses: string[];
}

/* ------------------------------------------------------------------ */
/* Terminal WebSocket protocol                                         */
/* ------------------------------------------------------------------ */

export type TerminalClientMessage =
  | { type: 'input'; data: string } // base64 utf-8 bytes
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }
  | { type: 'close' };

export type TerminalServerMessage =
  | { type: 'backlog'; data: string }
  | { type: 'output'; data: string }
  | { type: 'state'; state: SessionState; message?: string; errorCode?: string; errorDetails?: Record<string, unknown> }
  | { type: 'exit'; code?: number; signal?: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }
  | { type: 'title'; title: string };

/* ------------------------------------------------------------------ */
/* SFTP                                                                */
/* ------------------------------------------------------------------ */

export interface SftpEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  mode: number;
  permissions: string;
  uid: number;
  gid: number;
  atime: number;
  mtime: number;
  isSymlink: boolean;
  linkTarget: string | null;
  owner?: string;
  group?: string;
}

export interface SftpListResult {
  path: string;
  entries: SftpEntry[];
  total: number;
}

export interface SftpReadResult {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  size: number;
  truncated: boolean;
  binary: boolean;
}

export interface SftpSearchResult {
  entries: SftpEntry[];
  scanned: number;
  truncated: boolean;
}

/* ------------------------------------------------------------------ */
/* Transfers (client-driven)                                           */
/* ------------------------------------------------------------------ */

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'queued' | 'running' | 'completed' | 'error' | 'cancelled';

export interface TransferItem {
  id: Id;
  direction: TransferDirection;
  sessionId: Id | null;
  hostLabel: string;
  localName: string;
  remotePath: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  speedBps: number;
}

/* ------------------------------------------------------------------ */
/* Tunnels                                                             */
/* ------------------------------------------------------------------ */

export type TunnelType = 'local' | 'remote' | 'dynamic';
export type TunnelStatus = 'stopped' | 'starting' | 'active' | 'error';

export interface TunnelConfig {
  id: Id;
  name: string;
  hostId: Id;
  type: TunnelType;
  bindHost: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
  autoStart: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TunnelInfo extends TunnelConfig {
  status: TunnelStatus;
  error: string | null;
  /** Structured error code of the last failed start/stop. Never contains secrets. */
  errorCode?: string | null;
  /** Structured details for HOST_KEY_* errors: { hostname, port, keyType, fingerprint, expectedFingerprint? }. */
  errorDetails?: Record<string, unknown> | null;
  connections: number;
  bytesIn: number;
  bytesOut: number;
  startedAt: number | null;
  hostName: string;
}

export interface TunnelInput {
  name: string;
  hostId: Id;
  type: TunnelType;
  bindHost?: string;
  bindPort: number;
  targetHost?: string;
  targetPort?: number;
  autoStart?: boolean;
}

/* ------------------------------------------------------------------ */
/* Commands & snippets                                                 */
/* ------------------------------------------------------------------ */

export interface ExecInput {
  hostId?: Id;
  inline?: InlineConnection;
  command: string;
  timeoutMs?: number;
}

export interface ExecResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  startedAt: number;
  durationMs: number;
  truncated: boolean;
  hostLabel: string;
}

export interface CommandHistoryEntry extends ExecResult {
  id: Id;
  hostId: Id | null;
}

export interface Snippet {
  id: Id;
  name: string;
  command: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  name: string;
  command: string;
  description?: string;
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/* Audit & logs                                                        */
/* ------------------------------------------------------------------ */

export type AuditCategory = 'connection' | 'sftp' | 'tunnel' | 'command' | 'vault' | 'security' | 'system';
export type AuditLevel = 'info' | 'warn' | 'error';

export interface AuditEvent {
  id: Id;
  at: number;
  level: AuditLevel;
  category: AuditCategory;
  message: string;
  hostId: Id | null;
  hostLabel: string | null;
  details: Record<string, unknown> | null;
}

export interface SessionLogMeta {
  sessionId: Id;
  hostLabel: string;
  kind: SessionKind;
  startedAt: number;
  size: number;
  path: string;
}

/* ------------------------------------------------------------------ */
/* Settings & vault                                                    */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentName = 'blue' | 'teal' | 'purple' | 'green' | 'orange' | 'pink' | 'graphite';

export interface AppSettings {
  theme: ThemeMode;
  accent: AccentName;
  reduceMotion: boolean;
  compactMode: boolean;
  terminal: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    cursorStyle: 'block' | 'underline' | 'bar';
    cursorBlink: boolean;
    scrollback: number;
    bell: boolean;
    copyOnSelect: boolean;
  };
  security: {
    autoLockMinutes: number;
    lockOnBrowserBlur: boolean;
    strictHostKeys: boolean;
    recordSessions: boolean;
  };
  connections: {
    keepaliveInterval: number;
    connectTimeout: number;
    defaultUsername: string;
    defaultPort: number;
  };
  files: {
    showHidden: boolean;
    confirmDelete: boolean;
    editorFontSize: number;
  };
  ui: {
    navCollapsed: boolean;
    hostView: 'grid' | 'list';
  };
}

export interface VaultStatus {
  /** True when a master password is configured. */
  protected: boolean;
  unlocked: boolean;
  autoLockMinutes: number;
  locksAt: number | null;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  nodeVersion: string;
  dataDir: string;
  serverTime: number;
  /** SSE/WS endpoint token appended by the server; not persisted. */
  eventToken: string;
}

/* ------------------------------------------------------------------ */
/* Events (WebSocket /ws/events)                                       */
/* ------------------------------------------------------------------ */

export type ServerEvent =
  | { type: 'hello'; serverTime: number }
  | { type: 'session.updated'; session: SessionInfo }
  | { type: 'session.closed'; sessionId: Id; state: SessionState; reason?: string }
  | { type: 'tunnel.updated'; tunnel: TunnelInfo }
  | { type: 'auth.prompt'; prompt: AuthPrompt }
  | { type: 'auth.prompt.closed'; requestId: Id }
  | { type: 'vault.locked' }
  | { type: 'vault.unlocked'; protected: boolean }
  | { type: 'audit'; event: AuditEvent }
  | { type: 'notify'; level: 'info' | 'success' | 'warning' | 'error'; title: string; message?: string }
  | { type: 'host.updated'; host: HostProfile }
  | { type: 'host.deleted'; hostId: Id }
  | { type: 'pong'; serverTime: number };

/* ------------------------------------------------------------------ */
/* SSH config import / export                                          */
/* ------------------------------------------------------------------ */

export interface SshConfigImportInput {
  content: string;
  groupName?: string;
}

export interface SshConfigImportResult {
  imported: HostProfile[];
  skipped: number;
  groupName: string | null;
}

export const HOST_COLORS = [
  '#0f6cbd',
  '#0e7c6b',
  '#7b3fb5',
  '#b45309',
  '#c2410c',
  '#be123c',
  '#0e7490',
  '#4d7c0f'
] as const;
