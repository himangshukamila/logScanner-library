import type { LogEntry, LogLevel, LogSource, NetworkInfo } from './types.js';

// args and message duplicate text; reserve the remaining 784 bytes for JSON metadata.
const ARGUMENT_BYTES = 7800;
// Request and response previews are inspected, not replayed, so they stay far below the argument budget.
const BODY_BYTES = 2000;
const MAX_ARGUMENTS = 64;
const MAX_CHILDREN = 40;
const MAX_DEPTH = 5;
const TRUNCATED = '… [truncated]';
const identityKey = Symbol.for('log-scanner.entry-identity.v1');

interface Identity { prefix: string; next: number }

function nextId(source: LogSource): string {
  const registry = globalThis as typeof globalThis & { [identityKey]?: Identity };
  const identity = registry[identityKey] ??= {
    prefix: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    next: 0,
  };
  return `${source}-${identity.prefix}-${++identity.next}`;
}

function takeBytes(text: string, limit: number): { text: string; bytes: number } {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    // Count JSON's escapes as well as UTF-8 so streamed entries stay bounded too.
    const size = point <= 0x1f
      ? [8, 9, 10, 12, 13].includes(point) ? 2 : 6
      : point === 34 || point === 92 ? 2
      : point >= 0xd800 && point <= 0xdfff ? 6
      : point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > limit) break;
    bytes += size;
    end += character.length;
  }
  return { text: text.slice(0, end), bytes };
}

class PreviewWriter {
  private chunks: string[] = [];
  private remaining: number;
  private truncated = false;

  constructor(private readonly budget: number) { this.remaining = budget; }

  get full(): boolean { return this.remaining === 0; }

  write(text: string): void {
    const part = takeBytes(text, this.remaining);
    this.chunks.push(part.text);
    this.remaining -= part.bytes;
    if (part.text.length < text.length) {
      this.truncated = true;
      this.remaining = 0;
    }
  }

  finish(): string {
    const result = this.chunks.join('');
    if (!this.truncated) return result;
    const marker = takeBytes(TRUNCATED, this.budget);
    return takeBytes(result, this.budget - marker.bytes).text + marker.text;
  }
}

