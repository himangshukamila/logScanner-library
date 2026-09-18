import { installConsoleCapture } from '../core/console.js';
import { createLogEntry } from '../core/serialize.js';
import { createLogStore, type LogStore } from '../core/store.js';
import { installNetworkCapture } from './network.js';

interface BrowserState {
  store: LogStore;
  users: number;
  visible: boolean;
  network: boolean;
  controllers: Map<symbol, boolean>;
  cleanup?: () => void;
  networkCleanup?: () => void;
}

const stateKey = Symbol.for('log-scanner.browser-state.v1');

function getState(): BrowserState {
  const global = globalThis as typeof globalThis & { [stateKey]?: BrowserState };
  const state = global[stateKey] ??= { store: createLogStore(), users: 0, visible: true, network: true, controllers: new Map() };
  // An existing session may have been created before these fields were added by HMR.
  state.visible ??= true;
  state.network ??= true;
  state.controllers ??= new Map();
  return state;
}

export function getBrowserStore(): LogStore { return getState().store; }

function syncNetworkCapture(state: BrowserState, active: boolean): void {
  if (active && state.network && !state.networkCleanup) {
    state.networkCleanup = installNetworkCapture((entry) => state.store.append(entry));
    return;
  }
  if (active && state.network) return;
  const cleanup = state.networkCleanup;
  state.networkCleanup = undefined;
  cleanup?.();
}

function syncCapture(state: BrowserState): void {
  const active = state.visible && state.users > 0;
  syncNetworkCapture(state, active);
  if (!active) {
    const cleanup = state.cleanup;
    state.cleanup = undefined;
    cleanup?.();
    return;
  }
  if (state.cleanup) return;

  const restoreConsole = installConsoleCapture(window.console, (level, args) => {
    state.store.append(createLogEntry('browser', level, args));
  });
  const onError = (event: ErrorEvent): void => {
    const location = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
    state.store.append(createLogEntry('browser', 'error', [event.error ?? `${event.message}${location}`]));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    state.store.append(createLogEntry('browser', 'error', ['Unhandled promise rejection:', event.reason]));
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  state.cleanup = () => {
    restoreConsole();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Internal root ownership: any hidden root suspends capture, including startup leases. */
export function registerBrowserCaptureVisibility(visible: boolean): () => void {
  if (typeof window === 'undefined') return () => {};
  const state = getState();
  const token = Symbol('scanner-visibility');
  state.controllers.set(token, visible);
  state.visible = [...state.controllers.values()].every(Boolean);
  syncCapture(state);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    state.controllers.delete(token);
    // Startup leases may resume with a future root, but cannot outlive the final root.
    state.visible = state.controllers.size > 0 && [...state.controllers.values()].every(Boolean);
    syncCapture(state);
  };
}

/** Install before React mounts to include startup logs. Call its returned function on teardown. */
export function installBrowserCapture(options: { maxLogs?: number; network?: boolean } = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const state = getState();
  if (options.maxLogs !== undefined) state.store.setMaxLogs(options.maxLogs);
  if (options.network !== undefined) state.network = options.network;
  state.users++;
  syncCapture(state);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    state.users--;
    syncCapture(state);
  };
}
