# FluentSSH REST + WebSocket API

Base URL: `http://127.0.0.1:4317`. All routes below are relative to `/api`.
The server issues a local `fluentssh_sid` HttpOnly cookie on the first request; all API/WS calls require it. Browser `fetch` is same-origin so nothing special is needed. `GET /api/bootstrap` establishes the cookie.

Errors: HTTP status + `{ "error": { "code": "...", "message": "...", "details": {...} } }`.
Important codes: `VALIDATION` 400, `UNAUTHORIZED` 401, `AUTH_FAILED` 401, `VAULT_LOCKED` 423, `NOT_FOUND` 404, `HOST_KEY_UNKNOWN` / `HOST_KEY_MISMATCH` 409, `CONFLICT` 409, `CONNECTION_FAILED` 502, `SESSION_NOT_CONNECTED` 409.

All TypeScript payload types are in `shared/types.ts`.

---

## Meta / vault / settings

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/health` | – | `{ ok, name, version }` |
| GET | `/bootstrap` | – | `{ info: AppInfo, vault: VaultStatus, settings: AppSettings }` |
| GET | `/vault` | – | `{ status: VaultStatus }` |
| POST | `/vault/unlock` | `{ password }` | `{ status }` (401 if wrong) |
| POST | `/vault/lock` | – | `{ status }` |
| POST | `/vault/protect` | `{ password }` (min 6) | `{ status }` |
| POST | `/vault/unprotect` | `{ password }` | `{ status }` |
| POST | `/vault/touch` | – | `{ status }` |
| GET | `/settings` | – | `{ settings: AppSettings }` |
| PATCH | `/settings` | partial AppSettings | `{ settings }` |
| POST | `/settings` | – | reset defaults `{ settings }` |

## Hosts & groups

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/hosts` | – | `{ hosts: HostProfile[] }` |
| POST | `/hosts` | `HostInput` | 201 `{ host }` |
| GET | `/hosts/:id` | – | `{ host }` |
| PATCH | `/hosts/:id` | partial `HostInput` | `{ host }` |
| DELETE | `/hosts/:id` | – | 204 |
| POST | `/hosts/:id/duplicate` | – | 201 `{ host }` |
| GET | `/hosts/:id/ssh-config` | – | `{ content: string }` |
| GET | `/hosts/export` | `?ids=a,b` | `{ content: string }` (ssh_config) |
| POST | `/hosts/import/ssh-config` | `{ content, groupName? }` | `{ result: SshConfigImportResult }` |
| GET | `/groups` | – | `{ groups: HostGroup[] }` |
| POST | `/groups` | `{ name, color?, parentId? }` | 201 `{ group }` |
| PATCH | `/groups/:id` | partial group | `{ group }` |
| DELETE | `/groups/:id` | – | 204 (hosts become ungrouped) |

`HostInput.password` / `passphrase` are write-only; empty string clears them. `hasPassword` / `hasPassphrase` flags are returned instead. Secrets operations require an unlocked vault.

## Keys & known hosts

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/keys` | – | `{ keys: SshKeyMeta[] }` |
| POST | `/keys/generate` | `KeyGenerateInput` | 201 `{ key: SshKeyMeta }` (private key never returned) |
| POST | `/keys/import` | `KeyImportInput` | 201 `{ key }` |
| PATCH | `/keys/:id` | `{ name?, comment? }` | `{ key }` |
| DELETE | `/keys/:id` | – | 204 (409 if used by a host) |
| GET | `/known-hosts` | – | `{ knownHosts: KnownHost[] }` |
| POST | `/known-hosts/trust` | `TrustHostKeyInput` | 201 `{ knownHost }` |
| DELETE | `/known-hosts/:id` | – | 204 |
| POST | `/known-hosts/import` | `{ content: string }` (known_hosts text, non-hashed entries) | `{ imported: number, skipped: number }` |
| GET | `/known-hosts/export` | – | `{ content: string }` |

## Sessions (terminal + SFTP)

Session creation is **asynchronous**: it returns immediately with `state: 'connecting'`, progress arrives on `/ws/events` as `session.updated`. Terminal I/O uses `/ws/terminal/:sessionId`. SFTP uses REST with `sessionId`.

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/sessions` | `?kind=terminal\|sftp` | `{ sessions: SessionInfo[] }` |
| POST | `/sessions/terminal` | `CreateTerminalSessionInput` | 202 `{ session }` |
| POST | `/sessions/sftp` | `CreateSftpSessionInput` | 202 `{ session }` |
| GET | `/sessions/:id` | – | `{ session }` |
| POST | `/sessions/:id/reconnect` | – | 202 `{ session }` |
| POST | `/sessions/:id/disconnect` | – | `{ session }` (closed) |
| DELETE | `/sessions/:id` | – | 204 |

Session lifecycle: `connecting → (awaiting-auth) → connected → disconnected|closed|error`. On error, `errorCode` + `errorDetails` are filled. Special cases:
- `HOST_KEY_UNKNOWN` / `HOST_KEY_MISMATCH`: UI should show the fingerprint dialog. `errorDetails` = `{ hostname, port, keyType, fingerprint, expectedFingerprint? }`. After trusting (`POST /known-hosts/trust`), call `POST /sessions/:id/reconnect`.
- `AUTH_FAILED`: display a helpful message; edit host and reconnect.
- keyboard-interactive: server emits `auth.prompt`; the session state is `awaiting-auth`; respond via `/api/auth/prompts/:requestId/respond`.

### Terminal WebSocket `/ws/terminal/:sessionId`

