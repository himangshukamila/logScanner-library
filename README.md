# logscan

**See your app's console output inside your app.** A development-only React panel for console messages, network previews, and optional local Node.js logs. Mount it independently to keep the viewer available when your application React root crashes.

[![npm](https://img.shields.io/npm/v/logscan.svg)](https://www.npmjs.com/package/logscan)
[![license](https://img.shields.io/npm/l/logscan.svg)](https://www.npmjs.com/package/logscan)
[![types](https://img.shields.io/badge/types-included-blue.svg)](#typescript)

Keep using `console.log()`, `console.info()`, `console.warn()`, `console.error()`, and `console.debug()`. Their normal browser and terminal output stays exactly as it is — the panel just shows a bounded copy, so you can debug on a phone, in a kiosk, on a device without DevTools, or next to the UI you're actually looking at.

---

## Install

```sh
npm install logscan
```

React and ReactDOM 18.3 or 19 are peer dependencies. Styles load automatically; consumers do not need Tailwind.

## Quick start

Initialize one standalone scanner in your browser entry file, before rendering the application:

```tsx
// main.tsx — Vite example
import { createRoot } from 'react-dom/client';
import { mountLogScanner } from 'logscan';

const scanner = mountLogScanner({ visible: import.meta.env.DEV });
import.meta.hot?.dispose(() => scanner.dispose());

const { App } = await import('./App');
const element = document.getElementById('root');
if (!element) throw new Error('Missing root element');
createRoot(element).render(<App />);
```

The scanner owns a separate React root attached to the page. Application-root render failures and unmounts cannot remove that root. Capture starts synchronously when `mountLogScanner` is called with visibility enabled; the dynamic import also lets it observe logs from application module initialization.

Keep logging normally:

```ts
console.log('Cart updated', { items: 3, total: 42 });
console.warn('Retrying request', { attempt: 2 });
console.error(new Error('Checkout failed'));
```

A logo button appears in the bottom-right corner. Click it to open the panel, search, filter, expand arguments, and copy entries.

`import.meta.env.DEV` is the Vite flag. Use your framework's development flag and browser initialization entry elsewhere. The helper is safe to import on the server and returns an inert handle when browser globals are absent.

Styles are injected automatically on mount. Importing CSS is optional (see [Styling](#styling)).

## Standalone API and props

`mountLogScanner(options: LogScannerProps)` returns a `MountedLogScanner`:

| Method | Behavior |
| --- | --- |
| `update(partialOptions)` | Merge props into the current configuration. Omitted props retain their previous values. |
| `dispose()` | Unmount the independent viewer and release its capture, stream, listeners, and container. Repeated calls are safe; subsequent updates do nothing. |

There is one standalone session per page. Calling `mountLogScanner` again disposes the previous session; stale handles cannot change the replacement. Initialize it in browser bootstrap and dispose it during hot reload or explicit teardown. If the document body is not ready, capture can start immediately and the viewer waits for `DOMContentLoaded`.

The helper and the JSX component accept the same options:

| Prop | Type | Default | Behavior |
| --- | --- | --- | --- |
| `visible` | `boolean` | `false` | The master switch. Controls the launcher, the panel, browser capture, and the server stream. |
| `position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Launcher corner and initial panel docking. A remembered rectangle is restored and clamped to the available viewport. |
| `network` | `boolean` | `true` | Capture `fetch` and `XMLHttpRequest` calls. See [Network capture](#network-capture). |
| `serverUrl` | `string` | — | Same-origin SSE endpoint for Node.js logs. Omit for browser-only capture. |
| `maxLogs` | `number` | `500` | Combined browser + network + server history size. Finite values are floored/clamped to `1`–`5000`; non-finite values use `500`. |
| `enabled` | `boolean` | `false` | **Deprecated.** Legacy fallback used only when `visible` is omitted. |

`visible` always wins: `<LogScanner visible={false} enabled />` stays off. Use `visible` in new code.

### Component integration

The original component remains available when application-owned lifetime is appropriate:

```tsx
import { LogScanner } from 'logscan';
import { App } from './App';

export function Root() {
  return <><App /><LogScanner visible={import.meta.env.DEV} /></>;
}
```

Its portal changes DOM placement, not React ownership. An ancestor crash or application-root unmount can still remove `<LogScanner />`. Use `mountLogScanner` for an independent viewer; do not mount both integrations in the same application.

## Features

| | |
| --- | --- |
| **Browser capture** | All five console methods, plus uncaught errors and unhandled promise rejections. |
| **Network capture** | `fetch` and `XMLHttpRequest` metadata with bounded request/response previews. |
| **Server logs** | Console output from an instrumented local Node.js process, streamed over SSE. Opt-in. |
| **Movable panel** | Drag the header; resize from either corner; adjust with the keyboard. Position survives reload. |
| **Search & filters** | Substring search combined with level and Browser/Network/Server source filters. |
| **Readable values** | Complete JSON objects/arrays are indented without rewriting numeric tokens; errors retain multiline stacks. Syntax colours aid inspection. |
| **Argument inspection** | Timestamps, level/source labels, and expandable snapshots of each argument. |
| **Copy & clear** | Copy the full entry, a response, or an individual detail section; clear retained history. |
| **Smart scrolling** | Follows new logs while you're at the bottom; scroll up to read without being yanked back. |
| **Bounded by design** | 500 entries by default, size-capped snapshots, batched renders — safe during log storms. |
| **Zero setup** | Self-injecting styles, inline SVG logo, no Tailwind and no image requests in your app. |
| **Independent viewer** | `mountLogScanner` keeps the viewer outside the application's React root. Shared capture supports StrictMode and hot reload; imports are SSR-safe. |
| **Accessible** | Keyboard drag/resize, focus management, live status regions, labelled controls. |
| **Typed** | TypeScript declarations for every export. |

## Using the panel

| Control | Behavior |
| --- | --- |
| Logo button | Open or close the panel. |
| Header | Drag with mouse or touch. When focused, arrows move 10px; Shift + arrows move 1px. |
| Top-left handle | Resize while pinning the bottom-right corner — useful for enlarging the docked panel. |
| Bottom-right handle | Resize while pinning the top-left corner. Both handles support arrows and Shift + arrows. |
| Filters | Reveal Level/Source controls; they start collapsed unless this tab remembers an expanded preference. Search and Clear always remain visible. |
| Search | Case-insensitive substring match on the message plus network URL, request body, and response body previews. |
| Level / Source | Combine severity and Browser/Network/Server filters with search. Collapsing controls keeps their filters applied; active filtering is indicated. Reset clears search and both selections. |
| Details | Expand captured arguments; network rows expose Response and request details. |
| Copy | Copies metadata and individually formatted console arguments, separated by newlines. Network entries include their summary, initiator, status, duration, URL, content type, and captured request/response bodies. |
| Copy response / section Copy | Copy the response preview directly, or copy an individual expanded argument, URL, body, or error section. Complete JSON containers are formatted for readability. |
| Clear | Clears the browser store, including filtered-out entries. Does not touch DevTools or server history. |
| Escape / close | Close the panel and return focus to the launcher. |

The panel opens at up to **640 × 512px**, with a usual minimum of **320 × 280px**, reduced for smaller viewports. Position, size, and expanded-filter preference are remembered in `sessionStorage`; unavailable storage falls back to in-memory behavior. Search and filter values reset when the scanner is hidden or unmounted. Opening the panel focuses search.

## Network capture

Supported `fetch` and `XMLHttpRequest` calls made while capture is active appear under the **Network** source filter:

```
POST  /api/checkout    200   142 ms
GET   /api/cart        404    18 ms
GET   /api/session          failed
```

Expand a row to see the full URL, content type, request body, and a preview of the response body. Status codes map onto levels, so the level filter works on traffic too: **2xx/3xx → info**, **4xx → warn**, **5xx and network failures → error**.

Capture is passive. Your request is passed through untouched, the response your code receives is the original one, and rejections still reject — the panel reads a clone.

| Detail | Behavior |
| --- | --- |
| Bodies | Each captured request/response preview has a 16 KiB budget, including JSON escaping. Truncated content is marked. These are previews, not guaranteed complete payloads. |
| Fetch content types | Text-shaped responses (`text/*`, JSON, XML, form-encoded) are eligible. Other types are described, for example `[image/png]`; `text/event-stream` is described without reading. |
| Large fetch responses | Skipped when declared `content-length` exceeds 512 KiB, with a size marker. |
| Preview work | At most eight fetch body previews run concurrently. Extra responses retain metadata with `[body preview skipped: busy]`. A preview times out after two seconds and its cloned reader is cancelled. |
| Timing and order | Duration uses `performance.now()` from request call to response settlement. Entries append when their preview finishes; timestamps retain response-settlement time, so later responses may appear first. |
| XHR | Text/JSON response types are previewed at `loadend`; other response types are described. The asynchronous fetch-preview limits do not govern XHR. |
| Failures | Rejected fetches retain a bounded error string; zero-status XHR is marked failed. Metadata remains available when body previewing fails. |
| Teardown | Hiding or disposing the scanner cancels owned clone previews and detaches XHR listeners. It does not abort the application's requests. |

Turn it off with `network={false}` if you don't want `fetch` patched:

```tsx
<LogScanner visible={import.meta.env.DEV} network={false} />
```

Uploads are described rather than copied (`[FormData] file, name`, `[Blob 4096 bytes]`), and a `Request` object's body is left untouched so it is never stolen from the caller.

## Toggling at runtime

Keep the handle returned by bootstrap and update it from your development controls:

```ts
scanner.update({ visible: false });
scanner.update({ visible: true, position: 'bottom-left' });
scanner.update({ network: false });
// Release the standalone session when it is no longer needed.
scanner.dispose();
```

For component integration, pass the same values as React props instead.

| Action | UI | Capture | History |
| --- | --- | --- | --- |
| Close the panel | Launcher stays | Continues | Kept |
| `visible={false}` | Everything hidden | Stops | Kept |
| `visible={true}` again | Launcher returns, panel closed | Resumes | Available again |
| Dispose standalone / unmount final component | Everything hidden | Stops, connections released | Kept for the page |
| Reload the page | New session | Follows the new config | Cleared |

Console calls emitted while capture is off cannot be recovered.

Use one integration per page. History and browser capture are shared globally; if several component scanners mount, any hidden one pauses the shared collector. Each active viewer still owns its own server connection.

The Node adapter has a separate lifetime. Browser visibility closes its connection but does not stop server capture; restoring visibility may replay server logs emitted while hidden.

## When the application crashes

The standalone viewer remains mounted when the application React root fails or unmounts. It records intercepted console calls, browser `error` events, and unhandled promise rejections. An error caught and silently consumed by an application error boundary is not observable; log it from the boundary's error callback if it should appear in the panel.

The scanner does not prevent crashes or recover application state. Reloads, navigation, document replacement, a crashed tab, or a blocked JavaScript thread can remove or stop it. `<LogScanner />` inside the application tree cannot survive removal of its ancestor simply because its DOM is portalled into `document.body`.

## Capturing startup logs

`mountLogScanner({ visible: true })` already captures synchronously, before its own React root commits. Use the quick-start dynamic import to include application module initialization.

For component integration, `<LogScanner />` starts capturing when its effect runs. An optional startup collector can bridge that gap:

```tsx
import { createRoot } from 'react-dom/client';
import { installBrowserCapture } from 'logscan';

const stopCapture = import.meta.env.DEV ? installBrowserCapture({ maxLogs: 500 }) : () => {};
import.meta.hot?.dispose(stopCapture);

const { Root } = await import('./Root');
const element = document.getElementById('root');
if (!element) throw new Error('Missing root element');
createRoot(element).render(<Root />);
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

```ts
scanner.update({ serverUrl: '/__log-scanner/events', maxLogs: 500 });
```

This updates the standalone handle from the quick start. For component integration, pass `serverUrl` and `maxLogs` as `<LogScanner />` props.

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

The server sends named `log` events with IDs. A known reconnect cursor replays newer retained entries; an absent or expired cursor replays available history. The browser suppresses recent duplicates by ID. A backend outage leaves browser capture running.

## Styling

The stylesheet injects into `<head>` once when an active viewer mounts. It uses compiled, `ls:`-prefixed Tailwind utilities without Preflight to avoid global resets. This is not Shadow DOM isolation: broad application CSS can still affect shared elements or inheritance. The logo is inline SVG; it needs no image file or request.

The compiled stylesheet also remains available as an explicit import; automatic injection still runs:

```ts
import 'logscan/styles.css';
```

## Entry points

| Import | Exports |
| --- | --- |
| `logscan` | `mountLogScanner`, `LogScanner`, `installBrowserCapture`, and public types. |
| `logscan/node` | `createNodeLogScanner` — **server code only**. |
| `logscan/styles.css` | Compiled stylesheet (optional). |

### TypeScript

```ts
import type { MountedLogScanner, LogScannerProps, LauncherPosition, LogEntry, LogLevel, LogSource, NetworkInfo } from 'logscan';
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

Imports do not install capture. In the browser, the standalone helper/startup installer begin immediately when enabled; the component begins in its effect. On the server, standalone and startup calls are inert.

## Limits

- **Log history stays in memory.** Reloads and restarts end their respective sessions. Only panel geometry and the expanded-filter preference are stored in `sessionStorage`.
- **Snapshots, not live objects.** Previews are bounded by argument count, depth, and size. Ordinary/custom getters and `toJSON()` are skipped; supported native Error stack accessors may be read under guards so browser error stacks remain visible. Proxy reflection can still invoke traps.
- **Console scope.** `%c` and `%s` formatting is not interpreted. `console.group`, `console.table`, and other methods outside the five intercepted levels are not captured. Wrapping the console can affect source-link attribution.
- **Network scope.** `fetch` and `XMLHttpRequest` only. Requests from service workers, `sendBeacon`, WebSocket and EventSource traffic, and anything issued before capture installs are not recorded. Request/response *headers* are not captured beyond content type.
- **Scope.** The current browser realm and the instrumented Node process. Workers, other frames, subprocess output, raw stdout writes, and Pino/Winston transports are out of scope.
- **StrictMode.** Shared wrappers prevent duplicate interception, but genuine double-logging from your own effects still shows twice — as it should.
- **Development tool.** Guard `visible` (and any startup collector) with your dev flag. The Node adapter additionally refuses to run under `NODE_ENV=production`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No launcher appears | Capture defaults to off — verify `visible`, your dev flag, and that the component actually mounts. |
| Viewer disappears with an app crash | Use `mountLogScanner` before creating the application root. A JSX scanner still belongs to its ancestor React tree. |
| A caught error is missing | Log it from the application's error-boundary/catch callback; swallowed errors produce no console or browser error event. |
| Earlier logs are missing | Install [startup capture](#capturing-startup-logs) before dynamically importing your app. |
| Capture stops unexpectedly | Another mounted scanner may be hidden; use a single root scanner. |
| "Use a server stream URL on this page's origin" | Use a relative, proxied path. Direct backend URLs on another port are rejected. |
| Stream returns 404 | Check the exact route, `enabled`, and `NODE_ENV`. Disabled or disposed adapters return 404. |
| Stream returns 403 | Check loopback binding, `Host`/`Origin`, and `allowedOrigins`. `localhost` and `127.0.0.1` are *different* origins. |
| Stream returns 503 | The 32-client limit was reached; close stale tabs. |
| Stuck on "Reconnecting" | Check the backend and proxy. Browser capture keeps working regardless. |
| Cleared logs reappear | A fresh stream replays the Node adapter's retained history. Clear only affects the browser store. |
| No network rows | Check `network` is not `false`. Requests made before the scanner mounted are not captured — use [startup capture](#capturing-startup-logs). |
| Response body missing | Inspect its marker: unsupported type, stream, declared large body, preview concurrency limit, timeout, or clone/read failure. Metadata is still recorded. |
| Copy fails | Clipboard permissions blocked it — select and copy the displayed text manually. |
| Styles look wrong | Ensure only one copy of the package is installed; the stylesheet injects once per document. |

## Contributing

Architecture, data flow, lifecycle ownership, and a file-by-file guide live in [flow.md](./flow.md).

## License

MIT
