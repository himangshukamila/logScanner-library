import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConsoleCapture } from '../src/core/console';
import { createLogEntry } from '../src/core/serialize';
import { createLogStore } from '../src/core/store';
import { LOG_LEVELS, normalizeMaxLogs } from '../src/core/types';

afterEach(() => vi.useRealTimers());

describe('safe log snapshots', () => {
  it('captures multiple arguments, errors, bigint and circular objects without invoking getters', () => {
    const getter = vi.fn(() => { throw new Error('must not be called'); });
    const object: Record<string, unknown> = { value: 42, big: 123n };
    object.self = object;
    Object.defineProperty(object, 'dangerous', { enumerable: true, get: getter });
    const entry = createLogEntry('browser', 'warn', ['hello', object, new TypeError('broken')]);
    object.value = 99;
    expect(entry.args).toHaveLength(3);
    expect(entry.message).toContain('hello');
    expect(entry.message).toContain('42');
    expect(entry.message).not.toContain('99');
    expect(entry.message).toContain('123n');
    expect(entry.message).toContain('[Circular]');
    expect(entry.message).toContain('[Getter]');
    expect(entry.message).toContain('TypeError');
    expect(entry.message).toContain('broken');
    expect(getter).not.toHaveBeenCalled();
  });

  it('handles throwing and revoked proxies and invalid dates', () => {
    const throwing = new Proxy({}, { ownKeys() { throw new Error('denied'); } });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const entry = createLogEntry('server', 'error', [throwing, revoked.proxy, new Date(NaN)]);
    expect(entry.args[0]).toContain('[Unserializable]');
    expect(entry.args[1]).toContain('[Unserializable]');
    expect(entry.args[2]).toBe('[Invalid Date]');
  });

  it('bounds UTF-8 text, argument count, depth and child count', () => {
    const entry = createLogEntry('browser', 'log', Array.from({ length: 200 }, () => '😀'.repeat(10000)));
    const textBytes = Buffer.byteLength(entry.message) + entry.args.reduce((sum, arg) => sum + Buffer.byteLength(arg), 0);
    expect(textBytes).toBeLessThanOrEqual(16 * 1024);
    expect(entry.message).toContain('truncated');
    expect(createLogEntry('browser', 'log', Array(200).fill('')).args.length).toBeLessThanOrEqual(65);
    expect(createLogEntry('browser', 'log', [{ a: { b: { c: { d: { e: { f: 1 } } } } } }]).message).toContain('[Max depth]');
    expect(createLogEntry('browser', 'log', [Array.from({ length: 100 }, (_, index) => index)]).message).toContain('truncated');
  });

  it('keeps the complete JSON wire entry under 16KiB even when escaping expands text', () => {
    for (const value of ['\0', '\n', '\ud800', '"', '\\', '😀']) {
      const entry = createLogEntry('server', 'log', [value.repeat(20000)]);
      expect(Buffer.byteLength(JSON.stringify(entry))).toBeLessThanOrEqual(16 * 1024);
      expect(entry.message).toContain('truncated');
    }
  });

  it('assigns unique IDs and produces immutable entry text', () => {
    const first = createLogEntry('browser', 'info', [{ value: 1 }]);
    const second = createLogEntry('browser', 'info', [{ value: 1 }]);
    expect(first.id).not.toBe(second.id);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.args)).toBe(true);
  });
});

