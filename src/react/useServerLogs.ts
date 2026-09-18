import { useEffect, useState } from 'react';
import { LOG_LEVELS, type LogEntry } from '../core/types.js';
import type { getBrowserStore } from '../browser/index.js';

type LogStore = ReturnType<typeof getBrowserStore>;
type ConnectionStatus = 'browser-only' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface ServerConnection {
  status: ConnectionStatus;
  message: string;
}

const BROWSER_ONLY: ServerConnection = { status: 'browser-only', message: 'Browser logs only' };
const MAX_EVENT_BYTES = 16_384;

function readServerEntry(data: unknown): LogEntry | null {
  if (typeof data !== 'string' || data.length > MAX_EVENT_BYTES || new TextEncoder().encode(data).byteLength > MAX_EVENT_BYTES) return null;
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    entry.source !== 'server' ||
    typeof entry.id !== 'string' || !entry.id || entry.id.length > 160 ||
    typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp) || Math.abs(entry.timestamp) > 8.64e15 ||
    typeof entry.level !== 'string' || !LOG_LEVELS.some((level) => level === entry.level) ||
    typeof entry.message !== 'string' || entry.message.length > 32_768 ||
    !Array.isArray(entry.args) || entry.args.length > 65 ||
    !entry.args.every((arg: unknown) => typeof arg === 'string' && arg.length <= 16_384)
  ) return null;
  return Object.freeze({
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level as LogEntry['level'],
    source: 'server',
    message: entry.message,
    args: Object.freeze(entry.args as string[]),
  });
}

export function useServerLogs(serverUrl: string | undefined, store: LogStore): ServerConnection {
  const [connection, setConnection] = useState<ServerConnection>(BROWSER_ONLY);

  useEffect(() => {
    if (!serverUrl) {
      setConnection(BROWSER_ONLY);
      return;
    }

    let stream: EventSource | undefined;
    let active = true;
    const seen = new Set(store.getSnapshot().filter((entry) => entry.source === 'server').map((entry) => entry.id));
    const update = (next: ServerConnection) => {
      if (active) setConnection((current) => current.status === next.status && current.message === next.message ? current : next);
    };
    const onOpen = () => update({ status: 'connected', message: 'Browser + server connected' });
    const onError = () => update(stream?.readyState === 2
      ? { status: 'error', message: 'Server connection closed. Browser logs remain available.' }
      : { status: 'reconnecting', message: 'Reconnecting to server… Browser logs remain available.' });
    const onLog = (event: Event) => {
      if (!active) return;
      try {
        const entry = readServerEntry((event as MessageEvent<unknown>).data);
        if (!entry) {
          update({ status: 'connected', message: 'Connected. Ignored an invalid server log.' });
          return;
        }
        if (seen.has(entry.id)) return;
        seen.add(entry.id);
        if (seen.size > 5_000) {
          const oldest = seen.values().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        if (store.getSnapshot().some((existing) => existing.source === 'server' && existing.id === entry.id)) return;
        store.append(entry);
        update({ status: 'connected', message: 'Browser + server connected' });
      } catch {
        update({ status: 'connected', message: 'Connected. Ignored an invalid server log.' });
      }
    };

    try {
      const url = new URL(serverUrl, window.location.href);
      if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        update({ status: 'error', message: 'Use a server stream URL on this page’s origin.' });
        return;
      }
      if (typeof EventSource === 'undefined') {
        update({ status: 'error', message: 'This browser does not support server log streaming.' });
        return;
      }
      update({ status: 'connecting', message: 'Connecting to server…' });
      stream = new EventSource(url.href);
      stream.addEventListener('open', onOpen);
      stream.addEventListener('error', onError);
      stream.addEventListener('log', onLog);
    } catch {
      update({ status: 'error', message: 'Could not open the server stream. Browser logs remain available.' });
    }

    return () => {
      active = false;
      stream?.removeEventListener('open', onOpen);
      stream?.removeEventListener('error', onError);
      stream?.removeEventListener('log', onLog);
      stream?.close();
      seen.clear();
    };
  }, [serverUrl, store]);

  return connection;
}
