import type { SessionState, TerminalClientMessage, TerminalServerMessage } from '@shared/types';

/**
 * Transport state of the browser <-> server terminal socket. This is separate
 * from the SSH session state: a network blip only moves the transport to
 * `reconnecting` while the SSH session on the server keeps running.
 */
export type TerminalTransportStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TerminalSocketHandlers {
  /** Backlog replay. `reattach` is true when this socket re-attached mid-session. */
  onBacklog: (data: Uint8Array, reattach: boolean) => void;
  onOutput: (data: Uint8Array) => void;
  onState: (message: { state: SessionState; message?: string; errorCode?: string; errorDetails?: Record<string, unknown> }) => void;
  onExit: (code: number | null, signal: string | null) => void;
  onError: (message: string) => void;
  onTitle: (title: string) => void;
  onStatus: (status: TerminalTransportStatus) => void;
  onLatency: (latencyMs: number | null) => void;
}

const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 15_000;
const MAX_QUEUED_INPUT = 200;

const textEncoder = new TextEncoder();

/** UTF-8 string -> base64 (chunked to keep the argument count of fromCharCode small). */
export function encodeBase64(text: string): string {
  const bytes = textEncoder.encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** base64 -> raw bytes, suitable for `terminal.write(Uint8Array)`. */
export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function terminalUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionId)}`;
}

/**
 * Resilient `/ws/terminal/:sessionId` client.
 *
 * - reconnects with exponential backoff after network drops / server restarts
 * - replays queued keystrokes once the socket is open again
 * - sends keepalive pings and reconnects when pongs stop arriving
 * - never closes the SSH session; disposing only detaches this socket
 */
export class TerminalSocket {
  private socket: WebSocket | null = null;
  private disposed = false;
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private pongWatchdog: number | null = null;
  private lastPingAt = 0;
  private lastMessageAt = 0;
  private queuedInput: string[] = [];
  private pendingResize: { cols: number; rows: number } | null = null;
  private hasAttached = false;
  private serverState: SessionState | null = null;
  private status: TerminalTransportStatus = 'connecting';

  constructor(
    private readonly sessionId: string,
    private readonly handlers: TerminalSocketHandlers
  ) {}

  connect() {
    if (this.disposed) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(terminalUrl(this.sessionId));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.disposed) {
        socket.close();
        return;
      }
      this.attempts = 0;
      this.lastMessageAt = Date.now();
      this.setStatus('open');
      this.flushQueuedInput();
      if (this.pendingResize) this.sendResize(this.pendingResize.cols, this.pendingResize.rows);
      this.startPingLoop();
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('online', this.handleOnline);
    };
    socket.onmessage = (event) => {
      if (this.disposed) return;
      this.lastMessageAt = Date.now();
      this.clearPongWatchdog();
      let message: TerminalServerMessage;
      try {
        message = JSON.parse(String(event.data)) as TerminalServerMessage;
      } catch {
        return;
      }
      this.dispatch(message);
    };
    socket.onerror = () => {
      // `close` follows; keep the error handler silent so the UI keeps the last state.
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.stopPingLoop();
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('online', this.handleOnline);
      if (this.disposed) {
        this.setStatus('closed');
        return;
      }
      // The server closes the socket after the remote shell exits; do not fight
      // it with reconnect attempts until the user explicitly reconnects.
      if (this.serverState === 'closed') {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  /** Queues or sends UTF-8 terminal input. */
  sendInput(text: string) {
    if (this.disposed || text.length === 0) return;
    const encoded = encodeBase64(text);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: 'input', data: encoded });
    } else if (this.queuedInput.length < MAX_QUEUED_INPUT) {
      this.queuedInput.push(encoded);
    }
  }

  /** Remembers/sends the terminal geometry. The latest size always wins. */
  sendResize(cols: number, rows: number) {
    if (this.disposed || !Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 1) return;
    this.pendingResize = { cols, rows };
    this.sendRaw({ type: 'resize', cols, rows });
  }

  /** Immediately re-attempt a connection (e.g. after the user clicked reconnect). */
  reconnectNow() {
    if (this.disposed) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.clearReconnectTimer();
    this.attempts = 0;
    this.serverState = null;
    this.connect();
  }

  /** Detach from the session. Never terminates the remote shell. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearReconnectTimer();
    this.stopPingLoop();
    this.clearPongWatchdog();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('online', this.handleOnline);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'close' } satisfies TerminalClientMessage));
      } catch {
        // ignore
      }
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    this.setStatus('closed');
  }

  private dispatch(message: TerminalServerMessage) {
    switch (message.type) {
      case 'backlog': {
        const reattach = this.hasAttached;
        this.hasAttached = true;
        this.handlers.onBacklog(decodeBase64(message.data || ''), reattach);
        break;
      }
      case 'output':
        this.handlers.onOutput(decodeBase64(message.data || ''));
        break;
      case 'state':
        this.serverState = message.state;
        this.handlers.onState({
          state: message.state,
          message: message.message,
          errorCode: message.errorCode,
          errorDetails: message.errorDetails
        });
        break;
      case 'exit':
        this.handlers.onExit(message.code ?? null, message.signal ?? null);
        break;
      case 'error':
        this.handlers.onError(message.message || '终端连接发生错误。');
        break;
      case 'title':
        this.handlers.onTitle(message.title);
        break;
      case 'pong': {
        const latency = this.lastPingAt ? Date.now() - this.lastPingAt : null;
        this.handlers.onLatency(latency);
        break;
      }
      default:
        break;
    }
  }

  private sendRaw(message: TerminalClientMessage) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The socket will fire `close` shortly.
    }
  }

  private flushQueuedInput() {
    if (this.queuedInput.length === 0) return;
    const queued = this.queuedInput;
    this.queuedInput = [];
    for (const data of queued) this.sendRaw({ type: 'input', data });
  }

  private startPingLoop() {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.lastPingAt = Date.now();
      this.sendRaw({ type: 'ping' });
      this.clearPongWatchdog();
      this.pongWatchdog = window.setTimeout(() => {
        if (this.disposed) return;
        // No pong (and no output) since the ping: treat the socket as dead.
        if (this.lastMessageAt < this.lastPingAt) {
          try {
            this.socket?.close();
          } catch {
            // ignore
          }
        }
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private stopPingLoop() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearPongWatchdog() {
    if (this.pongWatchdog !== null) {
      window.clearTimeout(this.pongWatchdog);
      this.pongWatchdog = null;
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null || this.serverState === 'closed') return;
    this.setStatus('reconnecting');
    this.attempts += 1;
    const delay = Math.min(10_000, 400 * Math.pow(1.7, this.attempts)) + Math.round(Math.random() * 180);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: TerminalTransportStatus) {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatus(status);
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.clearReconnectTimer();
      this.connect();
    }
  };

  private handleOnline = () => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.clearReconnectTimer();
      this.connect();
    }
  };
}
