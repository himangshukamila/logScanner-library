# logscan

**See your app's console output inside your app.** A development-only React panel — floating, draggable, resizable — that mirrors browser logs, and optionally logs from your local Node.js server, without touching how you write code.

[![npm](https://img.shields.io/npm/v/logscan.svg)](https://www.npmjs.com/package/logscan)
[![license](https://img.shields.io/npm/l/logscan.svg)](https://www.npmjs.com/package/logscan)
[![types](https://img.shields.io/badge/types-included-blue.svg)](#typescript)

Keep using `console.log()`, `console.info()`, `console.warn()`, `console.error()`, and `console.debug()`. Their normal browser and terminal output stays exactly as it is — the panel just shows a bounded copy, so you can debug on a phone, in a kiosk, on a device without DevTools, or next to the UI you're actually looking at.

---

## Install

```sh
npm install logscan
```

React 18.3 or 19 is a peer dependency. No Tailwind, no CSS setup, no provider, no config.

## Quick start

Mount one `<LogScanner />` at the root of your app, behind your dev flag:

```tsx
import { LogScanner } from 'logscan';
import { App } from './App';

export function Root() {
  return (
    <>
      <App />
      <LogScanner visible={import.meta.env.DEV} />
    </>
  );
}
```

That's it. Keep logging the way you always do:

```ts
console.log('Cart updated', { items: 3, total: 42 });
console.warn('Retrying request', { attempt: 2 });
console.error(new Error('Checkout failed'));
```

A logo button appears in the bottom-right corner. Click it to open the panel, search, filter, expand arguments, and copy entries.

> `import.meta.env.DEV` is the Vite dev flag. Use `process.env.NODE_ENV !== 'production'` for Next.js/CRA, or any flag your bundler provides. Nothing renders and nothing is captured when `visible` is false.

Styles are injected automatically on mount. Importing CSS is optional (see [Styling](#styling)).

## Props

| Prop | Type | Default | Behavior |
| --- | --- | --- | --- |
| `visible` | `boolean` | `false` | The master switch. Controls the launcher, the panel, browser capture, and the server stream. |
| `position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Which corner the launcher sits in. The panel docks into the same corner. |
| `network` | `boolean` | `true` | Capture `fetch` and `XMLHttpRequest` calls. See [Network capture](#network-capture). |
| `serverUrl` | `string` | — | Same-origin SSE endpoint for Node.js logs. Omit for browser-only capture. |
| `maxLogs` | `number` | `500` | Combined browser + network + server history size. Clamped to `1`–`5000`. |
| `enabled` | `boolean` | `false` | **Deprecated.** Legacy fallback used only when `visible` is omitted. |

`visible` always wins: `<LogScanner visible={false} enabled />` stays off. Use `visible` in new code.

## Features

| | |
| --- | --- |
| **Browser capture** | All five console methods, plus uncaught errors and unhandled promise rejections. |
| **Network capture** | Every `fetch` and `XMLHttpRequest`: method, URL, status, duration, and request/response bodies. |
| **Server logs** | Console output from an instrumented local Node.js process, streamed over SSE. Opt-in. |
| **Movable panel** | Drag the header; resize from either corner; adjust with the keyboard. Position survives reload. |
| **Search & filters** | Substring search combined with level and Browser/Network/Server source filters. |
| **Readable values** | Strings, numbers, keywords, and truncation markers are colour-coded in previews. |
| **Argument inspection** | Timestamps, level/source labels, and expandable snapshots of each argument. |
| **Copy & clear** | Copy a single entry with metadata, or clear the retained history. |
| **Smart scrolling** | Follows new logs while you're at the bottom; scroll up to read without being yanked back. |
| **Bounded by design** | 500 entries by default, size-capped snapshots, batched renders — safe during log storms. |
| **Zero setup** | Self-injecting styles, inline SVG logo, no Tailwind and no image requests in your app. |
| **Framework-safe** | StrictMode-safe, hot-reload-safe, SSR-safe imports, wrapped in an error boundary. |
| **Accessible** | Keyboard drag/resize, focus management, live status regions, labelled controls. |
| **Typed** | TypeScript declarations for every export. |

## Using the panel

| Control | Behavior |
| --- | --- |
| Logo button | Open or close the panel. |
| Header | Drag with mouse or touch. When focused, arrows move 10px; Shift + arrows move 1px. |
| Top-left handle | Resize while pinning the bottom-right corner — useful for enlarging the docked panel. |
| Bottom-right handle | Resize while pinning the top-left corner. Both handles support arrows and Shift + arrows. |
| Filter toggle | Collapse the search/level/source toolbar to hand its height back to the log list — worth ~90px on a small panel, where the toolbar wraps to two rows. The choice is remembered across reloads. |
| Search | Case-insensitive substring match on the message text. For network rows that covers the method, URL, and status. |
| Level / Source | Combine severity and Browser/Network/Server filters with search. Collapsing the toolbar keeps its filters applied, and the toggle shows a dot while any is active. |
| Inspect arguments | Expand the text snapshot taken at the moment of the console call. |
| Copy icon | Copies `[ISO timestamp] [source] [level] message`. |
| Clear icon | Clears the browser store, including filtered-out entries. Does not touch DevTools or server history. |
| Escape / close | Close the panel and return focus to the launcher. |

The panel opens at up to **640 × 512px**, shrinks to a **320 × 280px** minimum, and always stays inside the viewport. **Position, size, and whether the filter toolbar is collapsed are remembered in `sessionStorage`**, so they survive a reload and are cleared when the tab closes. Filter values themselves reset when the scanner is hidden or unmounted. Opening the panel focuses the search field, or the log list when the toolbar is collapsed.

## Network capture

Every `fetch` and `XMLHttpRequest` is recorded automatically — no extra setup — and shows up under the **Network** source filter:

```
POST  /api/checkout    200   142 ms
GET   /api/cart        404    18 ms
GET   /api/session          failed
```

Expand a row to see the full URL, content type, request body, and a preview of the response body. Status codes map onto levels, so the level filter works on traffic too: **2xx/3xx → info**, **4xx → warn**, **5xx and network failures → error**.

Capture is passive. Your request is passed through untouched, the response your code receives is the original one, and rejections still reject — the panel reads a clone.

| Detail | Behavior |
| --- | --- |
| Bodies | Request and response previews are capped at 2 KB. Only text-shaped content types are read (`text/*`, JSON, XML, form-encoded); anything else is labelled by type, e.g. `[image/png]`. |
| Large responses | Skipped when `content-length` exceeds 512 KB, and labelled with the declared size. |
| Streams | `text/event-stream` is never read, and any body preview that stalls past 2 s is abandoned rather than delaying later entries. |
| Timing | Wall-clock duration from call to response, via `performance.now()`. |
| Failures | A rejected `fetch` or a zero-status XHR is recorded as `failed` with the error text. |

Turn it off with `network={false}` if you don't want `fetch` patched:

```tsx
<LogScanner visible={import.meta.env.DEV} network={false} />
```

Uploads are described rather than copied (`[FormData] file, name`, `[Blob 4096 bytes]`), and a `Request` object's body is left untouched so it is never stolen from the caller.

## Toggling at runtime

Drive `visible` from state to build your own in-app switch:

```tsx
import { useState } from 'react';
import { LogScanner } from 'logscan';

export function Root() {
  const [visible, setVisible] = useState(import.meta.env.DEV);

  return (
    <>
      <App />
      <button type="button" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
        {visible ? 'Disable logs' : 'Enable logs'}
      </button>
      <LogScanner visible={visible} />
    </>
  );
}
```

| Action | UI | Capture | History |
| --- | --- | --- | --- |
| Close the panel | Launcher stays | Continues | Kept |
| `visible={false}` | Everything hidden | Stops | Kept |
| `visible={true}` again | Launcher returns, panel closed | Resumes | Available again |
| Unmount the scanner | Everything hidden | Stops, connections released | Kept for the page |
| Reload the page | New session | Follows the new config | Cleared |

Console calls emitted while capture is off cannot be recovered.

**Mount one scanner, at the root.** History and browser capture are shared globally; if several scanners mount, any hidden one pauses the shared collector.

## Capturing startup logs

`<LogScanner />` starts capturing when its effect runs. To catch logs emitted *before* React mounts, install the collector in your entry file, then import your app dynamically:

```tsx
import { createRoot } from 'react-dom/client';
import { installBrowserCapture } from 'logscan';

const stopCapture = import.meta.env.DEV ? installBrowserCapture({ maxLogs: 500 }) : () => {};
import.meta.hot?.dispose(stopCapture);

const { Root } = await import('./Root');
createRoot(document.getElementById('root')!).render(<Root />);
```

The dynamic import matters — static imports run before the entry module's own body, so the collector would install too late.

`installBrowserCapture({ maxLogs?, network? })` returns an idempotent cleanup function; keep it for hot reload and teardown. Installing early also means requests fired during startup are captured. Multiple installs share one collector, and once a scanner mounts, its `visible` prop controls the collector too. Logs already in DevTools cannot be recovered retroactively.

## Streaming Node.js logs

Optional. React can't read your terminal, so the adapter runs **inside your Node process** and streams entries to the panel over Server-Sent Events.

### 1. Install the adapter in your server

```ts
import express from 'express';
import { createNodeLogScanner } from 'logscan/node';

const app = express();
const dev = process.env.NODE_ENV === 'development';

const scanner = createNodeLogScanner({
  enabled: dev,
  maxLogs: 500,
  allowedOrigins: ['http://127.0.0.1:5173'],
});

if (dev) {
  app.get(scanner.path, scanner.handleRequest);
}

const server = app.listen(4318, '127.0.0.1');

function shutdown() {
  scanner.dispose();
  server.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

Express is just an example — with plain `node:http`, route matching requests to `scanner.handleRequest(request, response)`.

Two details worth knowing:

- Register the route with `app.get` and the full path, not `app.use` with a prefix — prefix mounting rewrites `req.url`, and the handler checks the path itself. `scanner.path` is the resolved route, so the same value registers the handler and reaches the browser.
- Install the adapter before the console calls you want to retain.

The default route is `/__log-scanner/events`. Override it when that collides with your own routing:

```ts
const scanner = createNodeLogScanner({ enabled: dev, path: '/__dev/logs' });
```

### 2. Proxy it through your dev server

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: { '/__log-scanner': 'http://127.0.0.1:4318' },
  },
});
```

### 3. Point the scanner at the proxied path

```tsx
<LogScanner visible={import.meta.env.DEV} serverUrl="/__log-scanner/events" maxLogs={500} />
```

The browser requires the stream to be on the **page's own origin**. A different port is a different origin, even on localhost — hence the proxy.

### Node API

`createNodeLogScanner(options?)` → `{ path, handleRequest, dispose }`

| Option | Default | Behavior |
| --- | --- | --- |
| `enabled` | `false` | Explicit opt-in. `NODE_ENV=production` disables capture regardless. |
| `maxLogs` | `500` | Retained server entries and per-client queue depth. Clamped to `1`–`5000`, independent of the React store. |
| `allowedOrigins` | `[]` | Extra localhost/loopback HTTP(S) origins, including ports. Non-local values are ignored. |
| `path` | `'/__log-scanner/events'` | Route the adapter answers on. A missing leading slash is added; query, fragment, and trailing slash are dropped. |

`dispose()` is idempotent: it detaches capture, closes streams, clears timers, and drops server history.

**Security:** the endpoint accepts loopback connections with a localhost host only, validates any `Origin` header against the request origin or your allow-list, and caps concurrent clients at 32. It ships no authentication and is not a remote log service — keep it out of production routes.

## How it works

```
console.log(…)          fetch / XHR             console.log(…)   [Node]
      │                      │                        │
      ├──▶ DevTools          ├──▶ untouched response  ├──▶ terminal output
      └──▶ text snapshot     └──▶ cloned preview      └──▶ bounded history
                  │                 │                          │
                  │                 │                   SSE (localhost only)
                  ▼                 ▼                          ▼
          bounded browser store  ◀───────── validate + deduplicate
                  │
                  └──▶ React subscription ──▶ floating panel
```

Arguments are converted to immutable text snapshots at call time, so the panel never holds references to your objects. Entries are appended in arrival order (rather than sorting clocks across processes) and UI notifications are batched during bursts.

The server sends named `log` events with IDs, so native `EventSource` reconnection replays only what you missed; the browser suppresses duplicates by ID. A backend outage never stops browser capture.

## Styling

The stylesheet injects itself into `<head>` on mount — you don't need to import anything. It uses compiled, `ls:`-prefixed Tailwind utilities with **no Preflight**, so it cannot leak into or inherit from your app's styles. The logo is inline SVG, so the package ships no image files and makes no extra network request.

If you'd rather control load order yourself, the compiled CSS is exported:

```ts
import 'logscan/styles.css';
```

## Entry points

| Import | Exports |
| --- | --- |
| `logscan` | `LogScanner`, `installBrowserCapture`, and the public types. |
| `logscan/node` | `createNodeLogScanner` — **server code only**. |
| `logscan/styles.css` | Compiled stylesheet (optional). |

### TypeScript

```ts
import type { LogScannerProps, LauncherPosition, LogEntry, LogLevel, LogSource, NetworkInfo } from 'logscan';
import type { NodeLogScanner, NodeLogScannerOptions } from 'logscan/node';
```

```ts
type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
type LogSource = 'browser' | 'server' | 'network';

interface LogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly args: readonly string[];
  readonly message: string;
  /** Present only on network entries. */
  readonly network?: NetworkInfo;
}

interface NetworkInfo {
  readonly method: string;
  readonly url: string;
  readonly label: string;
  readonly initiator: 'fetch' | 'xhr';
  readonly durationMs: number;
  readonly status?: number;
  readonly statusText?: string;
  readonly contentType?: string;
  readonly requestBody?: string;
  readonly responseBody?: string;
  readonly failed?: boolean;
}
```

## Requirements

- React **18.3+** or **19** (peer dependency, with `react-dom`)
- ESM-only package — modern bundlers and Node **22.12+** for the server adapter
- Any modern browser; `EventSource` is required only for server streaming

The package is SSR-safe to import: capture starts after mounting in the browser.

## Limits

- **Memory only.** Log history is never written to disk, a database, or an upload; a reload or restart ends that session. The single exception is the panel's own position and size, kept in `sessionStorage`.
- **Snapshots, not live objects.** Previews are readable (circular refs, errors, `Map`/`Set`, `Date`, `bigint`, accessors) but capped by argument count, depth, and size, with truncation markers. Getters and `toJSON()` are not intentionally invoked.
- **No DevTools formatting.** `%c`, groups, tables, and interactive object trees are rendered as plain text. Wrapping the console can also affect source-link attribution.
- **Network scope.** `fetch` and `XMLHttpRequest` only. Requests from service workers, `sendBeacon`, WebSocket and EventSource traffic, and anything issued before capture installs are not recorded. Request/response *headers* are not captured beyond content type.
- **Scope.** The current browser realm and the instrumented Node process. Workers, other frames, subprocess output, raw stdout writes, and Pino/Winston transports are out of scope.
- **StrictMode.** Shared wrappers prevent duplicate interception, but genuine double-logging from your own effects still shows twice — as it should.
- **Development tool.** Guard `visible` (and any startup collector) with your dev flag. The Node adapter additionally refuses to run under `NODE_ENV=production`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No launcher appears | Capture defaults to off — verify `visible`, your dev flag, and that the component actually mounts. |
| Earlier logs are missing | Install [startup capture](#capturing-startup-logs) before dynamically importing your app. |
| Capture stops unexpectedly | Another mounted scanner may be hidden; use a single root scanner. |
| "Use a server stream URL on this page's origin" | Use a relative, proxied path. Direct backend URLs on another port are rejected. |
| Stream returns 404 | Check the exact route, `enabled`, and `NODE_ENV`. Disabled or disposed adapters return 404. |
| Stream returns 403 | Check loopback binding, `Host`/`Origin`, and `allowedOrigins`. `localhost` and `127.0.0.1` are *different* origins. |
| Stream returns 503 | The 32-client limit was reached; close stale tabs. |
| Stuck on "Reconnecting" | Check the backend and proxy. Browser capture keeps working regardless. |
| Cleared logs reappear | A fresh stream replays the Node adapter's retained history. Clear only affects the browser store. |
| No network rows | Check `network` is not `false`. Requests made before the scanner mounted are not captured — use [startup capture](#capturing-startup-logs). |
| Response body missing | The content type is not text-shaped, the body exceeded 512 KB, or another wrapper consumed it first. Metadata is still recorded. |
| Copy fails | Clipboard permissions blocked it — select and copy the displayed text manually. |
| Styles look wrong | Ensure only one copy of the package is installed; the stylesheet injects once per document. |

## Contributing

Architecture, data flow, lifecycle ownership, and a file-by-file guide live in [flow.md](./flow.md).

## License

MIT
