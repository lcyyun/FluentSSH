import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AuditEvent,
  AuditCategory,
  AuditLevel,
  CommandHistoryEntry,
  HostGroup,
  KnownHost,
  Snippet,
  TunnelConfig
} from '../../../shared/types.js';
import type { StoredHost, StoredKey } from './store-types.js';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.js';

export interface AppData {
  schemaVersion: 1;
  createdAt: number;
  updatedAt: number;
  settings: ReturnType<typeof mergeSettings>;
  groups: HostGroup[];
  hosts: StoredHost[];
  keys: StoredKey[];
  knownHosts: KnownHost[];
  snippets: Snippet[];
  commandHistory: CommandHistoryEntry[];
  audit: AuditEvent[];
  tunnelConfigs: TunnelConfig[];
}

const AUDIT_LIMIT = 4000;
const HISTORY_LIMIT = 500;

function emptyData(): AppData {
  const now = Date.now();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    settings: structuredClone(DEFAULT_SETTINGS),
    groups: [],
    hosts: [],
    keys: [],
    knownHosts: [],
    snippets: [],
    commandHistory: [],
    audit: [],
    tunnelConfigs: []
  };
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Tiny durable JSON store with atomic writes. All mutations go through
 * `mutate()` so a single write path stays consistent.
 */
class Store {
  readonly dataDir: string;
  readonly dataFile: string;
  data: AppData;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dataFile = path.join(dataDir, 'store.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = this.load();
  }

  private load(): AppData {
    try {
      if (!fs.existsSync(this.dataFile)) return emptyData();
      const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) as Partial<AppData>;
      const merged: AppData = {
        ...emptyData(),
        ...raw,
        settings: mergeSettings(DEFAULT_SETTINGS, raw.settings ?? {}),
        groups: raw.groups ?? [],
        hosts: raw.hosts ?? [],
        keys: raw.keys ?? [],
        knownHosts: raw.knownHosts ?? [],
        snippets: raw.snippets ?? [],
        commandHistory: raw.commandHistory ?? [],
        audit: raw.audit ?? [],
        tunnelConfigs: raw.tunnelConfigs ?? []
      };
      return merged;
    } catch (error) {
      const corruptPath = `${this.dataFile}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(this.dataFile, corruptPath);
      } catch {
        // ignore
      }
      console.error(`[store] Failed to read store, starting fresh. Backup: ${corruptPath}`, error);
      return emptyData();
    }
  }

  /** Mutate data and persist. Returns the mutation result. */
  mutate<T>(fn: (data: AppData) => T): T {
    const result = fn(this.data);
    this.data.updatedAt = Date.now();
    this.scheduleSave();
    return result;
  }

  updateSettings(patch: unknown) {
    return this.mutate((data) => {
      data.settings = mergeSettings(data.settings, patch);
      return data.settings;
    });
  }

  addAudit(
    category: AuditCategory,
    level: AuditLevel,
    message: string,
    extra: { hostId?: string | null; hostLabel?: string | null; details?: Record<string, unknown> | null } = {}
  ): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      at: Date.now(),
      level,
      category,
      message,
      hostId: extra.hostId ?? null,
      hostLabel: extra.hostLabel ?? null,
      details: extra.details ?? null
    };
    this.mutate((data) => {
      data.audit.unshift(event);
      if (data.audit.length > AUDIT_LIMIT) data.audit.length = AUDIT_LIMIT;
    });
    return event;
  }

  addCommandHistory(entry: CommandHistoryEntry) {
    this.mutate((data) => {
      data.commandHistory.unshift(entry);
      if (data.commandHistory.length > HISTORY_LIMIT) data.commandHistory.length = HISTORY_LIMIT;
    });
  }

  getDataSnapshot(): AppData {
    return clone(this.data);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.dataFile}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.dataFile);
    } catch (error) {
      console.error('[store] Failed to persist store', error);
      this.dirty = true;
    }
  }

  private scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 120);
    this.saveTimer.unref?.();
  }
}

let storeInstance: Store | null = null;

export function initStore(dataDir: string): Store {
  storeInstance = new Store(dataDir);
  return storeInstance;
}

export function getStore(): Store {
  if (!storeInstance) throw new Error('Store has not been initialized');
  return storeInstance;
}

export type { Store };
