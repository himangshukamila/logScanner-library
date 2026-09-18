import { normalizeMaxLogs, type LogEntry } from './types.js';

const EMPTY: readonly LogEntry[] = Object.freeze([]);

export interface LogStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly LogEntry[];
  getServerSnapshot(): readonly LogEntry[];
  append(entry: LogEntry): void;
  clear(): void;
  setMaxLogs(maxLogs: number): void;
  dispose(): void;
}

export function createLogStore(maxLogs = 500): LogStore {
  let capacity = normalizeMaxLogs(maxLogs);
  let snapshot = EMPTY;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function notify(): void {
    if (timer !== undefined || disposed || listeners.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        // A broken observer must not break logging or prevent other observers updating.
        try { listener(); } catch { /* Console reporting here would feed the collector. */ }
      }
    }, 16);
  }

  return {
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    append(entry) {
      if (disposed) return;
      snapshot = Object.freeze([...snapshot, entry].slice(-capacity));
      notify();
    },
    clear() {
      if (disposed || snapshot.length === 0) return;
      snapshot = EMPTY;
      notify();
    },
    setMaxLogs(value) {
      if (disposed) return;
      capacity = normalizeMaxLogs(value);
      if (snapshot.length > capacity) {
        snapshot = Object.freeze(snapshot.slice(-capacity));
        notify();
      }
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      listeners.clear();
      snapshot = EMPTY;
    },
  };
}
