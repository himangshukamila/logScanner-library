'use client';

import { createRoot, type Root } from 'react-dom/client';
import { installBrowserCapture, registerBrowserCaptureVisibility } from '../browser/index.js';
import { LogScanner, type LogScannerProps } from './LogScanner.js';

export interface MountedLogScanner {
  /** Merge new props into this standalone scanner's current configuration. */
  update(options: Partial<LogScannerProps>): void;
  /** Release this scanner's root, capture ownership, listeners, and connection. */
  dispose(): void;
}

const sessionKey = Symbol.for('logscan.standalone-root.v1');

/** Mount outside the application root so its render failures cannot unmount the viewer. */
export function mountLogScanner(initialOptions: LogScannerProps): MountedLogScanner {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { update() {}, dispose() {} };
  }

  const registry = globalThis as typeof globalThis & { [sessionKey]?: MountedLogScanner };
  registry[sessionKey]?.dispose();

  let options = { ...initialOptions };
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let releaseCapture: (() => void) | undefined;
  let releaseVisibility: (() => void) | undefined;
  let waitingForBody = false;
  let disposed = false;

  function stopWaiting(): void {
    if (!waitingForBody) return;
    waitingForBody = false;
    document.removeEventListener('DOMContentLoaded', renderScanner);
  }

  function renderScanner(): void {
    if (disposed) return;
    if (!(options.visible ?? options.enabled ?? false)) {
      stopWaiting();
      root?.render(null);
      return;
    }
    if (!document.body) {
      if (!waitingForBody) {
        waitingForBody = true;
        document.addEventListener('DOMContentLoaded', renderScanner);
      }
      return;
    }
    stopWaiting();
    if (!root) {
      container = document.createElement('div');
      container.setAttribute('data-logscan-root', '');
      // The scanner portals into body; the empty React host must not alter app layout.
      container.hidden = true;
      document.body.appendChild(container);
      root = createRoot(container);
    }
    root.render(<LogScanner {...options} />);
  }

  function applyOptions(): void {
    const active = options.visible ?? options.enabled ?? false;
    // Replace ownership before releasing the previous token to avoid a visibility gap.
    const nextVisibility = registerBrowserCaptureVisibility(active);
    releaseVisibility?.();
    releaseVisibility = nextVisibility;
    const nextCapture = active
      ? installBrowserCapture({ maxLogs: options.maxLogs ?? 500, network: options.network ?? true })
      : undefined;
    releaseCapture?.();
    releaseCapture = nextCapture;
    renderScanner();
  }

  const session: MountedLogScanner = {
    update(nextOptions) {
      if (disposed) return;
      options = { ...options, ...nextOptions };
      applyOptions();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopWaiting();
      const releaseSuspension = registerBrowserCaptureVisibility(false);
      try {
        root?.unmount();
      } finally {
        root = undefined;
        container?.remove();
        container = undefined;
        releaseCapture?.();
        releaseCapture = undefined;
        releaseVisibility?.();
        releaseVisibility = undefined;
        releaseSuspension();
        if (registry[sessionKey] === session) delete registry[sessionKey];
      }
    },
  };
  registry[sessionKey] = session;
  try {
    applyOptions();
  } catch (error) {
    session.dispose();
    throw error;
  }
  return session;
}