- Auth: same local cookie (browser sends it automatically). Query `?token=` also accepted for tests.
- Immediately after open, server sends `{ type:'backlog', data }` (base64 UTF-8 bytes; may be empty), then live `{ type:'output', data }` and `{ type:'state', ... }`.
- Client → server: `{ type:'input', data }` (base64), `{ type:'resize', cols, rows }`, `{ type:'ping' }`, `{ type:'close' }`.
- Server → client: `{ type:'output'|'backlog', data }`, `{ type:'state', state, message?, errorCode?, errorDetails? }`, `{ type:'exit', code?, signal? }`, `{ type:'error', message }`, `{ type:'pong' }`, `{ type:'title', title }`.
- Multiple sockets may attach to the same session; output fans out to all. Backlog replay makes browser refresh seamless.
- Closing the socket does NOT close the SSH session. Explicit close is `DELETE /api/sessions/:id`.

## Auth prompts

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/auth/prompts` | – | `{ prompts: AuthPrompt[] }` |
| POST | `/auth/prompts/:requestId/respond` | `{ responses: string[] }` | `{ ok: true }` |
| POST | `/auth/prompts/:requestId/cancel` | – | `{ ok: true }` |

Server event: `{ type:'auth.prompt', prompt: AuthPrompt }`, then `{ type:'auth.prompt.closed', requestId }`.

## Exec / command history

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| POST | `/exec` | `ExecInput` | `{ result: ExecResult }` (executes `bash -lc <command>` by default; timeout capped at 10 min) |
| GET | `/commands/history` | `?limit=200` | `{ history: CommandHistoryEntry[] }` |
| DELETE | `/commands/history` | – | 204 |

`/exec` may return 409 host-key errors; UI shows the host-key dialog, trusts, retries. Keyboard-interactive prompts are supported through the broker. Successful and failed runs are appended to history + audit.

## SFTP (requires a connected `kind:'sftp'` session)

All paths are absolute remote paths unless noted. Query params: `sessionId` plus path.

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/sftp/home` | `sessionId` | `{ path: string }` (realpath of `.`) |
| GET | `/sftp/list` | `?sessionId&path` | `SftpListResult` (`path` defaults to `.`) |
| GET | `/sftp/stat` | `?sessionId&path` | `{ entry: SftpEntry }` |
| GET | `/sftp/search` | `?sessionId&path&query&limit=500` | `SftpSearchResult` (recursive filename search, depth/size capped) |
| POST | `/sftp/mkdir` | `{ sessionId, path, mode? }` | `{ path }` |
| POST | `/sftp/rename` | `{ sessionId, from, to }` | `{ path }` |
| POST | `/sftp/delete` | `{ sessionId, paths: string[], recursive?: boolean }` | `{ deleted: number }` |
| POST | `/sftp/chmod` | `{ sessionId, path, mode: string\|number }` (`"755"` or `0o755`) | `{ entry }` |
| POST | `/sftp/symlink` | `{ sessionId, target, path }` | `{ path }` |
| GET | `/sftp/read` | `?sessionId&path&maxBytes=2097152` | `SftpReadResult` (`binary` detection; truncated flag) |
| PUT | `/sftp/write` | `{ sessionId, path, content, encoding?: 'utf8'\|'base64' }` | `{ ok: true, size }` (atomic via temp file + rename where possible) |
| GET | `/sftp/download` | `?sessionId&path` | raw octet-stream with `Content-Disposition: attachment`, `Content-Length` |
| PUT | `/sftp/upload` | `?sessionId&path=<remoteDir>&name=<filename>&overwrite=1`, raw octet-stream body | `{ path, size }` |

Uploads/downloads are client-driven (browser progress + cancel); every completed operation writes an audit event.

## Tunnels

Tunnel configs persist in the store; live state lives in memory. `TunnelInfo` = config + `{ status, error, connections, bytesIn, bytesOut, startedAt, hostName }`.

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| GET | `/tunnels` | – | `{ tunnels: TunnelInfo[] }` |
| POST | `/tunnels` | `TunnelInput` | 201 `{ tunnel }` |
| PATCH | `/tunnels/:id` | partial `TunnelInput` | `{ tunnel }` (must be stopped) |
| DELETE | `/tunnels/:id` | `?stop=1` | 204 |
| POST | `/tunnels/:id/start` | – | `{ tunnel }` |
| POST | `/tunnels/:id/stop` | – | `{ tunnel }` |

- `local`: bind on `bindHost:bindPort` locally → forward through SSH to `targetHost:targetPort`.
- `remote`: request remote bind `bindHost:bindPort` on the server → forward to local `targetHost:targetPort` (reachable from this machine).
- `dynamic`: local SOCKS5 server on `bindHost:bindPort`, no target.
- Server events: `{ type:'tunnel.updated', tunnel }`.
- `autoStart` tunnels start after server boot if their host's credentials are available (skipped while vault locked).
- Start errors include host-key errors as `TunnelInfo.error` plus audit; the UI can trust the key and retry.

## Logs / audit

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/audit` | `?limit=300&category=&level=` | `{ events: AuditEvent[] }` |
| DELETE | `/audit` | – | 204 |
| GET | `/logs` | – | `{ logs: SessionLogMeta[] }` |
| GET | `/logs/:sessionId` | – | `text/plain` download of the recorded output |
| DELETE | `/logs/:sessionId` | – | 204 |

## WebSocket `/ws/events`

Cookie-authenticated. On open: `{ type:'hello', serverTime }`. Client may send `{ type:'ping' }` → `{ type:'pong', serverTime }`. Server events include:
`session.updated`, `session.closed`, `tunnel.updated`, `auth.prompt`, `auth.prompt.closed`, `vault.locked`, `vault.unlocked`, `audit`, `notify`, `host.updated`, `host.deleted`, `hello`, `pong`.

All server events are defined as the `ServerEvent` union in `shared/types.ts`.
