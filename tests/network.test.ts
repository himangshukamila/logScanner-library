// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkCapture } from '../src/browser/network';
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

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
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

    expect(captured.map((entry) => entry.level)).toEqual(['warn', 'error', 'error']);
    expect(captured[2]?.network?.failed).toBe(true);
    expect(captured[2]?.network?.status).toBeUndefined();
    expect(captured[2]?.message).toContain('→ failed');
    expect(captured[2]?.network?.responseBody).toContain('Failed to fetch');
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
});
