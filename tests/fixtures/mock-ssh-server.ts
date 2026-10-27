import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ssh2 from 'ssh2';
import type {
  AcceptConnection,
  Connection,
  ExecInfo,
  ParsedKey,
  RejectConnection,
  ServerChannel,
  Session,
  TcpipRequestInfo
} from 'ssh2';

/**
 * In-process mock SSH server for FluentSSH backend tests.
 *
 * Supports:
 *  - ed25519 host key (fresh key material per start)
 *  - auth: password (demo/demo123), public key (authorized_keys lines),
 *    keyboard-interactive (password + OTP 123456)
 *  - interactive shell: echo, pwd, whoami, ls, uname, exit
 *  - exec: echo/pwd/whoami/false and a generic `mock-exec: <command>` reply
 *  - direct-tcpip forwarding (`client.forwardOut`)
 *
 * Deliberately no SFTP subsystem — sftp-tunnels owns tests/fixtures/mock-sftp.ts.
 */

const { Server, utils } = ssh2;

export interface MockSshServerOptions {
  host?: string;
  /** Defaults to an ephemeral port (0). */
  port?: number;
  username?: string;
  password?: string;
  /** Second keyboard-interactive answer (first is the password). */
  otp?: string;
  /** Set false to reject plain password auth (forces keyboard-interactive). */
  allowPasswordAuth?: boolean;
  /** OpenSSH public key lines accepted for publickey auth. */
  authorizedKeys?: string[];
  /** Accept any well-formed public key signature. */
  acceptAnyPublicKey?: boolean;
  /** Disable direct-tcpip forwarding. */
  enableForwarding?: boolean;
  /** Override generated host private key (OpenSSH format). */
  hostKeys?: string[];
  shellBanner?: string;
}

export interface MockSshServer {
  host: string;
  port: number;
  /** Private host key in OpenSSH format (for tests that need the material). */
  hostKey: string;
  hostKeys: string[];
  /** OpenSSH public host key line ("ssh-ed25519 AAAA..."). */
  publicKey: string;
  /** SHA256 fingerprint, format identical to core/connection.ts. */
  fingerprint: string;
  keyType: string;
  username: string;
  password: string;
  otp: string;
  /** Authorized public key lines currently accepted. */
  authorizedKeys: string[];
  addAuthorizedKey(publicKey: string): void;
  connectionCount(): number;
  stop(): Promise<void>;
}

interface ParsedAuthorizedKey {
  line: string;
  parsed: ReturnType<typeof utils.parseKey>;
}

