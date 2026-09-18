// @vitest-environment node
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeLogScanner, type NodeLogScanner, type NodeLogScannerOptions } from '../src/node';
import type { LogEntry } from '../src/core/types';

const scanners: NodeLogScanner[] = [];
const servers: Server[] = [];
const sockets = new Set<Socket>();

afterEach(async () => {
  for (const scanner of scanners.splice(0)) scanner.dispose();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    if (!server.listening) { resolve(); return; }
    server.close((error) => error ? reject(error) : resolve());
  })));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function scanner(options: NodeLogScannerOptions = { enabled: true }): NodeLogScanner {
  const instance = createNodeLogScanner(options);
  scanners.push(instance);
  return instance;
}

async function serve(instance: NodeLogScanner): Promise<string> {
  const server = createServer(instance.handleRequest);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server');
  return `http://127.0.0.1:${address.port}`;
}

function connect(origin: string, headers: Record<string, string> = {}, path = '/__log-scanner/events', method = 'GET'): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const outgoing = request(`${origin}${path}`, { method, headers, agent: false }, (response) => {
      // Disposing the scanner intentionally destroys active SSE responses.
      response.on('error', () => {});
      resolve(response);
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

function collect(response: IncomingMessage): LogEntry[] {
  let buffer = '';
  const entries: LogEntry[] = [];
  response.setEncoding('utf8');
  response.on('data', (chunk: string) => {
    buffer += chunk;
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event.split('\n').find((line) => line.startsWith('data: '));
      if (data) entries.push(JSON.parse(data.slice(6)) as LogEntry);
    }
  });
  return entries;
}

describe('Node log streaming', () => {
  it('serves a custom route and reports the resolved path', async () => {
    const custom = scanner({ enabled: true, path: 'internal/logs/' });
    expect(custom.path).toBe('/internal/logs');
    const origin = await serve(custom);
    const served = await connect(origin, {}, custom.path);
    expect(served.statusCode).toBe(200);
    served.destroy();
    const defaultRoute = await connect(origin, {}, '/__log-scanner/events');
    expect(defaultRoute.statusCode).toBe(404);
    defaultRoute.resume();
    expect(scanner({ enabled: true, path: '  ' }).path).toBe('/__log-scanner/events');
  });

  it('is inert by default and always disabled in production', async () => {
    const original = console.log;
    const disabled = scanner({});
    expect(console.log).toBe(original);
    const disabledResponse = await connect(await serve(disabled));
    expect(disabledResponse.statusCode).toBe(404);
    disabledResponse.resume();
    vi.stubEnv('NODE_ENV', 'production');
    const production = scanner({ enabled: true });
    expect(console.log).toBe(original);
    const productionResponse = await connect(await serve(production));
    expect(productionResponse.statusCode).toBe(404);
    productionResponse.resume();
  });

  it('retains bounded history, streams live entries, and preserves terminal calls', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const instance = scanner({ enabled: true, maxLogs: 2 });
    console.log('expired');
    console.log('retained one', { nested: true });
    console.log('retained two');
    const response = await connect(await serve(instance));
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const entries = collect(response);
    await vi.waitFor(() => expect(entries).toHaveLength(2));
    expect(entries[0]?.message).toContain('retained one');
    console.log('live', 42);
    await vi.waitFor(() => expect(entries).toHaveLength(3));
    expect(entries[2]).toMatchObject({ source: 'server', level: 'log' });
    expect(entries[2]?.message).toContain('live');
    expect(output).toHaveBeenLastCalledWith('live', 42);
    instance.dispose();
    expect(console.log).toBe(output);
  });

  it('replays only newer entries for Last-Event-ID and handles an expired cursor', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const instance = scanner({ enabled: true, maxLogs: 2 });
    const origin = await serve(instance);
    console.info('first');
    const response = await connect(origin);
    const entries = collect(response);
    await vi.waitFor(() => expect(entries).toHaveLength(1));
    const cursor = entries[0]!.id;
    response.destroy();
    console.info('second');
    const reconnected = await connect(origin, { 'Last-Event-ID': cursor });
    const replay = collect(reconnected);
    await vi.waitFor(() => expect(replay).toHaveLength(1));
    expect(replay[0]?.message).toContain('second');
    reconnected.destroy();
    console.info('third');
    const expired = await connect(origin, { 'Last-Event-ID': cursor });
    const retained = collect(expired);
    await vi.waitFor(() => expect(retained).toHaveLength(2));
    expect(retained.map((entry) => entry.message)).toEqual(['second', 'third']);
  });

  it('shares console wrappers between instances and cleans up idempotently', async () => {
    const original = console.warn;
    const first = scanner();
    const wrapper = console.warn;
    const second = scanner();
    expect(console.warn).toBe(wrapper);
    first.dispose();
    expect(console.warn).toBe(wrapper);
    first.dispose();
    second.dispose();
    expect(console.warn).toBe(original);
    const response = await connect(await serve(second));
    expect(response.statusCode).toBe(404);
    response.resume();
  });

  it('does not replace a later console integration when disposed', () => {
    const original = console.debug;
    const instance = scanner();
    const later = (...args: unknown[]) => original(...args);
    console.debug = later;
    instance.dispose();
    expect(console.debug).toBe(later);
    console.debug = original;
  });

  it('rejects non-local hosts, foreign origins, and unexpected routes or methods', async () => {
    const origin = await serve(scanner());
    const rejectedHeaders: Record<string, string>[] = [
      { Host: 'attacker.example' },
      { Origin: 'https://attacker.example' },
      { Origin: 'http://localhost:12345' },
      { Origin: 'null' },
    ];
    for (const headers of rejectedHeaders) {
      const response = await connect(origin, headers);
      expect(response.statusCode).toBe(403);
      response.resume();
    }
    const missing = await connect(origin, {}, '/other');
    expect(missing.statusCode).toBe(404);
    missing.resume();
    const post = await connect(origin, {}, '/__log-scanner/events', 'POST');
    expect(post.statusCode).toBe(405);
    expect(post.headers.allow).toBe('GET');
    post.resume();
  });

  it('accepts a same-origin request or explicitly allowed local frontend origin', async () => {
    const origin = await serve(scanner({ enabled: true, allowedOrigins: ['http://localhost:5173'] }));
    const sameOrigin = await connect(origin, { Origin: origin });
    expect(sameOrigin.statusCode).toBe(200);
    sameOrigin.destroy();
    const frontend = await connect(origin, { Origin: 'http://localhost:5173' });
    expect(frontend.statusCode).toBe(200);
    expect(frontend.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    frontend.destroy();
  });

  it('cleans up disconnected clients so repeated reconnects do not exhaust capacity', async () => {
    const origin = await serve(scanner());
    for (let index = 0; index < 40; index++) {
      const response = await connect(origin);
      expect(response.statusCode).toBe(200);
      response.destroy();
    }
  });

  it('ends active streams and restores console output when disposed', async () => {
    const original = console.error;
    const instance = scanner();
    const response = await connect(await serve(instance));
    response.resume();
    const closed = new Promise<void>((resolve) => response.once('close', resolve));
    instance.dispose();
    await closed;
    expect(console.error).toBe(original);
  });

  it('disconnects a client whose live queue overflows and still serves new clients', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const instance = scanner({ enabled: true, maxLogs: 1 });
    const origin = await serve(instance);
    const response = await connect(origin);
    response.pause();
    const closed = new Promise<void>((resolve) => response.once('close', resolve));
    for (let index = 0; index < 100; index++) console.log(`${index}: ${'x'.repeat(8_000)}`);
    response.resume();
    await closed;
    const reconnected = await connect(origin);
    expect(reconnected.statusCode).toBe(200);
    const entries = collect(reconnected);
    await vi.waitFor(() => expect(entries).toHaveLength(1));
    expect(entries[0]?.message).toContain('99:');
  });

  it('drains a large retained replay without dropping entries for a healthy client', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const instance = scanner({ enabled: true, maxLogs: 200 });
    for (let index = 0; index < 200; index++) console.log(`${index}: ${'x'.repeat(1_000)}`);
    const response = await connect(await serve(instance));
    const entries = collect(response);
    await vi.waitFor(() => expect(entries).toHaveLength(200));
    expect(entries[0]?.message).toContain('0:');
    expect(entries[199]?.message).toContain('199:');
  });
});
