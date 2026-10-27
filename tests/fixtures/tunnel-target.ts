import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Tiny HTTP echo target used by tunnel tests. The server listens on the local
 * machine; tunnel traffic (local / dynamic / remote) is expected to reach it
 * and the caller verifies the JSON response.
 *
 * Owned by the SFTP/tunnels workstream. Not part of the product runtime.
 */

export interface TunnelTargetOptions {
  host?: string;
  /** 0 picks an ephemeral port (default). */
  port?: number;
  /** Marker used by tests to make sure they hit the intended instance. */
  name?: string;
  /** Artificial delay before responding, useful to observe transfer counters. */
  delayMs?: number;
}

export interface TunnelTargetHandle {
  host: string;
  port: number;
  /** http://host:port */
  url: string;
  name: string;
  /** How many requests the target has served. */
  readonly hits: number;
  close: () => Promise<void>;
}

interface EchoPayload {
  service: 'fluent-ssh-tunnel-target';
  name: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: string;
  /** Local port the request arrived on. */
  localPort: number;
  time: number;
}

export async function startTunnelTarget(options: TunnelTargetOptions = {}): Promise<TunnelTargetHandle> {
  const host = options.host ?? '127.0.0.1';
  const name = options.name ?? 'tunnel-target';
  const delayMs = Math.max(0, options.delayMs ?? 0);
  let hits = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      hits += 1;
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const payload: EchoPayload = {
        service: 'fluent-ssh-tunnel-target',
        name,
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: Buffer.concat(chunks).toString('utf8'),
        localPort: (server.address() as AddressInfo).port,
        time: Date.now()
      };
      const send = () => {
        if (res.writableEnded) return;
        const body = JSON.stringify(payload);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store'
        });
        res.end(body);
      };
      if (delayMs > 0) setTimeout(send, delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const port = (server.address() as AddressInfo).port;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    name,
    get hits() {
      return hits;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Abort any keep-alive sockets so close() cannot hang tests.
        server.closeAllConnections?.();
      })
  };
}
