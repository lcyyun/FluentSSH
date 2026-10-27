/**
 * Client-side SFTP transfer queue.
 *
 * Uploads and downloads are browser-driven (XMLHttpRequest / fetch streams in
 * `web/src/api.ts`), so the queue lives entirely in the frontend. It is a
 * zustand store shared by the file manager and its transfer drawer, keyed by
 * backend SFTP session id so that multiple open file tabs can enqueue work.
 *
 * Behaviour:
 * - at most {@link MAX_CONCURRENT_TRANSFERS} transfers run at once (FIFO)
 * - every transfer is cancellable through an AbortController
 * - upload collisions are detected before transfer and resolved through a
 *   prompt (overwrite / skip / auto-rename)
 * - progress + speed are throttled to keep React renders cheap
 */
import type { TransferDirection, TransferStatus } from '@shared/types';
import { create } from 'zustand';
import { api, downloadSftpFile, errorMessage, uploadSftpFile } from '../../api';
import { joinPath } from '../../lib/format';
import { useAppStore } from '../../store/app';

/** Maximum number of simultaneously running transfers (per whole app). */
export const MAX_CONCURRENT_TRANSFERS = 3;

export interface TransferTask {
  id: string;
  direction: TransferDirection;
  sessionId: string;
  hostLabel: string;
  /** Name shown in the drawer (relative path for folder uploads). */
  localName: string;
  /** Directory the transfer operates in (remote). */
  remoteDir: string;
  /** Full remote file path. */
  remotePath: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  speedBps: number;
  overwrite: boolean;
  /** True while the task waits for collision resolution (not schedulable). */
  collision: boolean;
  /** Names already present in `remoteDir` (used by the rename resolver). */
  existingNames: string[];
  /** Upload payload. Kept in memory so retries are possible. */
  file: File | null;
  /** Webkit-relative path for folder uploads, e.g. `docs/img/a.png`. */
  relativePath: string | null;
}

export interface UploadCandidate {
  file: File;
  relativePath?: string;
}

export interface EnqueueUploadsInput {
  sessionId: string;
  hostLabel: string;
  dir: string;
  files: UploadCandidate[];
  /** Directory listing names from the file manager, used if the pre-check fails. */
  existingNames?: string[];
}

export interface EnqueueDownloadInput {
  sessionId: string;
  hostLabel: string;
  dir: string;
  path: string;
  fileName: string;
  size: number;
}

export type CollisionChoice = 'overwrite' | 'skip' | 'rename' | 'cancel';

interface TransferState {
  items: TransferTask[];
  drawerOpen: boolean;
  /** Task ids currently blocked on the collision dialog. */
  collisionIds: string[];
  enqueueUploads: (input: EnqueueUploadsInput) => Promise<void>;
  enqueueDownload: (input: EnqueueDownloadInput) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setDrawerOpen: (open: boolean) => void;
  resolveCollisions: (choice: CollisionChoice) => void;
}

/* ------------------------------------------------------------------ */
/* Module internals                                                    */
/* ------------------------------------------------------------------ */

const controllers = new Map<string, AbortController>();
const speedSamples = new Map<string, { at: number; bytes: number; bps: number }>();
const lastLoaded = new Map<string, number>();
const lastEmit = new Map<string, number>();
const createdRemoteDirs = new Set<string>();
const finishedListeners = new Set<(task: TransferTask) => void>();
let pumping = false;

/** Subscribe to completed transfers (used by the file manager to refresh the listing). */
export function onTransferFinished(listener: (task: TransferTask) => void): () => void {
  finishedListeners.add(listener);
  return () => finishedListeners.delete(listener);
}

function notifyError(title: string, message?: string) {
  useAppStore.getState().notify('error', title, message);
}

function uniqueRemoteName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function withName(file: File, name: string): File {
  if (file.name === name) return file;
  try {
    return new File([file], name, { type: file.type, lastModified: file.lastModified });
  } catch {
    // Very old browsers cannot construct File; the backend derives the name
    // from the File object, so renaming would not be possible there anyway.
    return file;
  }
}

function relativeParts(relativePath: string | null): { dir: string; name: string } {
  if (!relativePath) return { dir: '', name: '' };
  const normalized = relativePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index === -1) return { dir: '', name: normalized };
  return { dir: normalized.slice(0, index), name: normalized.slice(index + 1) };
}