describe('bounded store', () => {
  it('updates snapshots immediately and batches notifications during a burst', () => {
    vi.useFakeTimers();
    const store = createLogStore(2);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    for (const value of ['first', 'second', 'third']) store.append(createLogEntry('browser', 'log', [value]));
    expect(store.getSnapshot().map(entry => entry.message)).toEqual(['second', 'third']);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(1);
    store.append(createLogEntry('browser', 'log', ['fourth']));
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    store.dispose();
  });

  it('clamps capacity, clears, and fully disposes pending notifications', () => {
    vi.useFakeTimers();
    const store = createLogStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.append(createLogEntry('browser', 'log', ['a']));
    store.append(createLogEntry('browser', 'log', ['b']));
    store.setMaxLogs(0);
    expect(store.getSnapshot()).toHaveLength(1);
    store.clear();
    expect(store.getSnapshot()).toHaveLength(0);
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    store.dispose();
    store.append(createLogEntry('browser', 'log', ['ignored']));
    vi.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toHaveLength(0);
    expect(normalizeMaxLogs(NaN)).toBe(500);
    expect(normalizeMaxLogs(2.8)).toBe(2);
    expect(normalizeMaxLogs(Infinity)).toBe(500);
    expect(normalizeMaxLogs(-100)).toBe(1);
    expect(normalizeMaxLogs(10000)).toBe(5000);
  });
});

describe('console interception', () => {
  function makeConsole() {
    return { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  }

  it('shares wrappers, forwards unchanged arguments and restores only after the last user', () => {
    const target = makeConsole();
    const originals = { ...target };
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = installConsoleCapture(target, first);
    const wrapper = target.log;
    const releaseSecond = installConsoleCapture(target, second);
    expect(target.log).toBe(wrapper);
    const argument = { raw: true };
    target.log('hello', argument);
    expect(originals.log).toHaveBeenCalledWith('hello', argument);
    expect(originals.log.mock.contexts[0]).toBe(target);
    expect(first).toHaveBeenCalledWith('log', ['hello', argument]);
    expect(second).toHaveBeenCalledTimes(1);
    releaseFirst();
    releaseFirst();
    expect(target.log).toBe(wrapper);
    releaseSecond();
    for (const level of LOG_LEVELS) expect(target[level]).toBe(originals[level]);
  });

  it('prevents recursive capture and reports listener errors through original console', () => {
    const target = makeConsole();
    const originals = { ...target };
    const listener = vi.fn(() => { target.log('nested'); throw new Error('observer'); });
    const release = installConsoleCapture(target, listener);
    expect(() => target.log('outer')).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(originals.log).toHaveBeenCalledTimes(2);
    expect(originals.error).toHaveBeenCalledTimes(1);
    release();
  });

  it('preserves return values from existing custom console integrations', () => {
    const target = { log: () => 42, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const release = installConsoleCapture(target, vi.fn());
    expect(target.log()).toBe(42);
    release();
  });

  it('leaves subsequent integrations installed and can reinstall without duplicate capture', () => {
    const target = makeConsole();
    const release = installConsoleCapture(target, vi.fn());
    const wrapped = target.log;
    const integration = vi.fn((...args: unknown[]) => wrapped(...args));
    target.log = integration;
    release();
    expect(target.log).toBe(integration);
    const listener = vi.fn();
    const releaseAgain = installConsoleCapture(target, listener);
    target.log('once');
    expect(listener).toHaveBeenCalledTimes(1);
    releaseAgain();
    expect(target.log).toBe(integration);
  });

  it('shares a registry across module reloads', async () => {
    const target = makeConsole();
    const first = vi.fn();
    const releaseFirst = installConsoleCapture(target, first);
    const wrapper = target.log;
    vi.resetModules();
    const reloaded = await import('../src/core/console');
    const second = vi.fn();
    const releaseSecond = reloaded.installConsoleCapture(target, second);
    expect(target.log).toBe(wrapper);
    target.log('HMR');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    releaseFirst();
    releaseSecond();
  });

  it('does not fail when console methods are read-only', () => {
    const target = Object.freeze(makeConsole());
    const release = installConsoleCapture(target, vi.fn());
    target.log('native');
    expect(target.log).toHaveBeenCalledWith('native');
    expect(release).not.toThrow();
  });

  it('imports browser capture on the server without intercepting console or scheduling work', async () => {
    vi.useFakeTimers();
    const original = console.log;
    const { installBrowserCapture } = await import('../src/browser');
    const release = installBrowserCapture();
    expect(console.log).toBe(original);
    expect(vi.getTimerCount()).toBe(0);
    expect(release).not.toThrow();
  });
});
