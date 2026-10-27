import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  SessionState,
  TerminalClientMessage,
  TerminalServerMessage
} from '../../../shared/types.js';
import { getTerminalSession, type TerminalSessionHandle } from './session-manager.js';

/**
 * Real `/ws/terminal/:sessionId` endpoint.
 *
 * The upgrade is authenticated by the shared logic in `server/src/ws.ts` before
 * it reaches this module. Multiple sockets may attach to the same session and
 * all receive the same output fan-out; closing a socket never closes the SSH
 * session (only `DELETE /api/sessions/:id` does).
 */

const terminalWss = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  maxPayload: 8 * 1024 * 1024
});

const MAX_INPUT_CHUNK_BYTES = 1024 * 1024;
const CLOSE_AFTER_CLOSED_MS = 80;

function send(ws: WebSocket, message: TerminalServerMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Socket went away mid-send; the close handler cleans up.
  }
}

function closeSoon(ws: WebSocket) {
  const timer = setTimeout(() => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }, CLOSE_AFTER_CLOSED_MS);
  timer.unref?.();
}

function attachSocket(ws: WebSocket, handle: TerminalSessionHandle) {
  let closed = false;

  const sendState = (info = handle.getInfo()) => {
    const message: {
      type: 'state';
      state: SessionState;
      message?: string;
      errorCode?: string;
      errorDetails?: Record<string, unknown>;
    } = { type: 'state', state: info.state };
    if (info.lastError) message.message = info.lastError;
    if (info.errorCode) message.errorCode = info.errorCode;
    if (info.errorDetails) message.errorDetails = info.errorDetails;
    send(ws, message);
  };

  // Replay first so a refreshed browser reconstructs its screen, then state.
  const info = handle.getInfo();
  send(ws, { type: 'backlog', data: handle.getBacklog().toString('base64') });
  send(ws, { type: 'title', title: info.title });
  sendState(info);

  if (info.state === 'closed') closeSoon(ws);

  const unsubscribeOutput = handle.onOutput((chunk) => {
    send(ws, { type: 'output', data: chunk.toString('base64') });
  });
  const unsubscribeMessage = handle.onMessage((message) => {
    send(ws, message);
    if (message.type === 'state' && message.state === 'closed') closeSoon(ws);
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribeOutput();
    unsubscribeMessage();
  };

  ws.on('message', (raw) => {
    let message: TerminalClientMessage;
    try {
      message = JSON.parse(raw.toString()) as TerminalClientMessage;
    } catch {
      send(ws, { type: 'error', message: '无法解析终端消息。' });
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      send(ws, { type: 'error', message: '终端消息格式不正确。' });
      return;
    }
    switch (message.type) {
      case 'input': {
        if (typeof message.data !== 'string') {
          send(ws, { type: 'error', message: '终端输入必须为 base64 字符串。' });
          return;
        }
        const data = Buffer.from(message.data, 'base64');
        if (data.length > MAX_INPUT_CHUNK_BYTES) {
          send(ws, { type: 'error', message: '终端输入过大。' });
          return;
        }
        handle.write(data);
        break;
      }
      case 'resize': {
        if (typeof message.cols !== 'number' || typeof message.rows !== 'number') return;
        if (!Number.isFinite(message.cols) || !Number.isFinite(message.rows)) return;
        handle.resize(message.cols, message.rows);
        break;
      }
      case 'ping':
        send(ws, { type: 'pong' });
        break;
      case 'close':
        // Client asked to detach; the SSH session intentionally stays alive.
        try {
          ws.close();
        } catch {
          // ignore
        }
        break;
      default:
        send(ws, { type: 'error', message: `未知的终端消息类型：${String((message as { type?: string }).type)}` });
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

function writeHttpError(socket: Duplex, status: number, statusText: string, message: string) {
  try {
    const body = JSON.stringify({ error: { code: 'NOT_FOUND', message } });
    socket.write(
      `HTTP/1.1 ${status} ${statusText}\r\n` +
        'Content-Type: application/json; charset=utf-8\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        'Connection: close\r\n\r\n' +
        body
    );
  } finally {
    socket.destroy();
  }
}

export function handleTerminalWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    writeHttpError(socket, 400, 'Bad Request', 'WebSocket 地址不合法。');
    return;
  }

  const match = /^\/ws\/terminal\/([^/]+)\/?$/.exec(pathname);
  if (!match) {
    writeHttpError(socket, 404, 'Not Found', '终端 WebSocket 路径不存在。');
    return;
  }

  let sessionId = '';
  try {
    sessionId = decodeURIComponent(match[1]);
  } catch {
    writeHttpError(socket, 400, 'Bad Request', '会话 ID 不合法。');
    return;
  }

  const handle = getTerminalSession(sessionId);
  if (!handle) {
    writeHttpError(socket, 404, 'Not Found', '终端会话不存在或已被删除。');
    return;
  }

  terminalWss.handleUpgrade(req, socket, head, (ws) => {
    attachSocket(ws, handle);
  });
}