async function ensureRemoteDir(sessionId: string, dir: string): Promise<void> {
  const fullKey = `${sessionId}:${dir}`;
  if (createdRemoteDirs.has(fullKey)) return;
  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = `${current}/${part}`;
    const key = `${sessionId}:${current}`;
    if (createdRemoteDirs.has(key)) continue;
    try {
      await api.sftp.mkdir(sessionId, current);
    } catch {
      // Existing directory / race with another upload: the file upload will
      // surface a real permission error if the directory is unusable.
    }
    createdRemoteDirs.add(key);
  }
  createdRemoteDirs.add(fullKey);
}

function computeSpeed(id: string, loaded: number): number {
  const now = performance.now();
  const previous = speedSamples.get(id);
  if (!previous) {
    speedSamples.set(id, { at: now, bytes: loaded, bps: 0 });
    return 0;
  }
  const elapsed = now - previous.at;
  if (elapsed < 300) return previous.bps;
  const instant = (loaded - previous.bytes) / (elapsed / 1000);
  const bps = previous.bps > 0 ? previous.bps * 0.55 + instant * 0.45 : instant;
  speedSamples.set(id, { at: now, bytes: loaded, bps });
  return Math.max(0, bps);
}

function makeTask(partial: Omit<TransferTask, 'id' | 'createdAt' | 'startedAt' | 'finishedAt' | 'speedBps' | 'error'>): TransferTask {
  return {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    speedBps: 0,
    error: null
  };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useTransferStore = create<TransferState>((set, get) => {
  const updateTask = (id: string, patch: Partial<TransferTask>) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }));
  };

  const reportProgress = (id: string, loaded: number, total: number) => {
    const task = get().items.find((item) => item.id === id);
    if (!task || task.status !== 'running') return;
    lastLoaded.set(id, loaded);
    const speedBps = computeSpeed(id, loaded);
    const now = performance.now();
    const last = lastEmit.get(id) ?? 0;
    const finished = total > 0 && loaded >= total;
    if (!finished && now - last < 100) return;
    lastEmit.set(id, now);
    updateTask(id, {
      transferred: loaded,
      size: task.size || total || 0,
      speedBps
    });
  };

  const startTransfer = async (task: TransferTask) => {
    const controller = new AbortController();
    controllers.set(task.id, controller);
    speedSamples.set(task.id, { at: performance.now(), bytes: task.transferred, bps: 0 });
    lastLoaded.set(task.id, task.transferred);
    updateTask(task.id, {
      status: 'running',
      startedAt: Date.now(),
      error: null,
      speedBps: 0,
      collision: false
    });

    let finalSize = task.size;
    try {
      if (task.direction === 'upload') {
        if (!task.file) throw new Error('源文件已不可用，无法上传。');
        if (task.relativePath) await ensureRemoteDir(task.sessionId, task.remoteDir);
        const uploaded = await uploadSftpFile({
          sessionId: task.sessionId,
          dir: task.remoteDir,
          file: task.file,
          overwrite: task.overwrite,
          onProgress: (loaded, total) => reportProgress(task.id, loaded, total),
          signal: controller.signal
        });
        finalSize = uploaded.size || task.size || lastLoaded.get(task.id) || 0;
      } else {
        await downloadSftpFile({
          sessionId: task.sessionId,
          path: task.remotePath,
          fileName: task.localName,
          onProgress: (loaded, total) => reportProgress(task.id, loaded, total),
          signal: controller.signal
        });
        finalSize = task.size || lastLoaded.get(task.id) || 0;
      }
      const current = get().items.find((item) => item.id === task.id);
      if (!current || current.status === 'cancelled') return;
      const finishedAt = Date.now();
      const duration = Math.max(1, finishedAt - (current.startedAt ?? finishedAt));
      const completed: TransferTask = {
        ...current,
        status: 'completed',
        transferred: finalSize,
        size: finalSize,
        speedBps: duration > 0 ? finalSize / (duration / 1000) : 0,
        finishedAt,
        collision: false,
        error: null
      };
      updateTask(task.id, completed);
      for (const listener of finishedListeners) {
        try {
          listener(completed);
        } catch (error) {
          console.error('[transfers] finished listener failed', error);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        updateTask(task.id, {
          status: 'cancelled',
          finishedAt: Date.now(),
          speedBps: 0
        });
        return;
      }
      const message = errorMessage(error);
      updateTask(task.id, {
        status: 'error',
        error: message,
        finishedAt: Date.now(),
        speedBps: 0
      });
      notifyError(task.direction === 'upload' ? '上传失败' : '下载失败', `${task.localName}：${message}`);
    } finally {
      controllers.delete(task.id);
      speedSamples.delete(task.id);
      lastEmit.delete(task.id);
      pump();
    }
  };

  const pump = () => {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const state = get();
        const running = state.items.filter((item) => item.status === 'running').length;
        if (running >= MAX_CONCURRENT_TRANSFERS) break;
        const next = state.items.find((item) => item.status === 'queued' && !item.collision);
        if (!next) return;
        // startTransfer flips the status synchronously before its first await,
        // so the loop below accounts for the new slot.
        void startTransfer(next);
      }
    } finally {
      pumping = false;
    }
  };

  const detectCollisions = async (
    sessionId: string,
    tasks: TransferTask[],
    fallbackNames: string[] | undefined
  ) => {
    const dirs = [...new Set(tasks.map((task) => task.remoteDir))];
    const namesByDir = new Map<string, Set<string>>();
    await Promise.all(
      dirs.map(async (dir) => {
        try {
          const result = await api.sftp.list(sessionId, dir);
          namesByDir.set(dir, new Set(result.entries.map((entry) => entry.name)));
        } catch {
          namesByDir.set(
            dir,
            new Set(dir === tasks[0]?.remoteDir && fallbackNames ? fallbackNames : [])
          );
        }
      })
    );
    for (const task of tasks) {
      const names = namesByDir.get(task.remoteDir);
      if (!names) continue;
      task.existingNames = [...names];
      task.collision = Boolean(task.file && names.has(task.file.name));
    }
    return tasks.filter((task) => task.collision).map((task) => task.id);
  };

  return {
    items: [],
    drawerOpen: false,
    collisionIds: [],

    enqueueUploads: async ({ sessionId, hostLabel, dir, files, existingNames }) => {
      if (files.length === 0) return;
      const tasks = files.map(({ file, relativePath }) => {
        const parts = relativeParts(relativePath ?? null);
        const remoteDir = parts.dir ? joinPath(dir, parts.dir) : dir;
        return makeTask({
          direction: 'upload',
          sessionId,
          hostLabel,
          localName: relativePath || file.name,
          remoteDir,
          remotePath: joinPath(remoteDir, file.name),
          size: file.size,
          transferred: 0,
          status: 'queued',
          overwrite: false,
          // Hold the queue until collision detection has run.
          collision: true,
          existingNames: [],
          file,
          relativePath: relativePath ?? null
        });
      });
      set((state) => ({ items: [...state.items, ...tasks], drawerOpen: true }));
      const collisionIds = await detectCollisions(sessionId, tasks, existingNames);
      const collisionSet = new Set(collisionIds);
      set((state) => ({
        items: state.items.map((item) =>
          tasks.some((task) => task.id === item.id)
            ? { ...item, collision: collisionSet.has(item.id) }
            : item
        ),
        collisionIds: [...state.collisionIds, ...collisionIds]
      }));
      pump();
    },

    enqueueDownload: ({ sessionId, hostLabel, dir, path, fileName, size }) => {
      const task = makeTask({
        direction: 'download',
        sessionId,
        hostLabel,
        localName: fileName,
        remoteDir: dir,
        remotePath: path,
        size,
        transferred: 0,
        status: 'queued',
        overwrite: true,
        collision: false,
        existingNames: [],
        file: null,
        relativePath: null
      });
      set((state) => ({ items: [...state.items, task], drawerOpen: true }));
      pump();
    },

    cancel: (id) => {
      const task = get().items.find((item) => item.id === id);
      if (!task) return;
      if (task.status === 'running') {
        controllers.get(id)?.abort();
        updateTask(id, { status: 'cancelled', finishedAt: Date.now(), speedBps: 0 });
      } else if (task.status === 'queued') {
        updateTask(id, { status: 'cancelled', finishedAt: Date.now() });
      }
      pump();
    },

    retry: (id) => {
      const task = get().items.find((item) => item.id === id);
      if (!task) return;
      if (task.direction === 'upload' && !task.file) {
        notifyError('无法重试', '源文件已不可用，请重新选择文件上传。');
        return;
      }
      updateTask(id, {
        status: 'queued',
        error: null,
        transferred: 0,
        speedBps: 0,
        startedAt: null,
        finishedAt: null,
        collision: false
      });
      set((state) => ({ drawerOpen: true, collisionIds: state.collisionIds.filter((item) => item !== id) }));
      pump();
    },

    remove: (id) => {
      const task = get().items.find((item) => item.id === id);
      if (task?.status === 'running') controllers.get(id)?.abort();
      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
        collisionIds: state.collisionIds.filter((item) => item !== id)
      }));
    },

    clearFinished: () => {
      set((state) => ({
        items: state.items.filter(
          (item) => item.status === 'queued' || item.status === 'running' || item.collision
        ),
        collisionIds: state.collisionIds
      }));
    },

    setDrawerOpen: (open) => set({ drawerOpen: open }),

    resolveCollisions: (choice) => {
      const { collisionIds, items } = get();
      if (collisionIds.length === 0) return;
      const idSet = new Set(collisionIds);
      if (choice === 'cancel') {
        for (const id of collisionIds) controllers.get(id)?.abort();
        set((state) => ({
          items: state.items.filter((item) => !idSet.has(item.id)),
          collisionIds: []
        }));
        return;
      }
      if (choice === 'skip') {
        set((state) => ({
          items: state.items.map((item) =>
            idSet.has(item.id)
              ? {
                  ...item,
                  status: 'cancelled' as TransferStatus,
                  collision: false,
                  error: '已跳过：目标文件已存在。',
                  finishedAt: Date.now()
                }
              : item
          ),
          collisionIds: []
        }));
        pump();
        return;
      }
      if (choice === 'overwrite') {
        set((state) => ({
          items: state.items.map((item) =>
            idSet.has(item.id) ? { ...item, overwrite: true, collision: false } : item
          ),
          collisionIds: []
        }));
        pump();
        return;
      }
      // rename: pick a free name in each target directory, accounting for both
      // existing remote files and other tasks resolved in the same batch.
      const claimedByDir = new Map<string, Set<string>>();
      for (const item of items) {
        const taken = claimedByDir.get(item.remoteDir) ?? new Set<string>();
        for (const name of item.existingNames) taken.add(name);
        if (item.file && !idSet.has(item.id)) taken.add(item.file.name);
        claimedByDir.set(item.remoteDir, taken);
      }
      const renamed = new Map<string, { name: string; file: File }>();
      for (const item of items) {
        if (!idSet.has(item.id) || !item.file) continue;
        const taken = claimedByDir.get(item.remoteDir) ?? new Set<string>();
        const nextName = uniqueRemoteName(item.file.name, taken);
        taken.add(nextName);
        claimedByDir.set(item.remoteDir, taken);
        renamed.set(item.id, { name: nextName, file: withName(item.file, nextName) });
      }
      set((state) => ({
        items: state.items.map((item) => {
          if (!idSet.has(item.id)) return item;
          const rename = renamed.get(item.id);
          if (!rename) return { ...item, collision: false };
          return {
            ...item,
            collision: false,
            overwrite: false,
            file: rename.file,
            localName: item.relativePath
              ? `${relativeParts(item.relativePath).dir}/${rename.name}`
              : rename.name,
            remotePath: joinPath(item.remoteDir, rename.name)
          };
        }),
        collisionIds: []
      }));
      pump();
    }
  };
});

/** Number of transfers that are running or waiting in the queue. */
export function countActiveTransfers(items: TransferTask[]): number {
  return items.filter((item) => item.status === 'queued' || item.status === 'running' || item.collision).length;
}

/** Short human status label used by the drawer. */
export function transferStatusLabel(task: TransferTask): string {
  switch (task.status) {
    case 'queued':
      return task.collision ? '等待冲突处理…' : '等待中';
    case 'running':
      return task.direction === 'upload' ? '上传中' : '下载中';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return task.error ?? '已取消';
    case 'error':
      return '失败';
    default:
      return '';
  }
}
