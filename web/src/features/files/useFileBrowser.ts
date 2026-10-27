/**
 * Browser state machine for one SFTP tab: current directory, listing, sort,
 * selection, in-directory filter and recursive search. Pure React state, no UI.
 */
import type { SftpEntry, SftpSearchResult } from '@shared/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api';
import { useAppStore } from '../../store/app';
import { parentPath } from '../../lib/format';
import {
  countHidden,
  DEFAULT_SORT,
  filterEntries,
  filterHidden,
  isDirectory,
  errorCodeOf,
  isNotFound,
  normalizeRemotePath,
  sortEntries,
  type SortDirection,
  type SortKey,
  type SortState
} from './file-utils';

export type ViewMode = 'list' | 'grid';

interface PathCacheEntry {
  path: string | null;
  sort: SortState;
  viewMode: ViewMode;
}

/** Directory/sort/view state survives tab switches and temporary unmounts. */
const tabCache = new Map<string, PathCacheEntry>();

export function clearTabCache(tabId: string) {
  tabCache.delete(tabId);
}

interface UseFileBrowserOptions {
  tabId: string;
  sessionId: string;
  /** Tab session state — only list once the backend session is connected. */
  connected: boolean;
  initialPath?: string;
  showHidden: boolean;
}

export interface SelectionModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface RecursiveSearchState {
  query: string;
  result: SftpSearchResult;
}

export interface FileBrowser {
  sessionId: string;
  connected: boolean;
  path: string | null;
  entries: SftpEntry[];
  visibleEntries: SftpEntry[];
  selectedEntries: SftpEntry[];
  selection: ReadonlySet<string>;
  totalCount: number;
  visibleCount: number;
  hiddenCount: number;
  loading: boolean;
  loadedOnce: boolean;
  error: string | null;
  errorCode: string | null;
  lastLoadedAt: number;
  homePath: string | null;
  sort: SortState;
  viewMode: ViewMode;
  searchOpen: boolean;
  searchQuery: string;
  searching: boolean;
  searchError: string | null;
  recursiveSearch: RecursiveSearchState | null;
  navigate: (path: string) => void;
  goParent: () => void;
  goHome: () => void;
  refresh: () => Promise<void>;
  toggleSort: (key: SortKey) => void;
  setViewMode: (mode: ViewMode) => void;
  selectOnly: (entry: SftpEntry) => void;
  handleSelect: (entry: SftpEntry, index: number, modifiers: SelectionModifiers) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSelectedPaths: (paths: string[]) => void;
  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
  runRecursiveSearch: () => Promise<void>;
  clearRecursiveSearch: () => void;
}

/** Stable selection key for an entry (remote absolute path). */
function selectionKey(entry: SftpEntry): string {
  return entry.path || entry.name;
}

const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  name: 'asc',
  size: 'desc',
  mtime: 'desc',
  mode: 'asc',
  type: 'asc'
};

