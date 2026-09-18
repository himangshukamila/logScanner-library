// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogScanner } from '../src/react/LogScanner';
import { getBrowserStore, installBrowserCapture, registerBrowserCaptureVisibility } from '../src/browser';
import { LOG_LEVELS, type LogEntry } from '../src/core/types';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

class TestEventSource extends EventTarget {
  static instances: TestEventSource[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });

  constructor(readonly url: string) {
    super();
    TestEventSource.instances.push(this);
  }

  emitLog(data: unknown) {
    this.dispatchEvent(new MessageEvent('log', { data: typeof data === 'string' ? data : JSON.stringify(data) }));
  }

  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
}

function serverEntry(id = 'server-1', message = 'Server request completed'): LogEntry {
  return { id, message, source: 'server', level: 'info', timestamp: 1_700_000_000_000, args: [message] };
}

beforeEach(() => {
  window.sessionStorage.clear();
  getBrowserStore().clear();
  getBrowserStore().setMaxLogs(500);
  TestEventSource.instances = [];
  vi.stubGlobal('EventSource', TestEventSource);
  for (const level of LOG_LEVELS) vi.spyOn(window.console, level).mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  getBrowserStore().clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('LogScanner', () => {
  it('uses an inline logo-only launcher when visible is true', () => {
    render(<LogScanner visible />);
    const launcher = screen.getByRole('button', { name: 'Open Log Scanner' });
    expect(launcher.textContent).toBe('');
    expect(within(launcher).getByRole('img', { name: 'Log Scanner' }).tagName).toBe('svg');
    expect(launcher.querySelector('img')).toBeNull();
  });

  it('collapses the filter toolbar, keeps its filters applied, and remembers the choice', async () => {
    const view = render(<LogScanner visible network={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    act(() => { window.console.log('Kept row'); window.console.warn('Hidden row'); });
    await screen.findByText('Kept row');

    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'log' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Hide filters' }));
    expect(screen.queryByRole('searchbox', { name: 'Search logs' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Level')).not.toBeInTheDocument();
    // The level filter is out of sight but still narrowing the list.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByLabelText('1 matching of 2 captured logs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show filters' })).toHaveAttribute('aria-expanded', 'false');
    expect(window.sessionStorage.getItem('logscan.filters-open.v1')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search logs' })).toHaveFocus();

    // A later session opens collapsed and focuses the log list instead of the missing search field.
    fireEvent.click(screen.getByRole('button', { name: 'Hide filters' }));
    view.unmount();
    render(<LogScanner visible network={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    expect(screen.queryByRole('searchbox', { name: 'Search logs' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Captured logs')).toHaveFocus();
  });

  it('places the launcher in the requested corner above application stacking contexts', () => {
    const { rerender } = render(<LogScanner visible />);
    const launcher = screen.getByRole('button', { name: 'Open Log Scanner' });
    expect(launcher.className).toContain('ls:right-3');
    expect(launcher.className).toContain('ls:bottom-3');
    expect(launcher.parentElement?.className).toContain('ls:z-[2147483647]');

    rerender(<LogScanner visible position="top-left" />);
    const moved = screen.getByRole('button', { name: 'Open Log Scanner' });
    expect(moved.className).toContain('ls:left-3');
    expect(moved.className).toContain('ls:top-3');
    expect(moved.className).not.toContain('ls:right-3');
    expect(moved.className).not.toContain('ls:bottom-3');
  });

  it('colours serialized values and filters captured requests by the network source', async () => {
    render(<LogScanner visible network={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    act(() => { window.console.log('Cart', { total: 42, paid: true, note: 'ok' }); });
    await screen.findByText(/Cart/);

    const message = screen.getByRole('listitem').querySelector('p')!;
    expect(message.querySelector('.ls\\:text-violet-300')?.textContent).toBe('42');
    expect(message.querySelector('.ls\\:text-sky-300')?.textContent).toBe('true');
    expect(message.querySelector('.ls\\:text-emerald-300')?.textContent).toBe('"ok"');
    expect(message.querySelector('.ls\\:text-neutral-400')?.textContent).toBe('"total"');

    act(() => {
      getBrowserStore().append({
        id: 'network-1',
        timestamp: 1_700_000_000_000,
        level: 'warn',
        source: 'network',
        args: [],
        message: 'GET /api/cart → 404 · 12 ms',
        network: { method: 'GET', url: 'http://localhost/api/cart', label: '/api/cart', initiator: 'fetch', durationMs: 12, status: 404 },
      });
    });
    await screen.findByText('/api/cart');
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'network' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.queryByText(/Cart,/)).not.toBeInTheDocument();
  });

  it('gives every logo instance its own gradient id', () => {
    render(<><LogScanner visible /><LogScanner visible /></>);
    const gradients = [...document.querySelectorAll('linearGradient')].map((node) => node.id);
    expect(gradients.length).toBeGreaterThan(1);
    expect(new Set(gradients).size).toBe(gradients.length);
    for (const id of gradients) {
      expect(id).not.toContain(':');
      expect(document.querySelector(`g[stroke="url(#${id})"]`)).not.toBeNull();
    }
  });

  it('visible overrides enabled and shuts down startup capture and streaming', () => {
    const originalLog = window.console.log;
    const releaseOwner = registerBrowserCaptureVisibility(true);
    const stopEarly = installBrowserCapture();
    let unmount = () => {};
    try {
      window.console.log('Early startup log');
      const view = render(<LogScanner visible={false} enabled serverUrl="/logs" />);
      unmount = view.unmount;
      expect(screen.queryByRole('button', { name: 'Open Log Scanner' })).not.toBeInTheDocument();
      expect(TestEventSource.instances).toHaveLength(0);
      expect(window.console.log).toBe(originalLog);
      window.console.log('Hidden log');
      expect(getBrowserStore().getSnapshot().map((entry) => entry.message)).toEqual(['Early startup log']);

      view.rerender(<LogScanner visible enabled={false} serverUrl="/logs" />);
      expect(screen.getByRole('button', { name: 'Open Log Scanner' })).toBeInTheDocument();
      expect(TestEventSource.instances).toHaveLength(1);
      act(() => { window.console.log('Visible log'); });
      expect(getBrowserStore().getSnapshot().map((entry) => entry.message)).toEqual(['Early startup log', 'Visible log']);

      view.rerender(<LogScanner visible={false} enabled serverUrl="/logs" />);
      expect(TestEventSource.instances[0]!.close).toHaveBeenCalledOnce();
      expect(window.console.log).toBe(originalLog);
      window.console.warn('Still hidden');
      expect(getBrowserStore().getSnapshot()).toHaveLength(2);
    } finally {
      unmount();
      stopEarly();
      releaseOwner();
    }
  });

  it('releases startup capture when the final scanner unmounts', () => {
    const originalLog = window.console.log;
    const stopEarly = installBrowserCapture();
    const { unmount } = render(<LogScanner visible serverUrl="/logs" />);
    expect(window.console.log).not.toBe(originalLog);
    unmount();
    expect(window.console.log).toBe(originalLog);
    expect(TestEventSource.instances[0]!.close).toHaveBeenCalledOnce();
    window.console.log('After unmount');
    expect(getBrowserStore().getSnapshot()).toHaveLength(0);
    stopEarly();
  });

  it('is inert by default and when explicitly disabled', () => {
    const nativeLog = window.console.log;
    const { rerender } = render(<LogScanner serverUrl="/logs" />);
    expect(screen.queryByRole('button', { name: 'Open Log Scanner' })).not.toBeInTheDocument();
    expect(window.console.log).toBe(nativeLog);
    expect(TestEventSource.instances).toHaveLength(0);
    rerender(<LogScanner enabled={false} serverUrl="/logs" />);
    expect(TestEventSource.instances).toHaveLength(0);
  });

  it('renders safely on the server without installing capture or opening a stream', () => {
    const nativeLog = window.console.log;
    expect(renderToString(<LogScanner enabled serverUrl="/logs" />)).toBe('');
    expect(window.console.log).toBe(nativeLog);
    expect(TestEventSource.instances).toHaveLength(0);
  });

  it('captures once in StrictMode, filters logs, and restores focus and console on teardown', async () => {
    const nativeLog = window.console.log;
    const { unmount } = render(<StrictMode><LogScanner enabled /></StrictMode>);
    const launcher = screen.getByRole('button', { name: 'Open Log Scanner' });
    fireEvent.click(launcher);
    expect(screen.getByRole('searchbox', { name: 'Search logs' })).toHaveFocus();

    act(() => { window.console.log('Order saved'); window.console.warn('Payment delayed'); });
    await screen.findByText('Order saved');
    expect(getBrowserStore().getSnapshot()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'warn' } });
    expect(screen.queryByText('Order saved')).not.toBeInTheDocument();
    expect(screen.getByText('Payment delayed')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching logs')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(launcher).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Log Scanner' })).not.toBeInTheDocument();
    unmount();
    expect(window.console.log).toBe(nativeLog);
  });

  it('streams valid server logs, ignores malformed data and replay duplicates, and closes the stream', async () => {
    const { unmount } = render(<StrictMode><LogScanner enabled serverUrl="/logs" /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    const stream = TestEventSource.instances.at(-1)!;
    expect(TestEventSource.instances[0]?.close).toHaveBeenCalledOnce();
    act(() => {
      stream.open();
      stream.emitLog(serverEntry());
      stream.emitLog(serverEntry());
      stream.emitLog('{broken JSON');
      stream.emitLog({ ...serverEntry('wrong-source'), source: 'browser' });
      stream.emitLog({ ...serverEntry('invalid-date'), timestamp: 1e30 });
      stream.emitLog('x'.repeat(16_385));
      stream.emitLog({ ...serverEntry('too-many-bytes'), message: '🙂'.repeat(5_000), args: [] });
    });
    await screen.findByText('Server request completed');
    expect(getBrowserStore().getSnapshot()).toHaveLength(1);
    expect(Object.isFrozen(getBrowserStore().getSnapshot()[0])).toBe(true);
    expect(Object.isFrozen(getBrowserStore().getSnapshot()[0]?.args)).toBe(true);
    expect(screen.getByText('Connected. Ignored an invalid server log.')).toBeInTheDocument();

    act(() => { stream.dispatchEvent(new Event('error')); });
    expect(screen.getByText('Reconnecting to server… Browser logs remain available.')).toBeInTheDocument();
    act(() => { stream.open(); });
    expect(screen.getByText('Browser + server connected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'browser' } });
    expect(screen.queryByText('Server request completed')).not.toBeInTheDocument();
    unmount();
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it('deduplicates shared streams and replayed server rows after a remount', () => {
    const { unmount } = render(<><LogScanner enabled serverUrl="/logs" /><LogScanner enabled serverUrl="/logs" /></>);
    const [first, second] = TestEventSource.instances;
    act(() => {
      first!.emitLog(serverEntry());
      second!.emitLog(serverEntry());
    });
    expect(getBrowserStore().getSnapshot()).toHaveLength(1);
    unmount();
    expect(first!.close).toHaveBeenCalledOnce();
    expect(second!.close).toHaveBeenCalledOnce();
    render(<LogScanner enabled serverUrl="/logs" />);
    act(() => {
      TestEventSource.instances.at(-1)!.emitLog(serverEntry());
      TestEventSource.instances.at(-1)!.emitLog(serverEntry('server-2', 'New server log'));
    });
    expect(getBrowserStore().getSnapshot().map((entry) => entry.id)).toEqual(['server-1', 'server-2']);
  });

  it('returns to the default buffer size when maxLogs is removed', () => {
    const { rerender } = render(<LogScanner enabled maxLogs={1} />);
    act(() => { window.console.log('Discarded'); window.console.log('Retained'); });
    expect(getBrowserStore().getSnapshot()).toHaveLength(1);
    rerender(<LogScanner enabled />);
    act(() => { window.console.log('Another retained row'); });
    expect(getBrowserStore().getSnapshot()).toHaveLength(2);
  });

  it('refuses a cross-origin server URL while retaining browser capture', async () => {
    render(<LogScanner enabled serverUrl="https://other.example/logs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    expect(TestEventSource.instances).toHaveLength(0);
    expect(screen.getByText('Use a server stream URL on this page’s origin.')).toBeInTheDocument();
    act(() => { window.console.info('Browser is available'); });
    await screen.findByText('Browser is available');
  });

  it('shows clipboard progress and failure, then clears logs', async () => {
    let rejectCopy: (reason?: unknown) => void = () => {};
    const writeText = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectCopy = reject; }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<LogScanner enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    act(() => { window.console.log('Copy this entry'); });
    await screen.findByText('Copy this entry');
    fireEvent.click(screen.getByRole('button', { name: 'Copy log entry' }));
    expect(screen.getByRole('button', { name: 'Copy log entry' })).toBeDisabled();
    expect(screen.getByText('Copying log…')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Copy this entry'));
    await act(async () => { rejectCopy(new Error('Permission denied')); });
    expect(screen.getByText('Copy failed. Select and copy the log text manually.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await screen.findByText('Listening for logs');
    expect(getBrowserStore().getSnapshot()).toHaveLength(0);
  });

  it('ignores a clipboard completion after its row is unmounted', async () => {
    let resolveCopy: () => void = () => {};
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => new Promise<void>((resolve) => { resolveCopy = resolve; })) },
    });
    render(<LogScanner enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    act(() => { window.console.log('Pending copy'); });
    await screen.findByText('Pending copy');
    fireEvent.click(screen.getByRole('button', { name: 'Copy log entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close log panel' }));
    await act(async () => { resolveCopy(); });
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    expect(screen.queryByText('Log copied to clipboard.')).not.toBeInTheDocument();
    expect(screen.queryByText('Copying log…')).not.toBeInTheDocument();
  });

  it('keeps the newest clipboard status when earlier copies settle later', async () => {
    const pending: Array<{ resolve: () => void; reject: (reason?: unknown) => void }> = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }); })) },
    });
    render(<LogScanner enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    act(() => { window.console.log('First copy'); window.console.warn('Second copy'); });
    await screen.findByText('Second copy');
    fireEvent.click(screen.getByRole('button', { name: 'Copy log entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy warn entry' }));
    await act(async () => { pending[1]!.resolve(); });
    expect(screen.getByText('Log copied to clipboard.')).toBeInTheDocument();
    await act(async () => { pending[0]!.reject(new Error('Late failure')); });
    expect(screen.getByText('Log copied to clipboard.')).toBeInTheDocument();
    expect(screen.queryByText('Copy failed. Select and copy the log text manually.')).not.toBeInTheDocument();
  });

  it('does not force-scroll while the user reads older messages', async () => {
    render(<LogScanner enabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Log Scanner' }));
    const list = screen.getByLabelText('Captured logs');
    Object.defineProperties(list, { scrollHeight: { value: 1_000 }, clientHeight: { value: 200 } });
    act(() => { window.console.log('First row'); });
    await screen.findByText('First row');
    await waitFor(() => { expect(list.scrollTop).toBe(1_000); });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    act(() => { window.console.log('Second row'); });
    await screen.findByText('Second row');
    expect(list.scrollTop).toBe(100);
  });
});
