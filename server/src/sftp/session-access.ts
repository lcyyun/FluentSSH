import type { SFTPWrapper } from 'ssh2';
import type { SessionInfo } from '../../../shared/types.js';
import { ApiError, badRequest } from '../core/errors.js';

/**
 * Thin adapter over ssh-core's session manager (`server/src/ssh/session-manager.ts`).
 *
 * The module is imported lazily so that the HTTP layer keeps booting while the
 * SSH core workstream is still landing its implementation, and so a SFTP route
 * hit before the manager exists returns a clean API error instead of crashing
 * the process. Once loaded, the module handle is cached.
 */

interface SessionManagerModule {
  getSftpChannel(sessionId: string): Promise<SFTPWrapper>;
  getSessionInfo(id: string): SessionInfo | null;
}

let managerPromise: Promise<SessionManagerModule> | null = null;

async function loadSessionManager(): Promise<SessionManagerModule> {
  if (!managerPromise) {
    managerPromise = (async () => {
      const specifier = '../ssh/session-manager.js';
      let module: Partial<SessionManagerModule> | null = null;
      try {
        module = (await import(specifier)) as Partial<SessionManagerModule>;
      } catch (error) {
        console.error('[sftp] session manager module is unavailable', error);
        throw new ApiError(500, 'INTERNAL', 'SFTP 会话服务尚未就绪，请稍后重试。');
      }
      if (typeof module?.getSftpChannel !== 'function' || typeof module?.getSessionInfo !== 'function') {
        throw new ApiError(500, 'INTERNAL', 'SFTP 会话服务接口不完整，请稍后重试。');
      }
      return module as SessionManagerModule;
    })().catch((error) => {
      // Allow a later retry (e.g. hot reload of the module during development).
      managerPromise = null;
      throw error;
    });
  }
  return managerPromise;
}

export interface SftpSessionContext {
  channel: SFTPWrapper;
  session: SessionInfo;
}

/** Resolve a live, connected SFTP session and its cached SFTP channel. */
export async function requireSftpChannel(sessionId: string | undefined | null): Promise<SftpSessionContext> {
  const id = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!id) throw badRequest('需要提供 sessionId。');
  const manager = await loadSessionManager();
  const session = manager.getSessionInfo(id);
  if (!session) throw new ApiError(404, 'NOT_FOUND', 'SFTP 会话不存在，可能已被关闭。');
  if (session.kind !== 'sftp') throw new ApiError(409, 'SESSION_NOT_CONNECTED', '该会话不是 SFTP 会话。');
  if (session.state !== 'connected') {
    throw new ApiError(409, 'SESSION_NOT_CONNECTED', 'SFTP 会话尚未连接完成，请等待连接后再试。', {
      state: session.state,
      errorCode: session.errorCode,
      errorDetails: session.errorDetails
    });
  }
  const channel = await manager.getSftpChannel(id);
  return { channel, session };
}