export function useFileBrowser({
  tabId,
  sessionId,
  connected,
  initialPath,
  showHidden
}: UseFileBrowserOptions): FileBrowser {
  const cached = tabCache.get(tabId);
  const [path, setPath] = useState<string | null>(() => {
    if (cached?.path) return cached.path;
    if (initialPath) return normalizeRemotePath(initialPath);
    return null;
  });
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(cached?.sort ?? DEFAULT_SORT);
  const [viewMode, setViewModeState] = useState<ViewMode>(cached?.viewMode ?? 'list');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recursiveSearch, setRecursiveSearch] = useState<RecursiveSearchState | null>(null);

  const requestRef = useRef(0);
  const pathRef = useRef<string | null>(path);
  const homeRef = useRef<string | null>(null);
  const anchorRef = useRef<string | null>(null);
  const visibleRef = useRef<SftpEntry[]>([]);
  const homeRequestRef = useRef<string | null>(null);
  const resolveTokenRef = useRef(0);
  /** Set when the path was chosen from `home` (safe to replace by late initialPath). */
  const autoDerivedPathRef = useRef<string | null>(null);
  const fallbackRef = useRef(false);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  useEffect(() => {
    homeRef.current = homePath;
  }, [homePath]);

  // Persist directory/sort/view per tab so switching tabs feels native.
  useEffect(() => {
    if (!path) return;
    tabCache.set(tabId, { path, sort, viewMode });
  }, [tabId, path, sort, viewMode]);

  const notify = useCallback((level: 'info' | 'success' | 'warning' | 'error', title: string, message?: string) => {
    useAppStore.getState().notify(level, title, message);
  }, []);

  const load = useCallback(
    async (target: string) => {
      if (!connected || !sessionId) return;
      const requestId = ++requestRef.current;
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const result = await api.sftp.list(sessionId, target);
        if (requestId !== requestRef.current) return;
        const nextEntries = result.entries ?? [];
        setEntries(nextEntries);
        // Drop stale selections (e.g. files removed by another client).
        setSelection((previous) => {
          if (previous.size === 0) return previous;
          const existing = new Set(nextEntries.map((entry) => entry.path || entry.name));
          const next = new Set([...previous].filter((path) => existing.has(path)));
          if (next.size === previous.size) return previous;
          if (anchorRef.current && !next.has(anchorRef.current)) anchorRef.current = null;
          return next;
        });
        setLoading(false);
        setLoadedOnce(true);
        setLastLoadedAt(Date.now());
        const resolved = result.path || target;
        if (resolved && resolved !== target) {
          pathRef.current = resolved;
          setPath(resolved);
        }
      } catch (caught) {
        if (requestId !== requestRef.current) return;
        setLoading(false);
        const message = errorMessage(caught);
        if (isNotFound(caught) && !fallbackRef.current) {
          let fallback = homeRef.current;
          if (!fallback) {
            try {
              fallback = (await api.sftp.home(sessionId)).path;
              homeRef.current = fallback;
              setHomePath(fallback);
            } catch {
              fallback = null;
            }
          }
          if (fallback && fallback !== target) {
            fallbackRef.current = true;
            notify('warning', '目录不可访问', `${target} 不存在或已被删除，已返回主目录。`);
            pathRef.current = fallback;
            setPath(fallback);
            return;
          }
        }
        setEntries([]);
        setError(message);
        setErrorCode(errorCodeOf(caught));
      }
    },
    [connected, sessionId, notify]
  );

  // Resolve the remote home once per session (powers the "home" toolbar button).
  useEffect(() => {
    if (!connected || !sessionId) return;
    if (homeRequestRef.current === sessionId) return;
    homeRequestRef.current = sessionId;
    let cancelled = false;
    void api.sftp
      .home(sessionId)
      .then(({ path: home }) => {
        if (cancelled || !home) return;
        homeRef.current = home;
        setHomePath(home);
      })
      .catch(() => {
        // Home is best-effort; listing still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [connected, sessionId]);

  // Resolve the starting directory. Runs again whenever the tab's `initialPath`
  // is patched in after mount (session-actions can add it after the tab was
  // auto-created from `session.updated`), so a late initialPath is honoured
  // instead of leaving the tab stuck on the loading spinner.
  useEffect(() => {
    if (!connected || !sessionId) return;
    const existing = pathRef.current;
    if (existing) {
      if (!initialPath) return;
      const preferred = normalizeRemotePath(initialPath);
      if (autoDerivedPathRef.current !== existing) return;
      autoDerivedPathRef.current = null;
      if (preferred !== existing) {
        pathRef.current = preferred;
        setPath(preferred);
      }
      return;
    }
    const remembered = tabCache.get(tabId)?.path;
    const preferred = remembered ?? (initialPath ? normalizeRemotePath(initialPath) : null);
    if (preferred) {
      pathRef.current = preferred;
      setPath(preferred);
      return;
    }
    const token = ++resolveTokenRef.current;
    void (async () => {
      let home: string | null = null;
      try {
        home = (await api.sftp.home(sessionId)).path;
      } catch {
        home = null;
      }
      if (token !== resolveTokenRef.current || pathRef.current) return;
      const target = normalizeRemotePath(home ?? '/');
      autoDerivedPathRef.current = target;
      pathRef.current = target;
      setPath(target);
    })();
  }, [connected, sessionId, initialPath, tabId]);

  // Load whenever the target directory (or the connection) changes.
  useEffect(() => {
    if (!connected || !sessionId || !path) return;
    void load(path);
  }, [connected, sessionId, path, load]);

  const refresh = useCallback(async () => {
    const target = pathRef.current;
    if (!target) return;
    await load(target);
  }, [load]);

  const navigate = useCallback(
    (next: string) => {
      const normalized = normalizeRemotePath(next);
      setSelection(new Set());
      anchorRef.current = null;
      setSearchOpen(false);
      setSearchQuery('');
      setRecursiveSearch(null);
      setSearchError(null);
      fallbackRef.current = false;
      autoDerivedPathRef.current = null;
      if (normalized === pathRef.current) {
        void load(normalized);
        return;
      }
      pathRef.current = normalized;
      setPath(normalized);
    },
    [load]
  );

  const goParent = useCallback(() => {
    const current = pathRef.current;
    if (!current) return;
    if (current === '/' || current === '~') return;
    navigate(parentPath(current));
  }, [navigate]);

  const goHome = useCallback(() => {
    const home = homeRef.current;
    if (home) navigate(home);
  }, [navigate]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((previous) => {
      if (previous.key === key) {
        return { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: DEFAULT_DIRECTION[key] };
    });
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
  }, []);

  const clearSelection = useCallback(() => {
    anchorRef.current = null;
    setSelection(new Set());
  }, []);

  const selectOnly = useCallback((entry: SftpEntry) => {
    const target = selectionKey(entry);
    anchorRef.current = target;
    setSelection(new Set([target]));
  }, []);

  const handleSelect = useCallback((entry: SftpEntry, index: number, modifiers: SelectionModifiers) => {
    const target = selectionKey(entry);
    const additive = modifiers.ctrlKey || modifiers.metaKey;
    setSelection((previous) => {
      const next = new Set(previous);
      if (modifiers.shiftKey && anchorRef.current) {
        const list = visibleRef.current;
        const anchorIndex = list.findIndex((item) => selectionKey(item) === anchorRef.current);
        const from = Math.min(anchorIndex === -1 ? index : anchorIndex, index);
        const to = Math.max(anchorIndex === -1 ? index : anchorIndex, index);
        next.clear();
        for (let cursor = from; cursor <= to; cursor += 1) {
          const item = list[cursor];
          if (item) next.add(selectionKey(item));
        }
        return next;
      }
      if (additive) {
        if (next.has(target)) next.delete(target);
        else next.add(target);
        anchorRef.current = target;
        return next;
      }
      next.clear();
      next.add(target);
      anchorRef.current = target;
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelection(new Set(visibleRef.current.map((entry) => selectionKey(entry))));
  }, []);

  const setSelectedPaths = useCallback((paths: string[]) => {
    setSelection(new Set(paths));
    anchorRef.current = paths[0] ?? null;
  }, []);

  const resolvedEntries = useMemo(() => {
    if (recursiveSearch) return recursiveSearch.result.entries;
    const visible = filterHidden(entries, showHidden);
    return filterEntries(visible, searchQuery);
  }, [entries, showHidden, searchQuery, recursiveSearch]);

  const visibleEntries = useMemo(() => sortEntries(resolvedEntries, sort), [resolvedEntries, sort]);

  useEffect(() => {
    visibleRef.current = visibleEntries;
  });

  const selectedEntries = useMemo(() => {
    if (selection.size === 0) return [];
    const byPath = new Map<string, SftpEntry>();
    for (const entry of [...entries, ...(recursiveSearch?.result.entries ?? [])]) {
      byPath.set(selectionKey(entry), entry);
    }
    const result: SftpEntry[] = [];
    for (const selected of selection) {
      const entry = byPath.get(selected);
      if (entry) result.push(entry);
    }
    return result;
  }, [entries, recursiveSearch, selection]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchError(null);
    setRecursiveSearch(null);
  }, []);

  const setSearchQueryText = useCallback((query: string) => {
    setSearchQuery(query);
    setRecursiveSearch(null);
    setSearchError(null);
  }, []);

  const runRecursiveSearch = useCallback(async () => {
    const base = pathRef.current;
    const query = searchQuery.trim();
    if (!sessionId || !base || !query) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await api.sftp.search(sessionId, base, query, 500);
      setRecursiveSearch({ query, result });
    } catch (caught) {
      setSearchError(errorMessage(caught));
    } finally {
      setSearching(false);
    }
  }, [searchQuery, sessionId]);

  const clearRecursiveSearch = useCallback(() => {
    setRecursiveSearch(null);
    setSearchError(null);
  }, []);

  const hiddenCount = useMemo(() => countHidden(entries), [entries]);

  return {
    sessionId,
    connected,
    path,
    entries,
    visibleEntries,
    selectedEntries,
    selection,
    totalCount: entries.length,
    visibleCount: visibleEntries.length,
    hiddenCount,
    loading,
    loadedOnce,
    error,
    errorCode,
    lastLoadedAt,
    homePath,
    sort,
    viewMode,
    searchOpen,
    searchQuery,
    searching,
    searchError,
    recursiveSearch,
    navigate,
    goParent,
    goHome,
    refresh,
    toggleSort,
    setViewMode,
    selectOnly,
    handleSelect,
    selectAll,
    clearSelection,
    setSelectedPaths,
    openSearch,
    closeSearch,
    setSearchQuery: setSearchQueryText,
    runRecursiveSearch,
    clearRecursiveSearch
  };
}

/** True when the entry is a directory (kept here so table rows can import one helper). */
export { isDirectory };
