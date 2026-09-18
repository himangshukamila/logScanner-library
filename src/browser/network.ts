import { createNetworkEntry, previewText } from '../core/serialize.js';
import type { LogEntry, NetworkInfo } from '../core/types.js';

type Listener = (entry: LogEntry) => void;

/** Mutable while a request is in flight; frozen into the entry once it settles. */
interface RequestFacts {
  method: string;
  url: string;
  label: string;
  requestBody?: string;
}

interface Capture {
  listeners: Map<symbol, Listener>;
  restore: () => void;
}

const registryKey = Symbol.for('log-scanner.network-capture.v1');
// Only text-shaped responses are previewed; anything else is described by its type.
const TEXTUAL = /^(?:text\/|application\/(?:json|xml|javascript|x-www-form-urlencoded|[\w.+-]*\+json|[\w.+-]*\+xml))/i;
// An open stream never finishes reading, so it is named rather than previewed.
const STREAMING = /^text\/event-stream/i;
// Cloning tees the body into memory, so skip responses that announce themselves as large.
const MAX_BODY_BYTES = 512 * 1024;
const MAX_LABEL_CHARS = 300;
// A body that never settles must not hold up every later entry.
const BODY_TIMEOUT_MS = 2_000;

function absoluteUrl(value: string): string {
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

/** Same-origin requests read better as a bare path; others keep their origin for context. */
function labelFor(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return (parsed.origin === window.location.origin ? path : `${parsed.origin}${path}`).slice(0, MAX_LABEL_CHARS);
  } catch {
    return url.slice(0, MAX_LABEL_CHARS);
  }
}

function describeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return previewText(body);
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return previewText(body.toString());
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    // Values may be files; naming the fields is useful without copying their contents.
    return previewText(`[FormData] ${[...body.keys()].join(', ')}`);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) return `[Blob ${body.size} bytes]`;
  if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`;
  if (ArrayBuffer.isView(body)) return `[${body.constructor.name} ${body.byteLength} bytes]`;
  return '[stream]';
}

function describeRequest(input: unknown, init?: RequestInit): RequestFacts {
  let url = '';
  let method = init?.method;
  let body: unknown = init?.body;
  if (typeof input === 'string') url = input;
  else if (typeof URL !== 'undefined' && input instanceof URL) url = input.href;
  else if (typeof Request !== 'undefined' && input instanceof Request) {
    url = input.url;
    method ??= input.method;
    // A Request body is a consumable stream; reading it here would steal it from the caller.
    body ??= undefined;
  } else url = String(input);
  const absolute = absoluteUrl(url);
  return {
    method: (method ?? 'GET').toUpperCase(),
    url: absolute,
    label: labelFor(absolute),
    requestBody: describeBody(body),
  };
}

/**
 * Decide from headers alone whether a body is worth teeing. This has to be synchronous:
 * the caller's own handlers run next, and a consumed body can no longer be cloned.
 */
function planBody(response: Response): { capture: boolean; note?: string } {
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.body) return { capture: false };
  if (STREAMING.test(contentType)) return { capture: false, note: `[${contentType} stream]` };
  if (!TEXTUAL.test(contentType)) return { capture: false, note: `[${contentType || 'unknown content type'}]` };
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { capture: false, note: `[${declared} bytes not captured]` };
  return { capture: true };
}

async function readCloneText(clone: Response): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      clone.text(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), BODY_TIMEOUT_MS); }),
    ]);
    return text === null ? '[body preview timed out]' : previewText(text);
  } catch {
    // The stream was aborted or errored; metadata is still worth keeping.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function patchFetch(emit: (info: NetworkInfo, timestamp: number) => void): () => void {
  const original = window.fetch;
  if (typeof original !== 'function') return () => {};
  // Body previews resolve at different speeds, so entries queue to stay in response order.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue(build: () => Promise<NetworkInfo>, timestamp: number): void {
    queue = queue.then(async () => { emit(await build(), timestamp); }).catch(() => {});
  }

  const wrapper: typeof window.fetch = function (...args: Parameters<typeof window.fetch>) {
    const facts = describeRequest(args[0], args[1]);
    const started = performance.now();
    const result = original.apply(window, args);
    // Registered before the caller's own handlers, so the clone happens before the body is read.
    result.then(
      (response) => {
        const durationMs = performance.now() - started;
        const plan = planBody(response);
        let clone: Response | undefined;
        // Tee here, while the body is still guaranteed unread.
        if (plan.capture) {
          try { clone = response.clone(); } catch { /* Already consumed by another wrapper. */ }
        }
        enqueue(async () => ({
          ...facts,
          initiator: 'fetch',
          durationMs,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') ?? undefined,
          responseBody: clone ? await readCloneText(clone) : plan.note,
        }), Date.now());
      },
      (error: unknown) => {
        const durationMs = performance.now() - started;
        enqueue(async () => ({
          ...facts,
          initiator: 'fetch',
          durationMs,
          failed: true,
          responseBody: previewText(error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
        }), Date.now());
      },
    );
    return result;
  };
  window.fetch = wrapper;
  return () => {
    if (window.fetch === wrapper) window.fetch = original;
  };
}

function patchXhr(emit: (info: NetworkInfo, timestamp: number) => void): () => void {
  if (typeof XMLHttpRequest === 'undefined') return () => {};
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const pending = new WeakMap<XMLHttpRequest, RequestFacts & { started: number }>();

  function readXhrBody(xhr: XMLHttpRequest): string | undefined {
    try {
      if (xhr.responseType === '' || xhr.responseType === 'text') return previewText(xhr.responseText);
      if (xhr.responseType === 'json') return previewText(JSON.stringify(xhr.response));
      return `[responseType ${xhr.responseType}]`;
    } catch {
      return undefined;
    }
  }

  const openWrapper = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    const absolute = absoluteUrl(typeof url === 'string' ? url : url.href);
    pending.set(this, { method: String(method).toUpperCase(), url: absolute, label: labelFor(absolute), started: 0 });
    return (originalOpen as (this: XMLHttpRequest, ...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  const sendWrapper = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const facts = pending.get(this);
    if (facts) {
      facts.started = performance.now();
      facts.requestBody = describeBody(body);
      this.addEventListener('loadend', () => {
        pending.delete(this);
        emit({
          ...facts,
          initiator: 'xhr',
          durationMs: performance.now() - facts.started,
          // A zero status means the request never completed: failure, CORS rejection, or abort.
          ...(this.status === 0
            ? { failed: true }
            : {
              status: this.status,
              statusText: this.statusText,
              contentType: this.getResponseHeader('content-type') ?? undefined,
              responseBody: readXhrBody(this),
            }),
        }, Date.now());
      }, { once: true });
    }
    return originalSend.call(this, body);
  };

  proto.open = openWrapper;
  proto.send = sendWrapper;
  return () => {
    // A later integration may have wrapped these again; only unwind what is still ours.
    if (proto.open === openWrapper) proto.open = originalOpen;
    if (proto.send === sendWrapper) proto.send = originalSend;
  };
}

/** Ref-counted fetch/XHR interception that survives hot reload without stacking wrappers. */
export function installNetworkCapture(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => {};
  const global = globalThis as typeof globalThis & { [registryKey]?: Capture };
  let capture = global[registryKey];
  if (!capture) {
    const state: Capture = { listeners: new Map(), restore: () => {} };
    const emit = (info: NetworkInfo, timestamp: number): void => {
      const entry = createNetworkEntry(info, timestamp);
      for (const [token, subscriber] of [...state.listeners]) {
        if (!state.listeners.has(token)) continue;
        // A broken observer must not change how the application's own requests behave.
        try { subscriber(entry); } catch { /* Reporting here would feed the collector. */ }
      }
    };
    const restoreFetch = patchFetch(emit);
    const restoreXhr = patchXhr(emit);
    state.restore = () => { restoreFetch(); restoreXhr(); };
    capture = global[registryKey] = state;
  }
  const state = capture;
  const token = Symbol();
  state.listeners.set(token, listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    state.listeners.delete(token);
    if (state.listeners.size > 0) return;
    state.restore();
    delete global[registryKey];
  };
}
