// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrowserStore, installBrowserCapture, registerBrowserCaptureVisibility } from '../src/browser';
import { LOG_LEVELS } from '../src/core/types';

const releases: Array<() => void> = [];
let releaseBaselineVisibility = () => {};

beforeEach(() => {
  releaseBaselineVisibility = registerBrowserCaptureVisibility(true);
  getBrowserStore().clear();
  getBrowserStore().setMaxLogs(500);
  for (const level of LOG_LEVELS) vi.spyOn(window.console, level).mockImplementation(() => {});
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  releaseBaselineVisibility();
  getBrowserStore().clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('browser capture lifecycle', () => {
  it('keeps early logs for a later panel and captures each level once with multiple installers', () => {
    const releaseStartup = installBrowserCapture();
    releases.push(releaseStartup);
    window.console.log('startup');
    const wrapper = window.console.log;
    const releasePanel = installBrowserCapture();
    releases.push(releasePanel);
    expect(window.console.log).toBe(wrapper);
    for (const level of LOG_LEVELS) window.console[level](level);
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['startup', ...LOG_LEVELS]);
    releaseStartup();
    window.console.log('panel still captures');
    expect(getBrowserStore().getSnapshot().at(-1)?.message).toBe('panel still captures');
  });

  it('captures errors and rejections without preventing their default behavior', () => {
    releases.push(installBrowserCapture());
    const error = new ErrorEvent('error', { error: new Error('window failure'), cancelable: true });
    const rejection = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(rejection, 'reason', { value: { reason: 'promise failure' } });
    window.dispatchEvent(error);
    window.dispatchEvent(rejection);
    const entries = getBrowserStore().getSnapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.message).toContain('window failure');
    expect(entries[1]?.message).toContain('promise failure');
    expect(entries.every(entry => entry.level === 'error' && entry.source === 'browser')).toBe(true);
    expect(error.defaultPrevented).toBe(false);
    expect(rejection.defaultPrevented).toBe(false);
  });

  it('handles repeated mount-cleanup cycles without duplicate handlers or timers', () => {
    vi.useFakeTimers();
    const nativeLog = window.console.log;
    const releaseFirst = installBrowserCapture();
    releaseFirst();
    releaseFirst();
    const releaseSecond = installBrowserCapture({ maxLogs: 2 });
    releases.push(releaseSecond);
    const listener = vi.fn();
    const unsubscribe = getBrowserStore().subscribe(listener);
    window.console.log('first');
    window.console.log('second');
    window.dispatchEvent(new ErrorEvent('error', { message: 'third' }));
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['second', 'third']);
    releaseSecond();
    unsubscribe();
    expect(window.console.log).toBe(nativeLog);
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new ErrorEvent('error', { message: 'not captured' }));
    expect(getBrowserStore().getSnapshot()).toHaveLength(2);
  });

  it('retains the same store and capture across hot module reload', async () => {
    releases.push(installBrowserCapture());
    const store = getBrowserStore();
    const wrapper = window.console.log;
    vi.resetModules();
    const reloaded = await import('../src/browser');
    releases.push(reloaded.installBrowserCapture());
    expect(reloaded.getBrowserStore()).toBe(store);
    expect(window.console.log).toBe(wrapper);
    window.console.log('only once');
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('suspends startup capture while hidden and resumes each console call exactly once', () => {
    const nativeLog = window.console.log;
    releases.push(installBrowserCapture());
    window.console.log('before hidden');

    const releaseHidden = registerBrowserCaptureVisibility(false);
    const releaseOtherHidden = registerBrowserCaptureVisibility(false);
    releases.push(releaseHidden, releaseOtherHidden);
    expect(window.console.log).toBe(nativeLog);
    window.console.log('hidden log');
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['before hidden']);

    releaseHidden();
    expect(window.console.log).toBe(nativeLog);
    releaseOtherHidden();
    const resumedWrapper = window.console.log;
    releaseOtherHidden();
    releases.push(installBrowserCapture());
    expect(window.console.log).toBe(resumedWrapper);
    window.console.log('after visible');
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['before hidden', 'after visible']);
  });

  it('removes hidden error and rejection listeners and restores one set on resume', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    releases.push(installBrowserCapture());
    const releaseHidden = registerBrowserCaptureVisibility(false);
    releases.push(releaseHidden);
    expect(removeListener.mock.calls.filter(([name]) => name === 'error')).toHaveLength(1);
    expect(removeListener.mock.calls.filter(([name]) => name === 'unhandledrejection')).toHaveLength(1);

    const hiddenError = new ErrorEvent('error', { message: 'hidden failure', cancelable: true });
    const hiddenRejection = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(hiddenRejection, 'reason', { value: 'hidden rejection' });
    window.dispatchEvent(hiddenError);
    window.dispatchEvent(hiddenRejection);
    expect(getBrowserStore().getSnapshot()).toHaveLength(0);
    expect(hiddenError.defaultPrevented).toBe(false);
    expect(hiddenRejection.defaultPrevented).toBe(false);

    releaseHidden();
    releaseHidden();
    window.dispatchEvent(new ErrorEvent('error', { message: 'visible failure' }));
    const visibleRejection = new Event('unhandledrejection');
    Object.defineProperty(visibleRejection, 'reason', { value: 'visible rejection' });
    window.dispatchEvent(visibleRejection);
    expect(getBrowserStore().getSnapshot()).toHaveLength(2);
    expect(addListener.mock.calls.filter(([name]) => name === 'error')).toHaveLength(2);
    expect(addListener.mock.calls.filter(([name]) => name === 'unhandledrejection')).toHaveLength(2);
  });

  it('keeps hidden leases inert and never resurrects a lease released during suspension', () => {
    const nativeLog = window.console.log;
    const releaseHidden = registerBrowserCaptureVisibility(false);
    releases.push(releaseHidden);
    const releaseFirst = installBrowserCapture();
    releases.push(releaseFirst);
    expect(window.console.log).toBe(nativeLog);
    releaseFirst();
    releaseFirst();
    releaseHidden();
    expect(window.console.log).toBe(nativeLog);

    const releaseSecond = installBrowserCapture();
    releases.push(releaseSecond);
    const releaseSecondHidden = registerBrowserCaptureVisibility(false);
    releases.push(releaseSecondHidden);
    const releaseThird = installBrowserCapture();
    releases.push(releaseThird);
    releaseSecond();
    releaseSecondHidden();
    window.console.log('remaining lease');
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['remaining lease']);
    releaseThird();
    expect(window.console.log).toBe(nativeLog);
  });

  it('preserves suppression across HMR and supports StrictMode-style cleanup and resumption', async () => {
    const nativeLog = window.console.log;
    const releaseStartup = installBrowserCapture();
    releases.push(releaseStartup);
    const releaseFirstPanel = installBrowserCapture();
    releases.push(releaseFirstPanel);
    releaseFirstPanel();
    const releaseHidden = registerBrowserCaptureVisibility(false);
    releases.push(releaseHidden);

    vi.resetModules();
    const reloaded = await import('../src/browser');
    const releaseSecondPanel = reloaded.installBrowserCapture();
    releases.push(releaseSecondPanel);
    expect(window.console.log).toBe(nativeLog);
    window.console.log('hidden through HMR');
    const releaseVisible = reloaded.registerBrowserCaptureVisibility(true);
    releases.push(releaseVisible);
    expect(window.console.log).toBe(nativeLog);
    releaseHidden();
    releaseFirstPanel();
    window.console.log('visible through HMR');
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['visible through HMR']);
    releaseSecondPanel();
    releaseVisible();
    releaseBaselineVisibility();
    expect(window.console.log).toBe(nativeLog);
    releaseStartup();
    releases.push(reloaded.registerBrowserCaptureVisibility(true));
    expect(window.console.log).toBe(nativeLog);
  });

  it('suspends startup leases after the last root leaves and resumes them for a new root', () => {
    const nativeLog = window.console.log;
    releases.push(installBrowserCapture());
    window.console.log('mounted root');
    releaseBaselineVisibility();
    expect(window.console.log).toBe(nativeLog);
    window.console.log('unmounted root');
    const releaseNextRoot = registerBrowserCaptureVisibility(true);
    releases.push(releaseNextRoot);
    window.console.log('next root');
    expect(getBrowserStore().getSnapshot().map(entry => entry.message)).toEqual(['mounted root', 'next root']);
    releaseNextRoot();
    expect(window.console.log).toBe(nativeLog);
  });
});
