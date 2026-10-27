import fs from 'node:fs';
import path from 'node:path';
import type { SessionLogMeta } from '../../../shared/types.js';

/** Append-only per-session terminal recordings, owned by the session manager. */
class SessionLogStore {
  private dir = '';

  init(dataDir: string) {
    this.dir = path.join(dataDir, 'logs');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  append(sessionId: string, chunk: Buffer) {
    if (!this.dir) return;
    try {
      fs.appendFileSync(path.join(this.dir, `${sessionId}.log`), chunk);
    } catch {
      // Logging must never break a terminal.
    }
  }

  writeMeta(sessionId: string, meta: SessionLogMeta) {
    if (!this.dir) return;
    try {
      fs.writeFileSync(path.join(this.dir, `${sessionId}.json`), JSON.stringify(meta, null, 2));
    } catch {
      // ignore
    }
  }

  list(): SessionLogMeta[] {
    if (!this.dir) return [];
    const metas: SessionLogMeta[] = [];
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        metas.push(JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8')) as SessionLogMeta);
      } catch {
        // ignore corrupt entries
      }
    }
    return metas.sort((a, b) => b.startedAt - a.startedAt);
  }

  read(sessionId: string): { meta: SessionLogMeta | null; content: Buffer | null } {
    if (!this.dir) return { meta: null, content: null };
    const metaPath = path.join(this.dir, `${sessionId}.json`);
    const logPath = path.join(this.dir, `${sessionId}.log`);
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) return { meta: null, content: null };
    const meta = fs.existsSync(metaPath)
      ? (JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SessionLogMeta)
      : null;
    const content = fs.existsSync(logPath) ? fs.readFileSync(logPath) : null;
    return { meta, content };
  }

  remove(sessionId: string) {
    if (!this.dir || !/^[a-zA-Z0-9-]+$/.test(sessionId)) return;
    fs.rmSync(path.join(this.dir, `${sessionId}.log`), { force: true });
    fs.rmSync(path.join(this.dir, `${sessionId}.json`), { force: true });
  }
}

let logStore: SessionLogStore | null = null;

export function initSessionLogStore(dataDir: string) {
  logStore = new SessionLogStore();
  logStore.init(dataDir);
  return logStore;
}

export function getSessionLogStore(): SessionLogStore {
  if (!logStore) throw new Error('Session log store has not been initialized');
  return logStore;
}

export type { SessionLogStore };