function fingerprintOfRawHostKey(rawKey: Buffer): string {
  const digest = crypto.createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function shellReply(command: string, username: string): { stdout: string; exitCode: number } {
  const trimmed = command.trim();
  if (!trimmed) return { stdout: '', exitCode: 0 };
  const [name, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ');
  switch (name) {
    case 'echo':
      return { stdout: `${args}\r\n`, exitCode: 0 };
    case 'pwd':
      return { stdout: `/home/${username}\r\n`, exitCode: 0 };
    case 'whoami':
      return { stdout: `${username}\r\n`, exitCode: 0 };
    case 'ls':
      return { stdout: 'file1.txt  folder  notes.md\r\n', exitCode: 0 };
    case 'uname':
      return { stdout: 'Linux mock-ssh 6.1.0-fluentssh #1 SMP x86_64 GNU/Linux\r\n', exitCode: 0 };
    case 'exit':
    case 'logout':
      return { stdout: 'logout\r\n', exitCode: 0 };
    case 'false':
      return { stdout: 'false\r\n', exitCode: 1 };
    default:
      return { stdout: `${name}: command not found\r\n`, exitCode: 127 };
  }
}

export async function startMockSshServer(options: MockSshServerOptions = {}): Promise<MockSshServer> {
  const host = options.host ?? '127.0.0.1';
  const username = options.username ?? 'demo';
  const password = options.password ?? 'demo123';
  const otp = options.otp ?? '123456';
  const allowPasswordAuth = options.allowPasswordAuth !== false;
  const acceptAnyPublicKey = options.acceptAnyPublicKey === true;
  const enableForwarding = options.enableForwarding !== false;

  let hostKeys = options.hostKeys;
  if (!hostKeys || hostKeys.length === 0) {
    const pair = utils.generateKeyPairSync('ed25519');
    hostKeys = [pair.private];
  }
  const primaryKey = utils.parseKey(hostKeys[0]);
  if (primaryKey instanceof Error) throw new Error(`Mock SSH server: invalid host key (${primaryKey.message})`);
  const publicKeyLine = `ssh-ed25519 ${primaryKey.getPublicSSH().toString('base64')}`;
  const fingerprint = fingerprintOfRawHostKey(primaryKey.getPublicSSH());

  const authorizedKeys: string[] = [...(options.authorizedKeys ?? [])];
  const parsedAuthorized = (): ParsedAuthorizedKey[] =>
    authorizedKeys.map((line) => ({ line, parsed: utils.parseKey(line) }));

  const clients = new Set<Connection>();
  const sockets = new Set<net.Socket>();

  const server = new Server({ hostKeys }, (client: Connection) => {
    clients.add(client);
    let shellCount = 0;
    let execCount = 0;
    let kbiAttempts = 0;

    client.on('error', () => {
      // Client-side failure; fixture stays quiet.
    });
    client.on('close', () => {
      clients.delete(client);
    });

    client.on('authentication', (ctx) => {
      if (ctx.username !== username) {
        ctx.reject(['password', 'publickey', 'keyboard-interactive']);
        return;
      }
      if (ctx.method === 'none') {
        ctx.reject(['password', 'publickey', 'keyboard-interactive']);
        return;
      }
      if (ctx.method === 'password') {
        if (allowPasswordAuth && ctx.password === password) {
          ctx.accept();
          return;
        }
        ctx.reject(['publickey', 'keyboard-interactive']);
        return;
      }
      if (ctx.method === 'publickey') {
        let candidate: ParsedKey | null = null;
        if (acceptAnyPublicKey) {
          const probe = utils.parseKey(ctx.key.data);
          candidate = probe instanceof Error ? null : probe;
        } else {
          const match = parsedAuthorized().find(
            (entry) => !(entry.parsed instanceof Error) && entry.parsed.equals(ctx.key.data)
          );
          candidate = match && !(match.parsed instanceof Error) ? match.parsed : null;
        }
        if (!candidate) {
          ctx.reject(['password', 'keyboard-interactive']);
          return;
        }
        if (!ctx.signature) {
          // Client is only probing whether the key is acceptable.
          ctx.accept();
          return;
        }
        const verified = candidate.verify(ctx.blob ?? Buffer.alloc(0), ctx.signature, ctx.hashAlgo) as unknown;
        if (verified === true) {
          ctx.accept();
        } else {
          ctx.reject(['password', 'publickey', 'keyboard-interactive']);
        }
        return;
      }
      if (ctx.method === 'keyboard-interactive') {
        kbiAttempts += 1;
        if (kbiAttempts > 3) {
          ctx.reject();
          return;
        }
        ctx.prompt(
          [
            { prompt: 'Password: ', echo: false },
            { prompt: 'Verification code: ', echo: true }
          ],
          'FluentSSH mock SSH server',
          'Enter the account password and the one-time code.',
          (responses: string[]) => {
            if (responses[0] === password && responses[1] === otp) {
              ctx.accept();
            } else {
              ctx.reject(['password', 'keyboard-interactive']);
            }
          }
        );
        return;
      }
      ctx.reject(['password', 'publickey', 'keyboard-interactive']);
    });

    client.on('ready', () => {
      // Connection established; session requests follow.
    });

    client.on('session', (accept: AcceptConnection<Session>, reject: RejectConnection) => {
      const session = accept();
      if (!session) {
        reject();
        return;
      }
      // `accept` is only defined for requests sent with wantReply (pty/env),
      // so guard it: window-change/signal arrive without a reply callback.
      session.on('pty', (acceptPty) => {
        if (acceptPty) acceptPty();
      });
      session.on('window-change', (acceptWindow) => {
        if (acceptWindow) acceptWindow();
      });
      session.on('env', (acceptEnv) => {
        if (acceptEnv) acceptEnv();
      });
      session.on('signal', (acceptSignal) => {
        if (acceptSignal) acceptSignal();
      });

      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        shellCount += 1;
        handleShell(stream, username, options.shellBanner, shellCount);
      });

      session.on('exec', (acceptExec, _rejectExec, info: ExecInfo) => {
        const stream = acceptExec();
        execCount += 1;
        handleExec(stream, info.command, username, execCount);
      });

      session.on('subsystem', (_acceptSubsystem, rejectSubsystem) => {
        // No SFTP subsystem in this fixture (see mock-sftp.ts).
        rejectSubsystem();
      });
    });

    if (enableForwarding) {
      client.on('tcpip', (accept: AcceptConnection<ServerChannel>, reject: RejectConnection, info: TcpipRequestInfo) => {
        const target = net.connect({ host: info.destIP, port: info.destPort });
        target.once('connect', () => {
          const channel = accept();
          if (!channel) {
            target.destroy();
            return;
          }
          channel.pipe(target);
          target.pipe(channel);
          channel.on('close', () => target.destroy());
          target.on('close', () => {
            try {
              channel.close();
            } catch {
              // ignore
            }
          });
        });
        target.once('error', () => {
          try {
            reject();
          } catch {
            // ignore
          }
          target.destroy();
        });
      });
    }
  });

  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('error', () => {
    // listen errors surface through the promise below
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Mock SSH server: failed to acquire a listening port');
  }

  return {
    host,
    port: address.port,
    hostKey: hostKeys[0],
    hostKeys,
    publicKey: publicKeyLine,
    fingerprint,
    keyType: primaryKey.type,
    username,
    password,
    otp,
    authorizedKeys,
    addAuthorizedKey(publicKey: string) {
      const parsed = utils.parseKey(publicKey);
      if (parsed instanceof Error) throw new Error(`Mock SSH server: invalid authorized key (${parsed.message})`);
      if (!authorizedKeys.includes(publicKey)) authorizedKeys.push(publicKey);
    },
    connectionCount() {
      return clients.size;
    },
    async stop() {
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      clients.clear();
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Ensure the close callback always fires even if a socket lingers.
        const timer = setTimeout(resolve, 1000);
        timer.unref?.();
      });
    }
  };
}

