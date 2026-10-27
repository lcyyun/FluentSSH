import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { eventHub } from './core/events.js';
import { isValidToken, parseCookie } from './core/session-cookie.js';
import { handleTerminalWebSocketUpgrade } from './ssh/terminal-ws.js';
import type { ServerEvent } from '../../shared/types.js';

const clients = new Set<WebSocket>();

function authenticateUpgrade(req: IncomingMessage): boolean {
  const token = parseCookie(req.headers.cookie) ?? new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
  return isValidToken(token);
}

export function attachWebSockets(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  eventHub.subscribe((event) => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws/events') {
      if (!authenticateUpgrade(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        ws.send(JSON.stringify({ type: 'hello', serverTime: Date.now() } satisfies ServerEvent));
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as { type?: string };
            if (message.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() } satisfies ServerEvent));
            }
          } catch {
            // ignore malformed client messages
          }
        });
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
      });
      return;
    }

    if (url.pathname.startsWith('/ws/terminal/')) {
      if (!authenticateUpgrade(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      handleTerminalWebSocketUpgrade(req, socket, head);
      return;
    }

    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, 30_000);
  heartbeat.unref?.();
}

export function closeWebSockets() {
  for (const client of clients) {
    try {
      client.close();
    } catch {
      // ignore
    }
  }
  clients.clear();
}