function descriptorValue(value: object, key: string): unknown {
  let current: object | null = value;
  for (let depth = 0; current && depth < 5; depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return 'value' in descriptor ? descriptor.value : '[Getter]';
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function writeValue(value: unknown, writer: PreviewWriter, seen: WeakSet<object>, depth: number): void {
  if (writer.full) return;
  if (typeof value === 'string') {
    // Limit before JSON escaping so an enormous input cannot create an enormous intermediate.
    const part = takeBytes(value, ARGUMENT_BYTES);
    writer.write(depth === 0 ? value : JSON.stringify(part.text));
    if (part.text.length !== value.length && depth > 0) writer.write(TRUNCATED);
    return;
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') writer.write('[Function]');
    else if (typeof value === 'bigint') writer.write(`${value}n`);
    else writer.write(String(value));
    return;
  }
  if (seen.has(value)) { writer.write('[Circular]'); return; }
  if (depth >= MAX_DEPTH) { writer.write('[Max depth]'); return; }
  seen.add(value);
  try {
    if (value instanceof Error) {
      const name = descriptorValue(value, 'name') ?? 'Error';
      if (typeof name === 'string') writer.write(name);
      else writeValue(name, writer, seen, depth + 1);
      writer.write(': ');
      writeValue(descriptorValue(value, 'message') ?? '', writer, seen, 0);
      const stack = descriptorValue(value, 'stack');
      if (typeof stack === 'string') { writer.write('\n'); writer.write(stack); }
      const cause = Object.getOwnPropertyDescriptor(value, 'cause');
      if (cause && 'value' in cause) {
        writer.write('\nCaused by: ');
        writeValue(cause.value, writer, seen, depth + 1);
      }
      return;
    }
    if (value instanceof Date) {
      try { writer.write(Date.prototype.toISOString.call(value)); }
      catch { writer.write('[Invalid Date]'); }
      return;
    }
    if (value instanceof Map || value instanceof Set) {
      const isMap = value instanceof Map;
      writer.write(isMap ? 'Map {' : 'Set {');
      const iterator: IterableIterator<unknown> = isMap
        ? Map.prototype.entries.call(value)
        : Set.prototype.values.call(value);
      let count = 0;
      for (const item of iterator) {
        if (count === MAX_CHILDREN || writer.full) { writer.write(TRUNCATED); break; }
        if (count++) writer.write(', ');
        if (isMap) {
          const [key, mapValue] = item as [unknown, unknown];
          writeValue(key, writer, seen, depth + 1);
          writer.write(' => ');
          writeValue(mapValue, writer, seen, depth + 1);
        } else writeValue(item, writer, seen, depth + 1);
      }
      writer.write('}');
      return;
    }
    const array = Array.isArray(value);
    const keys = Reflect.ownKeys(value).filter(key => key !== 'length' || !array);
    writer.write(array ? '[' : '{');
    let count = 0;
    for (const key of keys) {
      if (count === MAX_CHILDREN || writer.full) { writer.write(TRUNCATED); break; }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable) continue;
      if (count++) writer.write(',');
      writer.write('\n' + '  '.repeat(depth + 1));
      if (!array) {
        writer.write(JSON.stringify(takeBytes(String(key), ARGUMENT_BYTES).text));
        writer.write(': ');
      }
      if ('value' in descriptor) writeValue(descriptor.value, writer, seen, depth + 1);
      else writer.write(descriptor.get ? '[Getter]' : '[Setter]');
    }
    if (count) writer.write('\n' + '  '.repeat(depth));
    writer.write(array ? ']' : '}');
  } catch {
    writer.write('[Unserializable]');
  } finally {
    seen.delete(value);
  }
}

/** Bound any captured text to the preview budget, marking it when it was cut short. */
export function previewText(text: string, limit = BODY_BYTES): string {
  const part = takeBytes(text, limit);
  return part.text.length < text.length ? part.text + TRUNCATED : part.text;
}

function statusLevel(info: NetworkInfo): LogLevel {
  if (info.failed || (info.status ?? 0) >= 500) return 'error';
  return (info.status ?? 0) >= 400 ? 'warn' : 'info';
}

/**
 * Build a network entry whose message stays searchable while detail lives in `network`.
 * The timestamp is taken when the response settled, not when its preview finished reading.
 */
export function createNetworkEntry(info: NetworkInfo, timestamp = Date.now()): LogEntry {
  const outcome = info.failed || info.status === undefined ? 'failed' : String(info.status);
  return Object.freeze({
    id: nextId('network'),
    timestamp,
    source: 'network' as const,
    level: statusLevel(info),
    args: Object.freeze([] as string[]),
    message: `${info.method} ${info.label} → ${outcome} · ${Math.round(info.durationMs)} ms`,
    network: Object.freeze(info),
  });
}

/** Snapshot immediately; never keep references to application objects or invoke getters. */
export function createLogEntry(source: LogSource, level: LogLevel, values: readonly unknown[]): LogEntry {
  const args: string[] = [];
  let remaining = ARGUMENT_BYTES;
  const count = Math.min(values.length, MAX_ARGUMENTS);
  for (let index = 0; index < count && remaining > 0; index++) {
    const writer = new PreviewWriter(remaining);
    try { writeValue(values[index], writer, new WeakSet(), 0); }
    catch { writer.write('[Unserializable]'); }
    const preview = writer.finish();
    args.push(preview);
    remaining -= takeBytes(preview, remaining).bytes;
  }
  if (values.length > args.length && remaining > 0) args.push(takeBytes(TRUNCATED, remaining).text);
  return Object.freeze({
    id: nextId(source), timestamp: Date.now(), source, level,
    args: Object.freeze(args), message: args.join(' '),
  });
}
