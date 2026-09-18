import type { IncomingMessage, ServerResponse } from 'node:http';
import { installConsoleCapture } from '../core/console.js';
import { createLogEntry } from '../core/serialize.js';
import { normalizeMaxLogs, type LogEntry } from '../core/types.js';

export interface NodeLogScannerOptions {
  /** Explicitly opt in. NODE_ENV=production always disables capture. */
  enabled?: boolean;
  /** Retained entries and maximum queued entries per connected client. */
  maxLogs?: number;
  /** Additional localhost origins, including their port, allowed to connect. */
  allowedOrigins?: readonly string[];
  /** Stream route this adapter answers on. Defaults to /__log-scanner/events. */
  path?: string;
}

export interface NodeLogScanner {
  /** The resolved stream route, so the same string registers the handler and reaches the browser. */
  readonly path: string;
  handleRequest(request: IncomingMessage, response: ServerResponse): void;
  dispose(): void;
}

interface Frame {
  id: string;
  text: string;
}

interface Client {
  enqueue(frame: Frame): void;
  heartbeat(): void;
  close(): void;
}

const MAX_CLIENTS = 32;
const STALL_TIMEOUT_MS = 10_000;
const DEFAULT_PATH = '/__log-scanner/events';

/** Accept a route with or without its leading slash, ignoring any query or fragment. */
function normalizePath(value = DEFAULT_PATH): string {
  const route = value.trim().split(/[?#]/)[0] ?? '';
  if (!route || route === '/') return DEFAULT_PATH;
  const rooted = route.startsWith('/') ? route : `/${route}`;
  return rooted.length > 1 && rooted.endsWith('/') ? rooted.slice(0, -1) : rooted;
}

function isLoopback(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function localOrigin(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopback(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    ) return url;
  } catch {
    // Invalid origins are denied without producing recursive console entries.
  }
  return undefined;
}

/** Capture this Node process's console output and serve a local-development SSE feed. */
export function createNodeLogScanner(options: NodeLogScannerOptions = {}): NodeLogScanner {
  let disposed = false;
  const enabled = options.enabled === true && process.env.NODE_ENV !== 'production';
  const maxLogs = normalizeMaxLogs(options.maxLogs);
  const path = normalizePath(options.path);
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).flatMap((value) => {
      const origin = localOrigin(value);
      return origin ? [origin.origin] : [];
    }),
  );
  const history: Frame[] = [];
  const clients = new Set<Client>();

  function capture(entry: LogEntry): void {
    const frame = { id: entry.id, text: `id: ${entry.id}\nevent: log\ndata: ${JSON.stringify(entry)}\n\n` };
    history.push(frame);
    if (history.length > maxLogs) history.splice(0, history.length - maxLogs);
    for (const client of clients) client.enqueue(frame);
  }

  const uninstall = enabled
    ? installConsoleCapture(console, (level, args) => capture(createLogEntry('server', level, args)))
    : () => {};
  const heartbeat = enabled
    ? setInterval(() => {
      for (const client of clients) client.heartbeat();
    }, 15_000)
    : undefined;
  heartbeat?.unref();

  function handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (!enabled || disposed || request.url?.split('?')[0] !== path) {
      response.writeHead(404).end('Not found');
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end('Method not allowed');
      return;
    }
    const host = request.headers.host;
    const protocol = 'encrypted' in request.socket && request.socket.encrypted === true ? 'https:' : 'http:';
    const hostOrigin = typeof host === 'string' ? localOrigin(`${protocol}//${host}`) : undefined;
    const originHeader = request.headers.origin;
    const origin = typeof originHeader === 'string' ? localOrigin(originHeader) : undefined;
    const originAllowed = originHeader === undefined || (
      origin !== undefined &&
      (origin.origin === hostOrigin?.origin || allowedOrigins.has(origin.origin))
    );
    if (!isLoopback(request.socket.remoteAddress ?? '') || !hostOrigin || !originAllowed) {
      response.writeHead(403).end('Log Scanner is available only to allowed localhost origins');
      return;
    }
    if (clients.size >= MAX_CLIENTS) {
      response.writeHead(503, { 'Retry-After': '10' }).end('Too many log streams');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
      ...(origin ? { 'Access-Control-Allow-Origin': origin.origin } : {}),
    });
    const cursor = request.headers['last-event-id'];
    const cursorIndex = typeof cursor === 'string' ? history.findIndex((frame) => frame.id === cursor) : -1;
    const pending = history.slice(cursorIndex + 1);
    let blocked = false;
    let closed = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clients.delete(client);
      pending.length = 0;
      clearTimeout(stallTimer);
      response.off('drain', onDrain);
      response.off('close', cleanup);
      response.off('error', close);
      request.off('aborted', close);
    }

    function close(): void {
      cleanup();
      response.destroy();
    }

    function write(text: string): void {
      if (closed || response.destroyed || response.writableEnded) {
        cleanup();
        return;
      }
      try {
        if (!response.write(text)) {
          blocked = true;
          stallTimer = setTimeout(close, STALL_TIMEOUT_MS);
          stallTimer.unref();
        }
      } catch {
        close();
      }
    }

    function flush(): void {
      while (!closed && !blocked && pending.length > 0) {
        write(pending.shift()!.text);
      }
    }

    function onDrain(): void {
      clearTimeout(stallTimer);
      blocked = false;
      flush();
    }

    const client: Client = {
      enqueue(frame) {
        if (closed) return;
        if (pending.length >= maxLogs) {
          close();
          return;
        }
        pending.push(frame);
        flush();
      },
      heartbeat() {
        if (!blocked) write(': heartbeat\n\n');
      },
      close,
    };
    clients.add(client);
    response.on('drain', onDrain);
    response.once('close', cleanup);
    response.once('error', close);
    request.once('aborted', close);
    write('retry: 1500\n: connected\n\n');
    flush();
  }

  return {
    path,
    handleRequest,
    dispose() {
      if (disposed) return;
      disposed = true;
      uninstall();
      clearInterval(heartbeat);
      for (const client of clients) client.close();
      history.length = 0;
    },
  };
}
