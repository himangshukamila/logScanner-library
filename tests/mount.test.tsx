// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode, useEffect } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrowserStore, registerBrowserCaptureVisibility } from '../src/browser/index.js';
import { LOG_LEVELS } from '../src/core/types.js';
import { mountLogScanner, type MountedLogScanner } from '../src/react/mountLogScanner.js';

class TestEventSource extends EventTarget {
  static instances: TestEventSource[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });

  constructor(readonly url: string) {
    super();
    TestEventSource.instances.push(this);
  }
}

const sessions: MountedLogScanner[] = [];
const appRoots: Root[] = [];
let releaseVisibility = () => {};

beforeEach(() => {
  releaseVisibility = registerBrowserCaptureVisibility(true);
  getBrowserStore().clear();
  getBrowserStore().setMaxLogs(500);
  window.sessionStorage.clear();
  TestEventSource.instances = [];
  vi.stubGlobal('EventSource', TestEventSource);
  for (const level of LOG_LEVELS) vi.spyOn(window.console, level).mockImplementation(() => {});
});

afterEach(() => {
  act(() => {
    for (const root of appRoots.splice(0)) root.unmount();
    for (const session of sessions.splice(0)) session.dispose();
  });
  releaseVisibility();
  getBrowserStore().clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('standalone scanner', () => {
  it('is inert by default and when visible overrides enabled with false', () => {
    const nativeLog = window.console.log;
    act(() => {
      sessions.push(mountLogScanner({ serverUrl: '/logs' }));
      sessions.push(mountLogScanner({ visible: false, enabled: true, serverUrl: '/logs' }));
    });
    expect(document.querySelector('[data-logscan-root]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Log Scanner' })).not.toBeInTheDocument();
    expect(TestEventSource.instances).toHaveLength(0);
    expect(window.console.log).toBe(nativeLog);
  });

  it('captures synchronously before its independent React root commits', async () => {
    act(() => {
      sessions.push(mountLogScanner({ visible: true, network: false }));
      window.console.warn('Startup before React commits');
      expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['Startup before React commits']);
    });
    expect(document.querySelector('[data-logscan-root]')).toHaveAttribute('hidden');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Log Scanner' }));
    expect(screen.getByText('Startup before React commits')).toBeInTheDocument();
    expect(getBrowserStore().getSnapshot()).toHaveLength(1);
  });

  it('merges updates, shuts capture and streaming down while hidden, and resumes once', async () => {
    const nativeLog = window.console.log;
    let scanner!: MountedLogScanner;
    act(() => {
      scanner = mountLogScanner({ visible: true, network: false, serverUrl: '/logs', maxLogs: 2 });
      sessions.push(scanner);
    });
    const firstStream = TestEventSource.instances[0]!;
    expect(firstStream.url).toContain('/logs');
    act(() => {
      scanner.update({ visible: false });
      expect(window.console.log).toBe(nativeLog);
      window.console.log('hidden entry');
    });
    expect(firstStream.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Open Log Scanner' })).not.toBeInTheDocument();
    expect(getBrowserStore().getSnapshot()).toHaveLength(0);

    act(() => {
      scanner.update({ visible: true, position: 'top-left' });
      window.console.log('one');
      window.console.log('two');
      window.console.log('three');
    });
    expect(TestEventSource.instances).toHaveLength(2);
    expect(TestEventSource.instances[1]?.url).toContain('/logs');
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['two', 'three']);
    expect(await screen.findByRole('button', { name: 'Open Log Scanner' })).toBeInTheDocument();
    act(() => { scanner.dispose(); scanner.dispose(); scanner.update({ visible: true }); });
    expect(TestEventSource.instances[1]?.close).toHaveBeenCalledOnce();
    expect(window.console.log).toBe(nativeLog);
    expect(document.querySelector('[data-logscan-root]')).toBeNull();
  });

  it('keeps the viewer and error history after an unrelated application root crashes', async () => {
    act(() => { sessions.push(mountLogScanner({ visible: true, network: false })); });
    const appContainer = document.createElement('main');
    document.body.appendChild(appContainer);
    const onUncaughtError = vi.fn((error: unknown) => {
      window.dispatchEvent(new ErrorEvent('error', { error, message: String(error), cancelable: true }));
    });
    const appRoot = createRoot(appContainer, { onUncaughtError });
    appRoots.push(appRoot);
    act(() => { appRoot.render(<p>Healthy application</p>); });
    expect(screen.getByText('Healthy application')).toBeInTheDocument();
    function BrokenApp(): never { throw new Error('Application render crashed'); }
    // Run outside act: React reports this uncaught root failure through its configured callback.
    appRoot.render(<BrokenApp />);
    await waitFor(() => { expect(onUncaughtError).toHaveBeenCalledOnce(); });
    expect(screen.queryByText('Healthy application')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    await screen.findByText(/Application render crashed/);
    expect(screen.getByRole('region', { name: 'Log Scanner' })).toBeInTheDocument();
    act(() => { appRoot.unmount(); });
    appRoots.splice(appRoots.indexOf(appRoot), 1);
    expect(screen.getByRole('region', { name: 'Log Scanner' })).toBeInTheDocument();
  });

  it('replaces repeated mounts without duplicate roots and ignores stale handles', async () => {
    let first!: MountedLogScanner;
    let second!: MountedLogScanner;
    act(() => {
      first = mountLogScanner({ visible: true, network: false });
      sessions.push(first);
    });
    act(() => {
      second = mountLogScanner({ visible: true, network: false });
      sessions.push(second);
      first.dispose();
      first.update({ visible: false });
      window.console.log('replacement only once');
    });
    expect(document.querySelectorAll('[data-logscan-root]')).toHaveLength(1);
    expect(await screen.findAllByRole('button', { name: 'Open Log Scanner' })).toHaveLength(1);
    expect(getBrowserStore().getSnapshot().filter(entry => entry.message === 'replacement only once')).toHaveLength(1);
  });

  it('continues honoring another root visibility veto and cleans stale HMR handles', async () => {
    const releaseHiddenRoot = registerBrowserCaptureVisibility(false);
    let first!: MountedLogScanner;
    act(() => {
      first = mountLogScanner({ visible: true, network: false });
      sessions.push(first);
      window.console.log('vetoed');
    });
    expect(getBrowserStore().getSnapshot()).toHaveLength(0);
    releaseHiddenRoot();
    vi.resetModules();
    const reloaded = await import('../src/react/mountLogScanner.js');
    act(() => {
      sessions.push(reloaded.mountLogScanner({ visible: true, network: false }));
      first.dispose();
      first.update({ visible: false });
      window.console.log('new module');
    });
    expect(document.querySelectorAll('[data-logscan-root]')).toHaveLength(1);
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['new module']);
  });

  it('keeps one viewer while application StrictMode effects emit their two real calls', () => {
    act(() => { sessions.push(mountLogScanner({ visible: true, network: false })); });
    function Application() {
      useEffect(() => { window.console.info('Application effect'); }, []);
      return <p>StrictMode application</p>;
    }
    const appContainer = document.createElement('main');
    document.body.appendChild(appContainer);
    const appRoot = createRoot(appContainer);
    appRoots.push(appRoot);
    act(() => { appRoot.render(<StrictMode><Application /></StrictMode>); });
    expect(screen.getAllByRole('button', { name: 'Open Log Scanner' })).toHaveLength(1);
    expect(getBrowserStore().getSnapshot().filter(entry => entry.message === 'Application effect')).toHaveLength(2);
  });

  it('captures before body exists and removes its pending DOM-ready listener on disposal', () => {
    const body = document.body;
    const nativeLog = window.console.log;
    const removeListener = vi.spyOn(document, 'removeEventListener');
    body.remove();
    let scanner!: MountedLogScanner;
    try {
      act(() => {
        scanner = mountLogScanner({ visible: true, network: false });
        sessions.push(scanner);
        window.console.log('before document body');
      });
      expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['before document body']);
      expect(document.querySelector('[data-logscan-root]')).toBeNull();
      act(() => { scanner.dispose(); });
      expect(removeListener.mock.calls.some(([name]) => name === 'DOMContentLoaded')).toBe(true);
      expect(window.console.log).toBe(nativeLog);
    } finally {
      document.documentElement.appendChild(body);
    }
    act(() => { document.dispatchEvent(new Event('DOMContentLoaded')); });
    expect(document.querySelector('[data-logscan-root]')).toBeNull();
  });

  it('mounts its waiting viewer once body becomes available', async () => {
    const body = document.body;
    body.remove();
    try {
      act(() => { sessions.push(mountLogScanner({ visible: true, network: false })); });
    } finally {
      document.documentElement.appendChild(body);
    }
    act(() => { document.dispatchEvent(new Event('DOMContentLoaded')); });
    expect(await screen.findByRole('button', { name: 'Open Log Scanner' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-logscan-root]')).toHaveLength(1);
  });
});
