import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import type { Attributes, Connection, FileEntry, SFTPWrapper, Stats } from 'ssh2';

/**
 * Standalone mock SSH server fixture for SFTP + forwarding tests.
 *
 * Implements (over the real ssh2 wire protocol):
 *  - password authentication (default demo/demo123) with generated ed25519 host key
 *  - a real-file-backed SFTP v3 subsystem rooted in a temp directory:
 *    OPEN/READ/WRITE/CLOSE/OPENDIR/READDIR/LSTAT/STAT/FSTAT/SETSTAT/FSETSTAT/
 *    REMOVE/RMDIR/MKDIR/RENAME/REALPATH/READLINK/SYMLINK
 *  - direct-tcpip channels (`client.forwardOut`) forwarding to the requested target
 *  - remote port forwarding (`tcpip-forward` global request + `forwardOut` channels)
 *
 * Owned by the SFTP/tunnels workstream. Test-only code — never imported by the server.
 */

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

const DEFAULT_USERNAME = 'demo';
const DEFAULT_PASSWORD = 'demo123';

export interface MockSftpServerOptions {
  /** Existing empty directory to serve as the SFTP root. Created when omitted. */
  rootDir?: string;
  username?: string;
  password?: string;
  /** Remove the temp root directory on stop (default: true when we created it). */
  cleanup?: boolean;
  /** Connection trace logger. */
  log?: (message: string) => void;
}

export interface MockSftpServer {
  host: '127.0.0.1';
  port: number;
  rootDir: string;
  username: string;
  password: string;
  /** Private key PEM (OpenSSH "new" format). */
  hostKey: string;
  hostKeyType: string;
  /** SHA256:<base64-nopad> of the raw public host key, same format as the app. */
  hostKeyFingerprint: string;
  readonly connectionCount: number;
  readonly sftpSessionCount: number;
  readonly directTcpipCount: number;
  /** Ports currently bound by remote forwarding requests. */
  remoteForwardPorts: () => number[];
  stop: () => Promise<void>;
}

interface VirtualLink {
  target: string;
  createdAt: number;
}

type HandleState =
  | { kind: 'file'; fd: number }
  | { kind: 'dir'; entries: FileEntry[]; sent: boolean };

interface StatRecord {
  attrs: Attributes;
  isDir: boolean;
  isLink: boolean;
  linkTarget: string | null;
  size: number;
}

function sha256Fingerprint(rawKey: Buffer): string {
  const digest = crypto.createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function attrsOf(stats: fs.Stats): Attributes {
  return {
    mode: stats.mode,
    uid: stats.uid || 0,
    gid: stats.gid || 0,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  };
}

function syntheticLinkAttrs(size: number, createdAt: number): Attributes {
  return {
    mode: S_IFLNK | 0o777,
    uid: 0,
    gid: 0,
    size,
    atime: Math.floor(createdAt / 1000),
    mtime: Math.floor(createdAt / 1000)
  };
}

function statusForError(error: unknown): number {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return STATUS_CODE.NO_SUCH_FILE;
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return STATUS_CODE.PERMISSION_DENIED;
    default:
      return STATUS_CODE.FAILURE;
  }
}

function modeStringForFlags(flags: number): string {
  if (flags & OPEN_MODE.EXCL) return 'wx';
  if (flags & OPEN_MODE.APPEND) return 'a';
  if (flags & OPEN_MODE.WRITE) return flags & OPEN_MODE.TRUNC ? 'w' : 'r+';
  if (flags & OPEN_MODE.CREAT) return 'w';
  return 'r';
}

