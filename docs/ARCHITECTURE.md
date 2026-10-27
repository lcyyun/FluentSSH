# FluentSSH — Architecture & Team Contract

A local-first, Fluent UI styled SSH workspace. Node.js backend (Express + ssh2) and React + Fluent UI v9 frontend, served together from `http://127.0.0.1:4317`.

```
D:\ssh
├─ shared/types.ts          # single source of truth for the API/WS contract (Lead owned)
├─ server/src
│  ├─ index.ts              # app wiring, static hosting, route mounting (Lead)
│  ├─ ws.ts                 # event WebSocket bridge (Lead)
│  ├─ config.ts             # paths/ports (Lead)
│  ├─ core/                 # store, vault, prompts, audit, logs, hosts (Lead)
│  ├─ ssh/                  # SSH engine, sessions, terminal WS, keys, exec (ssh-core teammate)
│  │  └─ connection.ts      # connection + host-key + auth plumbing (Lead, stable contract)
│  └─ routes/               # thin Express routers (per area; see ownership)
├─ web/src
│  ├─ App.tsx, theme.ts, styles.css, api.ts, events.ts, store/app.ts (Lead)
│  ├─ components/           # shared Fluent design-system primitives (Lead)
│  ├─ features/hosts        # Host manager (Lead)
│  ├─ features/settings     # Settings (Lead)
│  ├─ features/workspace    # session tabs, terminal, command runner (terminal-ui)
│  ├─ features/files        # SFTP file manager + transfers (files-ui)
│  ├─ features/tunnels      # tunnels page (security-ui)
│  ├─ features/security     # keys + known hosts (security-ui)
│  └─ features/logs         # audit + session logs (security-ui)
├─ tests/                   # mock SSH server + API + E2E tests
└─ data/                    # runtime: store.json, vault.json/keyring.json, logs/ (gitignored)
```

## Ownership map (do not edit files outside your scope)

| Scope | Owner |
| --- | --- |
| `package.json`, configs, `scripts/`, `shared/`, `docs/` | Lead |
| `server/src/index.ts`, `ws.ts`, `config.ts`, `core/**`, `routes/hosts.ts`, `routes/groups.ts`, `routes/meta.ts`, `routes/vault.ts`, `routes/settings.ts`, `routes/snippets.ts`, `routes/audit.ts`, `routes/auth-prompts.ts` | Lead |
| `server/src/ssh/**` (except `connection.ts` changes require a message to Lead), `server/src/routes/sessions.ts`, `keys.ts`, `known-hosts.ts`, `exec.ts`, `commands.ts`, `logs.ts` | ssh-core |
| `server/src/sftp/**`, `server/src/tunnels/**`, `server/src/routes/sftp.ts`, `server/src/routes/tunnels.ts` | sftp-tunnels |
| `web/src/features/workspace/**` | terminal-ui |
| `web/src/features/files/**` | files-ui |
| `web/src/features/tunnels/**`, `web/src/features/security/**`, `web/src/features/logs/**` | security-ui |
| `web/src/App.tsx`, `theme.ts`, `styles.css`, `api.ts`, `events.ts`, `store/app.ts`, `components/**`, `features/hosts/**`, `features/settings/**` | Lead |
| `tests/**` | Lead (test fixture pieces may be owned by backend teammates, coordinate) |

If you need a change in a Lead-owned file (e.g. a new API method in `web/src/api.ts`, a new type in `shared/types.ts`), send the Lead a precise message instead of editing it.

## Runtime topology

- One Node process serves REST `/api/**`, WebSocket `/ws/events` (server events), `/ws/terminal/:sessionId` (terminal I/O), and the built SPA. In dev, Vite (5173) proxies `/api` and `/ws` to 4317.
- All secrets are encrypted at rest by the vault. API responses never contain passwords, passphrases or private keys.
- A local HttpOnly session cookie is issued on first visit; API and WS require it. This is a localhost desktop-style app, not multi-user.
- ssh2 Client instances are owned by their consumer: one per terminal session, one per SFTP session, one per running tunnel. Jump-host chains are closed together.
- Host-key verification happens synchronously during the handshake using the stored known-hosts list. Unknown/mismatched keys abort the connect with a structured `ApiError` (409, code `HOST_KEY_UNKNOWN` / `HOST_KEY_MISMATCH`, details contain `fingerprint`, `keyType`, `expectedFingerprint`, `hostname`, `port`). The UI trusts the key via `POST /api/known-hosts/trust`, then retries.
- keyboard-interactive authentication prompts are brokered by `core/prompts.ts`: a server event `auth.prompt` is broadcast, the browser answers via `POST /api/auth/prompts/:requestId/respond`, and the blocked ssh2 auth callback continues.
- Terminal sessions survive browser refresh: output is buffered server-side (e.g. last 256 KB) and replayed on WS attach. The backend keeps the session alive if the socket closes.

