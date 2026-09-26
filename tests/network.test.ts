// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkCapture } from '../src/browser/network';
import { BODY_BYTES } from '../src/core/serialize';
import type { LogEntry } from '../src/core/types';

const releases: Array<() => void> = [];
let captured: LogEntry[] = [];

function listen() {
  const release = installNetworkCapture((entry) => { captured.push(entry); });
  releases.push(release);
  return release;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function controlledPreview(chunks: string[] = [], hanging = false, headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  const response = new Response('caller body remains intact', { headers: { 'content-type': 'application/json', ...headers } });
  const clone = vi.spyOn(response, 'clone').mockImplementation(() => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (!hanging) controller.close();
    },
    cancel,
  })));
  return { response, clone, cancel };
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('network capture', () => {
  it('records method, url, status, and a response preview without consuming the caller body', async () => {
    const native = vi.fn(async () => jsonResponse({ items: 3 }));
    vi.stubGlobal('fetch', native);
    listen();

    const response = await fetch('/api/cart', { method: 'POST', body: JSON.stringify({ id: 7 }) });
    // The caller still owns an unread body.
    await expect(response.json()).resolves.toEqual({ items: 3 });
    await vi.waitFor(() => expect(captured).toHaveLength(1));

    const entry = captured[0]!;
    expect(entry.source).toBe('network');
    expect(entry.level).toBe('info');
    expect(entry.network?.method).toBe('POST');
    expect(entry.network?.label).toBe('/api/cart');
    expect(entry.network?.url).toBe('http://localhost:3000/api/cart');
    expect(entry.network?.status).toBe(200);
    expect(entry.network?.initiator).toBe('fetch');
    expect(entry.network?.requestBody).toBe('{"id":7}');
    expect(entry.network?.responseBody).toBe('{"items":3}');
    expect(entry.message).toContain('POST /api/cart → 200');
    expect(native).toHaveBeenCalledOnce();
  });

  it('grades status codes into levels and keeps the original rejection for the caller', async () => {
    const native = vi.fn(async (input: string) => {
      if (input === '/missing') return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
      if (input === '/broken') return new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } });
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', native);
    listen();

    await fetch('/missing');
    await fetch('/broken');
    await expect(fetch('/offline')).rejects.toThrow('Failed to fetch');
    await vi.waitFor(() => expect(captured).toHaveLength(3));

    const missing = captured.find((entry) => entry.network?.label === '/missing')!;
    const broken = captured.find((entry) => entry.network?.label === '/broken')!;
    const offline = captured.find((entry) => entry.network?.label === '/offline')!;
    expect([missing.level, broken.level, offline.level]).toEqual(['warn', 'error', 'error']);
    expect(offline.network?.failed).toBe(true);
    expect(offline.network?.status).toBeUndefined();
    expect(offline.message).toContain('→ failed');
    expect(offline.network?.responseBody).toContain('Failed to fetch');
  });

  it('describes non-text bodies by type instead of copying them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('binary', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })));
    listen();

    await fetch('/logo.png', { method: 'PUT', body: new URLSearchParams({ tag: 'v2' }) });
    await vi.waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]?.network?.requestBody).toBe('tag=v2');
    expect(captured[0]?.network?.responseBody).toBe('[image/png]');
  });

  it('labels cross-origin requests with their origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    listen();
    await fetch('https://api.example.com/v1/users?page=2');
    await vi.waitFor(() => expect(captured).toHaveLength(1));
    expect(captured[0]?.network?.label).toBe('https://api.example.com/v1/users?page=2');
  });

  it('shares one patch across installers and restores fetch when the last one releases', async () => {
    const native = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', native);
    const first = listen();
    const patched = globalThis.fetch;
    const second = listen();
    expect(globalThis.fetch).toBe(patched);

    await fetch('/api/one');
    await vi.waitFor(() => expect(captured).toHaveLength(2));

    first();
    first();
    await fetch('/api/two');
    await vi.waitFor(() => expect(captured).toHaveLength(3));

    second();
    expect(globalThis.fetch).toBe(native);
    await fetch('/api/three');
    expect(captured).toHaveLength(3);
  });

  it('keeps capturing when one observer throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})));
    releases.push(installNetworkCapture(() => { throw new Error('observer failure'); }));
    listen();
    await fetch('/api/resilient');
    await vi.waitFor(() => expect(captured).toHaveLength(1));
  });

  it('keeps complete JSON responses larger than the former 2 KiB preview limit', async () => {
    const body = { message: 'a'.repeat(8_000), complete: true };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body)));
    listen();
    const response = await fetch('/larger-json');
    await expect(response.json()).resolves.toEqual(body);
    await vi.waitFor(() => expect(captured).toHaveLength(1));
    expect(JSON.parse(captured[0]!.network!.responseBody!)).toEqual(body);
  });

  it('bounds reads without Content-Length, marks truncation, and cancels only the clone', async () => {
    const preview = controlledPreview(['a'.repeat(BODY_BYTES), 'unread tail'], true);
    vi.stubGlobal('fetch', vi.fn(async () => preview.response));
    listen();
    const response = await fetch('/unbounded-text');
    await vi.waitFor(() => expect(captured).toHaveLength(1));
    const text = captured[0]!.network!.responseBody!;
    expect(text).toContain('… [truncated]');
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(BODY_BYTES);
    expect(preview.cancel).toHaveBeenCalledOnce();
    await expect(response.text()).resolves.toBe('caller body remains intact');
  });

  it('emits faster previews without waiting for earlier bodies and preserves settlement timestamps', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const slow = controlledPreview([], true);
    const fast = controlledPreview(['{"ready":true}']);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/slow' ? slow.response : fast.response));
    listen();
    await fetch('/slow');
    await vi.advanceTimersByTimeAsync(100);
    await fetch('/fast');
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.map((entry) => entry.network?.label)).toEqual(['/fast']);
    expect(captured[0]!.timestamp).toBe(10_100);
    await vi.advanceTimersByTimeAsync(1_900);
    expect(captured.map((entry) => entry.network?.label)).toEqual(['/fast', '/slow']);
    expect(captured[1]!.timestamp).toBe(10_000);
    expect(captured[1]!.network!.responseBody).toBe('[body preview timed out]');
    expect(slow.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps active previews at eight and cleans up their readers and timers', async () => {
    vi.useFakeTimers();
    const previews = Array.from({ length: 9 }, () => controlledPreview([], true));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => previews[Number(url.slice(1))]!.response));
    const release = listen();
    await Promise.all(previews.map((_preview, index) => fetch(`/${index}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(previews.filter((preview) => preview.clone.mock.calls.length === 1)).toHaveLength(8);
    expect(previews[8]!.clone).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.network!.responseBody).toBe('[body preview skipped: busy]');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(previews.slice(0, 8).every((preview) => preview.cancel.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(captured).toHaveLength(1);
  });

  it('does not start a preview for a fetch response that arrives after final cleanup', async () => {
    const preview = controlledPreview(['{"late":true}']);
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; })));
    const release = listen();
    const pending = fetch('/late');
    release();
    resolveResponse(preview.response);
    const response = await pending;
    await expect(response.text()).resolves.toBe('caller body remains intact');
    expect(preview.clone).not.toHaveBeenCalled();
    expect(captured).toHaveLength(0);
  });

  it('does not clone streaming, binary, or declared large responses', async () => {
    const previews = [
      controlledPreview([], true, { 'content-type': 'text/event-stream' }),
      controlledPreview([], true, { 'content-type': 'image/png' }),
      controlledPreview([], true, { 'content-length': String(512 * 1024 + 1) }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => previews[Number(url.slice(1))]!.response));
    listen();
    await Promise.all(previews.map((_preview, index) => fetch(`/${index}`)));
    expect(captured).toHaveLength(3);
    expect(previews.every((preview) => preview.clone.mock.calls.length === 0)).toBe(true);
    expect(captured.map((entry) => entry.network?.responseBody)).toEqual([
      '[text/event-stream stream]', '[image/png]', '[524289 bytes not captured]',
    ]);
  });

  it('captures bounded XHR JSON and removes in-flight listeners without aborting application requests', () => {
    class TestXhr extends EventTarget {
      responseType = 'json';
      response = { message: 'a'.repeat(50_000) };
      responseText = '';
      status = 200;
      statusText = 'OK';
      open(_method: string, _url: string) {}
      send() {}
      abort = vi.fn();
      getResponseHeader() { return 'application/json'; }
    }
    vi.stubGlobal('XMLHttpRequest', TestXhr);
    const originalOpen = TestXhr.prototype.open;
    const release = listen();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/xhr');
    xhr.send('{"request":true}');
    xhr.dispatchEvent(new Event('loadend'));
    expect(captured).toHaveLength(1);
    expect(captured[0]!.network!.initiator).toBe('xhr');
    expect(captured[0]!.network!.requestBody).toBe('{"request":true}');
    expect(captured[0]!.network!.responseBody).toContain('[truncated]');
    expect(new TextEncoder().encode(captured[0]!.network!.responseBody!).byteLength).toBeLessThanOrEqual(BODY_BYTES);

    const inFlight = new XMLHttpRequest();
    const remove = vi.spyOn(inFlight, 'removeEventListener');
    inFlight.open('GET', '/pending');
    inFlight.send();
    release();
    expect(remove).toHaveBeenCalledWith('loadend', expect.any(Function));
    expect(inFlight.abort).not.toHaveBeenCalled();
    expect(TestXhr.prototype.open).toBe(originalOpen);
    inFlight.dispatchEvent(new Event('loadend'));
    expect(captured).toHaveLength(1);
  });

  it('preserves the JSON type of top-level XHR string responses', () => {
    class TestXhr extends EventTarget {
      responseType = 'json';
      response = '';
      status = 200;
      statusText = 'OK';
      open(_method: string, _url: string) {}
      send() {}
      getResponseHeader() { return 'application/json'; }
    }
    vi.stubGlobal('XMLHttpRequest', TestXhr);
    listen();
    for (const response of ['hello', '{"ok":true}']) {
      const xhr = new TestXhr();
      xhr.response = response;
      xhr.open('GET', '/json-string');
      xhr.send();
      xhr.dispatchEvent(new Event('loadend'));
      expect(JSON.parse(captured.at(-1)!.network!.responseBody!)).toBe(response);
    }
    expect(captured).toHaveLength(2);
  });

  it('captures both responses when an earlier loadend listener reuses the same XHR', () => {
    class TestXhr extends EventTarget {
      readyState = 0;
      responseType = 'text';
      responseText = '';
      status = 0;
      statusText = '';
      open(_method: string, _url: string) {
        this.readyState = 1;
        this.status = 0;
        this.responseText = '';
      }
      send() { this.readyState = 2; }
      getResponseHeader() { return 'text/plain'; }
      complete(text: string) {
        this.readyState = 4;
        this.status = 200;
        this.statusText = 'OK';
        this.responseText = text;
        this.dispatchEvent(new Event('loadend'));
      }
    }
    vi.stubGlobal('XMLHttpRequest', TestXhr);
    listen();
    const xhr = new TestXhr();
    let reused = false;
    xhr.addEventListener('loadend', () => {
      if (reused) return;
      reused = true;
      xhr.open('GET', '/second');
      xhr.send();
    });
    xhr.open('GET', '/first');
    xhr.send();
    xhr.complete('first response');
    expect(captured).toHaveLength(1);
    xhr.complete('second response');
    expect(captured.map(entry => ({ label: entry.network?.label, status: entry.network?.status, body: entry.network?.responseBody }))).toEqual([
      { label: '/first', status: 200, body: 'first response' },
      { label: '/second', status: 200, body: 'second response' },
    ]);
  });
});