function normalizeVirtualPath(input: string): string {
  const raw = String(input ?? '')
    .replace(/\\/g, '/')
    .trim();
  let expanded = raw;
  if (expanded === '' || expanded === '.' || expanded === '~') expanded = '/';
  else if (expanded.startsWith('~/')) expanded = expanded.slice(1);
  const absolute = expanded.startsWith('/') ? expanded : `/${expanded}`;
  let normalized = path.posix.normalize(absolute);
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

export async function startMockSftpServer(options: MockSftpServerOptions = {}): Promise<MockSftpServer> {
  const log = options.log ?? (() => {});
  const username = options.username ?? DEFAULT_USERNAME;
  const password = options.password ?? DEFAULT_PASSWORD;
  const createdRoot = !options.rootDir;
  const rootDir = path.resolve(options.rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fluentssh-mock-sftp-')));
  fs.mkdirSync(rootDir, { recursive: true });

  const keyPair = utils.generateKeyPairSync('ed25519', {});
  const parsedPublic = utils.parseKey(keyPair.public);
  if (parsedPublic instanceof Error) throw parsedPublic;
  const hostKeyType = parsedPublic.type;
  const hostKeyFingerprint = sha256Fingerprint(parsedPublic.getPublicSSH());

  /* ------------------------------- virtual fs ------------------------------ */

  /** Fake symlinks used when the host OS refuses symlink creation (e.g. Windows). */
  const virtualLinks = new Map<string, VirtualLink>();

  const localPathOf = (virtualPath: string): string => {
    const relative = virtualPath === '/' ? '' : virtualPath.replace(/^\/+/, '');
    const local = path.resolve(rootDir, ...relative.split('/').filter(Boolean));
    if (local !== rootDir && !local.startsWith(rootDir + path.sep)) {
      throw Object.assign(new Error('Path escapes the SFTP root'), { code: 'EACCES' });
    }
    return local;
  };

  const childVirtualPath = (dirVirtual: string, name: string): string =>
    dirVirtual === '/' ? `/${name}` : `${dirVirtual}/${name}`;

  const recordOf = (virtualPath: string): StatRecord | null => {
    const link = virtualLinks.get(virtualPath);
    if (link) {
      return {
        attrs: syntheticLinkAttrs(link.target.length, link.createdAt),
        isDir: false,
        isLink: true,
        linkTarget: link.target,
        size: link.target.length
      };
    }
    try {
      const local = localPathOf(virtualPath);
      const stats = fs.lstatSync(local);
      const isLink = stats.isSymbolicLink();
      let linkTarget: string | null = null;
      if (isLink) {
        try {
          linkTarget = fs.readlinkSync(local);
        } catch {
          linkTarget = null;
        }
      }
      const kindBits = stats.mode & S_IFMT;
      return {
        attrs: attrsOf(stats),
        isDir: kindBits === S_IFDIR,
        isLink,
        linkTarget,
        size: stats.size
      };
    } catch {
      return null;
    }
  };

  const requireRecord = (virtualPath: string): StatRecord => {
    const record = recordOf(virtualPath);
    if (!record) throw Object.assign(new Error(`No such file: ${virtualPath}`), { code: 'ENOENT' });
    return record;
  };

  /* -------------------------------- servers -------------------------------- */

  const connections = new Set<Connection>();
  const remoteForwardServers = new Map<string, net.Server>();
  let connectionCount = 0;
  let sftpSessionCount = 0;
  let directTcpipCount = 0;

  const attachSftp = (sftp: SFTPWrapper) => {
    sftpSessionCount += 1;
    let nextHandle = 1;
    const handles = new Map<number, HandleState>();

    const makeHandle = (state: HandleState): Buffer => {
      const id = nextHandle++;
      handles.set(id, state);
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(id);
      return buffer;
    };
    const handleIdOf = (handle: Buffer): number => (handle.length === 4 ? handle.readUInt32BE(0) : -1);
    const stateOf = (handle: Buffer): HandleState | null => {
      const state = handles.get(handleIdOf(handle));
      return state ?? null;
    };
    const fail = (reqId: number, error: unknown) => sftp.status(reqId, statusForError(error), String((error as Error)?.message ?? error));

    const entriesOf = (virtualPath: string): FileEntry[] => {
      const local = localPathOf(virtualPath);
      const names = fs.readdirSync(local);
      const entries: FileEntry[] = names.map((name) => {
        const childVirtual = childVirtualPath(virtualPath, name);
        const link = virtualLinks.get(childVirtual);
        const attrs = link ? syntheticLinkAttrs(link.target.length, link.createdAt) : attrsOf(fs.lstatSync(localPathOf(childVirtual)));
        return { filename: name, longname: name, attrs };
      });
      // Merge in fake symlinks that cannot exist on this filesystem.
      for (const [linkPath, link] of virtualLinks) {
        if (path.posix.dirname(linkPath) !== virtualPath) continue;
        const name = path.posix.basename(linkPath);
        if (entries.some((entry) => entry.filename === name)) continue;
        entries.push({ filename: name, longname: name, attrs: syntheticLinkAttrs(link.target.length, link.createdAt) });
      }
      return entries;
    };

    const respondRecord = (reqId: number, record: StatRecord) => sftp.attrs(reqId, record.attrs);

    sftp.on('OPEN', (reqId, filename, flags, attrs) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        const local = localPathOf(virtualPath);
        if (virtualLinks.has(virtualPath)) throw Object.assign(new Error('Cannot open a symlink'), { code: 'EACCES' });
        const mode = modeStringForFlags(flags);
        const fd = fs.openSync(local, mode, attrs && typeof attrs.mode === 'number' ? attrs.mode & 0o777 : 0o644);
        sftp.handle(reqId, makeHandle({ kind: 'file', fd }));
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('READ', (reqId, handle, offset, length) => {
      try {
        const state = stateOf(handle);
        if (!state || state.kind !== 'file') throw Object.assign(new Error('Bad handle'), { code: 'EBADF' });
        const buffer = Buffer.alloc(Math.min(Math.max(length, 0), 256 * 1024));
        if (buffer.length === 0) return sftp.data(reqId, Buffer.alloc(0));
        const bytesRead = fs.readSync(state.fd, buffer, 0, buffer.length, offset);
        if (bytesRead === 0) return sftp.status(reqId, STATUS_CODE.EOF);
        sftp.data(reqId, buffer.subarray(0, bytesRead));
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('WRITE', (reqId, handle, offset, data) => {
      try {
        const state = stateOf(handle);
        if (!state || state.kind !== 'file') throw Object.assign(new Error('Bad handle'), { code: 'EBADF' });
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as unknown as string);
        fs.writeSync(state.fd, buffer, 0, buffer.length, offset);
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('FSTAT', (reqId, handle) => {
      try {
        const state = stateOf(handle);
        if (!state) throw Object.assign(new Error('Bad handle'), { code: 'EBADF' });
        if (state.kind === 'dir') {
          return sftp.attrs(reqId, {
            mode: S_IFDIR | 0o755,
            uid: 0,
            gid: 0,
            size: 0,
            atime: Math.floor(Date.now() / 1000),
            mtime: Math.floor(Date.now() / 1000)
          });
        }
        const stats = fs.fstatSync(state.fd);
        sftp.attrs(reqId, attrsOf(stats));
      } catch (error) {
        fail(reqId, error);
      }
    });

    const applyAttrs = (target: string | number, attrs: Attributes, handle: boolean) => {
      if (!attrs) return;
      const mode = attrs.mode;
      if (typeof mode === 'number') {
        const permissionBits = mode & 0o7777;
        if (handle) fs.fchmodSync(target as number, permissionBits);
        else fs.chmodSync(localPathOf(target as string), permissionBits);
      }
      if (typeof attrs.atime === 'number' && typeof attrs.mtime === 'number') {
        if (handle) fs.futimesSync(target as number, attrs.atime, attrs.mtime);
        else fs.utimesSync(localPathOf(target as string), attrs.atime, attrs.mtime);
      }
    };

    sftp.on('FSETSTAT', (reqId, handle, attrs) => {
      try {
        const state = stateOf(handle);
        if (!state || state.kind !== 'file') throw Object.assign(new Error('Bad handle'), { code: 'EBADF' });
        applyAttrs(state.fd, attrs, true);
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('SETSTAT', (reqId, filename, attrs) => {
      try {
        applyAttrs(normalizeVirtualPath(filename), attrs, false);
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('CLOSE', (reqId, handle) => {
      try {
        const state = stateOf(handle);
        if (!state) throw Object.assign(new Error('Bad handle'), { code: 'EBADF' });
        handles.delete(handleIdOf(handle));
        if (state.kind === 'file') fs.closeSync(state.fd);
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('OPENDIR', (reqId, filename) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        const record = requireRecord(virtualPath);
        if (!record.isDir) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
        const entries = entriesOf(virtualPath);
        sftp.handle(reqId, makeHandle({ kind: 'dir', entries, sent: false }));
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('READDIR', (reqId, handle) => {
      try {
        const state = stateOf(handle);
        if (!state || state.kind !== 'dir') throw Object.assign(new Error('Bad handle'), { code: 'EBADF' });
        if (state.sent) return sftp.status(reqId, STATUS_CODE.EOF);
        state.sent = true;
        sftp.name(reqId, state.entries);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('LSTAT', (reqId, filename) => {
      try {
        respondRecord(reqId, requireRecord(normalizeVirtualPath(filename)));
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('STAT', (reqId, filename) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        const record = requireRecord(virtualPath);
        if (record.isLink && record.linkTarget) {
          // STAT follows the link; resolve it relative to its directory.
          const targetVirtual = path.posix.resolve(path.posix.dirname(virtualPath), record.linkTarget);
          const target = requireRecord(targetVirtual);
          return respondRecord(reqId, { ...target, isLink: false, linkTarget: null });
        }
        respondRecord(reqId, { ...record, isLink: false, linkTarget: null });
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('REMOVE', (reqId, filename) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        if (virtualLinks.delete(virtualPath)) return sftp.status(reqId, STATUS_CODE.OK);
        fs.unlinkSync(localPathOf(virtualPath));
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('RMDIR', (reqId, filename) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        if (virtualPath === '/') throw Object.assign(new Error('Cannot remove root'), { code: 'EACCES' });
        fs.rmdirSync(localPathOf(virtualPath));
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('MKDIR', (reqId, filename, attrs) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        const mode = attrs && typeof attrs.mode === 'number' ? attrs.mode & 0o7777 : 0o755;
        fs.mkdirSync(localPathOf(virtualPath), { mode });
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('RENAME', (reqId, oldPath, newPath) => {
      try {
        const from = normalizeVirtualPath(oldPath);
        const to = normalizeVirtualPath(newPath);
        const fromLink = virtualLinks.get(from);
        if (fromLink) {
          virtualLinks.delete(from);
          virtualLinks.set(to, fromLink);
          return sftp.status(reqId, STATUS_CODE.OK);
        }
        fs.renameSync(localPathOf(from), localPathOf(to));
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('REALPATH', (reqId, filename) => {
      try {
        const virtualPath = normalizeVirtualPath(filename);
        const record = recordOf(virtualPath);
        if (!record && virtualPath !== '/') throw Object.assign(new Error(`No such file: ${virtualPath}`), { code: 'ENOENT' });
        const attrs = record ? record.attrs : { mode: S_IFDIR | 0o755, uid: 0, gid: 0, size: 0, atime: Math.floor(Date.now() / 1000), mtime: Math.floor(Date.now() / 1000) };
        sftp.name(reqId, [{ filename: virtualPath, longname: virtualPath, attrs }]);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('READLINK', (reqId, filename) => {
      const noAttrs: Attributes = { mode: 0, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 };
      try {
        const virtualPath = normalizeVirtualPath(filename);
        const virtualLink = virtualLinks.get(virtualPath);
        if (virtualLink) return sftp.name(reqId, [{ filename: virtualLink.target, longname: virtualLink.target, attrs: noAttrs }]);
        const local = localPathOf(virtualPath);
        const stats = fs.lstatSync(local);
        if (!stats.isSymbolicLink()) throw Object.assign(new Error('Not a symlink'), { code: 'EINVAL' });
        const target = fs.readlinkSync(local);
        sftp.name(reqId, [{ filename: target, longname: target, attrs: noAttrs }]);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('SYMLINK', (reqId, targetPath, linkPath) => {
      // ssh2 emits SYMLINK with a version-dependent argument order; when the
      // "link" argument already exists as an absolute path that is actually a
      // link target, swap them (v3 servers send target first).
      let target = targetPath;
      let link = linkPath;
      if (fs.existsSync(localPathOf(link)) && !fs.existsSync(localPathOf(target))) {
        target = linkPath;
        link = targetPath;
      }
      try {
        const linkVirtual = normalizeVirtualPath(link);
        const targetVirtual = normalizeVirtualPath(target);
        try {
          fs.symlinkSync(localPathOf(targetVirtual), localPathOf(linkVirtual));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOSYS' && code !== 'EINVAL') throw error;
          // Windows without Developer Mode cannot create symlinks; keep a
          // virtual link so the API surface stays testable.
          if (fs.existsSync(localPathOf(linkVirtual))) throw error;
          virtualLinks.set(linkVirtual, { target: path.posix.relative(path.posix.dirname(linkVirtual), targetVirtual), createdAt: Date.now() });
        }
        sftp.status(reqId, STATUS_CODE.OK);
      } catch (error) {
        fail(reqId, error);
      }
    });

    sftp.on('EXTENDED', (reqId) => {
      sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED);
    });

    void sftp.on('error' as never, (() => {}) as never);
  };

  /* --------------------------------- server -------------------------------- */

  const server = new Server({ hostKeys: [keyPair.private] }, (client) => {
    connections.add(client);
    connectionCount += 1;
    log('client connected');

    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
        return ctx.accept();
      }
      return ctx.reject(['password', 'keyboard-interactive']);
    });

    client.on('ready', () => {
      log('client authenticated');
    });

    client.on('session', (accept) => {
      const session = accept();
      session.on('sftp', (acceptSftp) => {
        log('sftp session opened');
        attachSftp(acceptSftp());
      });
      // No shell/exec needed for these tests — reject politely so the client
      // gets a deterministic error instead of a hang.
      session.on('shell', (_accept, reject) => reject?.());
      session.on('exec', (_accept, reject) => reject?.());
      session.on('pty', (accept) => accept?.());
    });

    client.on('tcpip', (accept, _reject, info) => {
      directTcpipCount += 1;
      const targetHost = info.destIP;
      const targetPort = info.destPort;
      log(`direct-tcpip -> ${targetHost}:${targetPort}`);
      const socket = net.connect({ host: targetHost, port: targetPort });
      socket.once('connect', () => {
        const channel = accept();
        socket.pipe(channel).pipe(socket);
        socket.on('error', () => channel.destroy());
        channel.on('error', () => socket.destroy());
        socket.on('close', () => channel.close());
        channel.on('close', () => socket.destroy());
      });
      socket.once('error', (error) => {
        log(`direct-tcpip connect failed: ${error.message}`);
        try {
          accept().destroy();
        } catch {
          // ignore
        }
      });
    });

    client.on('request', (accept, reject, name, info) => {
      if (name === 'tcpip-forward') {
        const bindInfo = info as { bindAddr: string; bindPort: number };
        const bindAddr = !bindInfo.bindAddr || bindInfo.bindAddr === '0.0.0.0' || bindInfo.bindAddr === '::' ? '127.0.0.1' : bindInfo.bindAddr;
        const forwardServer = net.createServer((socket) => {
          const remoteAddr = socket.remoteAddress?.replace(/^::ffff:/, '') ?? '127.0.0.1';
          const remotePort = socket.remotePort ?? 0;
          const boundPort = (forwardServer.address() as net.AddressInfo | null)?.port ?? bindInfo.bindPort;
          client.forwardOut(bindAddr, boundPort, remoteAddr, remotePort, (error, channel) => {
            if (error) {
              socket.destroy();
              return;
            }
            socket.pipe(channel).pipe(socket);
            socket.on('error', () => channel.destroy());
            channel.on('error', () => socket.destroy());
            socket.on('close', () => channel.close());
            channel.on('close', () => socket.destroy());
          });
        });
        forwardServer.once('error', () => reject?.());
        forwardServer.listen(bindInfo.bindPort, bindAddr, () => {
          const boundPort = (forwardServer.address() as net.AddressInfo).port;
          remoteForwardServers.set(`${bindAddr}:${boundPort}`, forwardServer);
          log(`remote forward bound ${bindAddr}:${boundPort}`);
          accept?.(boundPort);
        });
        return;
      }
      if (name === 'cancel-tcpip-forward') {
        const bindInfo = info as { bindAddr: string; bindPort: number };
        const key = `${bindInfo.bindAddr}:${bindInfo.bindPort}`;
        const forwardServer = remoteForwardServers.get(key);
        if (forwardServer) {
          forwardServer.close();
          remoteForwardServers.delete(key);
        }
        return accept?.();
      }
      return reject?.();
    });

    client.on('close', () => {
      connections.delete(client);
      log('client disconnected');
    });
    client.on('error', (error) => {
      log(`client error: ${error.message}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const port = (server.address() as net.AddressInfo).port;

  return {
    host: '127.0.0.1',
    port,
    rootDir,
    username,
    password,
    hostKey: keyPair.private,
    hostKeyType,
    hostKeyFingerprint,
    get connectionCount() {
      return connectionCount;
    },
    get sftpSessionCount() {
      return sftpSessionCount;
    },
    get directTcpipCount() {
      return directTcpipCount;
    },
    remoteForwardPorts: () =>
      [...remoteForwardServers.values()]
        .map((forwardServer) => (forwardServer.address() as net.AddressInfo | null)?.port ?? 0)
        .filter((value) => value > 0),
    stop: async () => {
      for (const forwardServer of remoteForwardServers.values()) forwardServer.close();
      remoteForwardServers.clear();
      for (const client of connections) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      connections.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (createdRoot && options.cleanup !== false) {
        try {
          fs.rmSync(rootDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  };
}

export type { Stats };