function handleShell(
  stream: ServerChannel,
  username: string,
  banner: string | undefined,
  shellIndex: number
) {
  const prompt = `${username}@mock:~$ `;
  let line = '';
  stream.write(`${banner ?? 'FluentSSH mock SSH server'}\r\n`);
  stream.write(`shell #${shellIndex} ready.\r\n`);
  stream.write(prompt);

  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    for (const char of text) {
      if (char === '\r') {
        stream.write('\r\n');
        const command = line;
        line = '';
        if (command.trim() === 'exit' || command.trim() === 'logout') {
          stream.write('logout\r\n');
          try {
            stream.exit(0);
            stream.end();
          } catch {
            // ignore
          }
          return;
        }
        const reply = shellReply(command, username);
        if (reply.stdout) stream.write(reply.stdout);
        stream.write(prompt);
      } else if (char === '\n') {
        // Ignore LF; CR drives command execution.
      } else if (char === '\x7f' || char === '\b') {
        if (line.length > 0) {
          line = line.slice(0, -1);
          stream.write('\b \b');
        }
      } else if (char === '\x03') {
        line = '';
        stream.write('^C\r\n');
        stream.write(prompt);
      } else {
        line += char;
        stream.write(char);
      }
    }
  });
}

function handleExec(stream: ServerChannel, command: string, username: string, execIndex: number) {
  const trimmed = command.trim();
  if (trimmed === 'sleep-forever') {
    // Deliberately never answers; used to exercise client-side exec timeouts.
    return;
  }
  if (trimmed === 'big-output') {
    const chunk = Buffer.alloc(64 * 1024, 'x');
    for (let index = 0; index < 20; index += 1) stream.write(chunk);
    stream.exit(0);
    stream.end();
    return;
  }
  if (trimmed.startsWith('stderr-test')) {
    stream.stderr.write(`mock-exec stderr #${execIndex}\r\n`);
    stream.exit(0);
    stream.end();
    return;
  }
  if (trimmed.startsWith('exec-exit ')) {
    const code = Number(trimmed.slice('exec-exit '.length).trim()) || 1;
    stream.write(`mock-exec exit ${code}\r\n`);
    stream.exit(code);
    stream.end();
    return;
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ');
  let stdout = '';
  let exitCode = 0;
  if (name === 'echo') {
    stdout = `${args}\r\n`;
  } else if (name === 'pwd') {
    stdout = `/home/${username}\r\n`;
  } else if (name === 'whoami') {
    stdout = `${username}\r\n`;
  } else if (name === 'false') {
    stdout = '';
    exitCode = 1;
  } else {
    stdout = `mock-exec: ${trimmed}\r\n`;
  }
  if (stdout) stream.write(stdout);
  stream.exit(exitCode);
  stream.end();
}

/* ------------------------------------------------------------------ */
/* Standalone mode: `pnpm mock-ssh`                                     */
/* ------------------------------------------------------------------ */

async function runStandalone() {
  const port = Number(process.env.MOCK_SSH_PORT ?? 2222);
  const server = await startMockSshServer({ port });
  console.log(`[mock-ssh] listening on ${server.host}:${server.port}`);
  console.log(`[mock-ssh] user/password: ${server.username}/${server.password} (OTP ${server.otp})`);
  console.log(`[mock-ssh] host key ${server.keyType} ${server.fingerprint}`);
  const shutdown = () => {
    void server.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runStandalone().catch((error) => {
    console.error('[mock-ssh] failed', error);
    process.exit(1);
  });
}

export { fingerprintOfRawHostKey };
export default startMockSshServer;