## Frontend shell contract (Lead-owned APIs)

- `web/src/api.ts` — typed REST client (`api.hosts.list()` etc). All new backend calls must be added here by the Lead.
- `web/src/events.ts` — `useServerEvent(handler)` hook for `ServerEvent`s, connection status.
- `web/src/store/app.ts` — global app store:
  - state: `info, settings, vault, hosts, groups, view, navCollapsed, prompts, toasts, hostKeyChallenge, booted`
  - actions: `refreshHosts`, `refreshGroups`, `setView`, `updateSettings`, `notify`, `openHostKeyChallenge(details, retry)`, `setActivePrompt`, ...
- `web/src/components/*` — PageHeader, EmptyState, SectionCard, StatusPill, KeyValue, etc. Reuse these for visual consistency.
- Navigation: setting `view` to one of `hosts | workspace | tunnels | commands | security | logs | settings` swaps the main pane. Session tabs and the terminal live under `workspace`.
- To start sessions from other features, use `web/src/features/workspace/session-actions.ts` (terminal-ui owned):
  - `openTerminal(hostId, opts?)` → creates backend session, opens workspace tab
  - `openSftp(hostId, initialPath?)`
  - `openCommandRunner(hostId)` maybe
  These helpers must call `useAppStore.getState().setView('workspace')`.
- `web/src/features/workspace/store.ts` (terminal-ui owned) manages open tabs:
  - `Tab = { id, kind: 'terminal'|'files', sessionId, hostId, hostName, title, ... }`
  - exported actions: `openTab(tab)`, `closeTab(id)`, `setActive(id)`, `useWorkspaceStore`.
  files-ui creates the files tab content `FileManagerTab` (props `{ tab }`) and calls closeTab on close.
- Styling: use `makeStyles` + Fluent tokens; global CSS classes for app chrome. No CSS frameworks. Dark/light both must look intentional. Chinese UI copy, English technical labels.
- Add `data-testid` attributes on key interactive elements for Playwright.

## Testing

- `pnpm test` / `pnpm test:backend` — runs both backend end-to-end suites:
  - `tests/ssh-core.test.ts` (30 steps): sessions, terminal WebSocket, host-key trust/mismatch, password/publickey/KBI auth, exec + history, key generation/import, known hosts, recordings. Spawns the real server on a random port with a temp data dir.
  - `tests/sftp-tunnels.test.ts` (34 steps): SFTP operations/upload/download and local/dynamic/remote tunnels, byte counters, host-key errors, autoStart across restart. Uses `tests/fixtures/mock-sftp.ts` + `tests/fixtures/tunnel-target.ts`.
- `pnpm test:ui` — `scripts/run-ui-e2e.mjs` builds the web app, starts `scripts/mock-lab.ts` (mock SSH + SFTP + HTTP target) and a throwaway server, seeds two hosts + a tunnel, then runs 13 Playwright checks in `tests/ui.test.mjs` against installed Chrome. Screenshots land in `tests/.artifacts/`.
- `pnpm exec tsx scripts/mock-lab.ts` — standalone lab for manual UI work, writes ports/credentials/fingerprints to `tests/.artifacts/mock-lab.json`.
- Mock SSH server: `tests/fixtures/mock-ssh-server.ts` — password/publickey/keyboard-interactive auth, shell echo, exec, host keys, direct-tcpip.
- SFTP mock: `tests/fixtures/mock-sftp.ts` — real-wire SFTP v3 file operations over a temp directory, direct-tcpip and remote forwarding.
- `pnpm typecheck` — full repo `tsc --noEmit`; `pnpm build` — production Vite build.

## Conventions

- TypeScript strict, ESM (`"type": "module"`), imports need `.js` suffix inside server code (tsx/ts resolution).
- API error shape: `{ error: { code, message, details? } }`; use `ApiError` constructors from `core/errors.ts`.
- Zod validation at route boundaries.
- Keep server routes thin; services in `server/src/<area>/` or `server/src/ssh/`.
- Every meaningful mutation writes an audit event via `audit(category, level, message, {hostId, hostLabel, details})`.
- No secrets in logs or event payloads.
- Do not commit generated data, built assets, or node_modules.
