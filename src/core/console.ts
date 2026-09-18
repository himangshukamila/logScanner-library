import { LOG_LEVELS, type LogLevel } from './types.js';

type TargetConsole = Pick<Console, LogLevel>;
type Listener = (level: LogLevel, args: readonly unknown[]) => void;
interface Capture {
  listeners: Map<symbol, Listener>;
  originals: Map<LogLevel, TargetConsole[LogLevel]>;
  wrappers: Map<LogLevel, TargetConsole[LogLevel]>;
  busy: boolean;
}

const registryKey = Symbol.for('log-scanner.console-captures.v1');

function getRegistry(): WeakMap<TargetConsole, Capture> {
  const global = globalThis as typeof globalThis & { [registryKey]?: WeakMap<TargetConsole, Capture> };
  return global[registryKey] ??= new WeakMap();
}

/** Ref-counted interception that survives hot reload without stacking active wrappers. */
export function installConsoleCapture(target: TargetConsole, listener: Listener): () => void {
  const registry = getRegistry();
  let capture = registry.get(target);
  if (!capture) {
    capture = { listeners: new Map(), originals: new Map(), wrappers: new Map(), busy: false };
    registry.set(target, capture);
    const state = capture;
    for (const level of LOG_LEVELS) state.originals.set(level, target[level]);
    for (const level of LOG_LEVELS) {
      const original = state.originals.get(level)!;
      const wrapper = function (...args: unknown[]): void {
        const result = original.apply(target, args);
        if (state.busy || state.listeners.size === 0) return result;
        state.busy = true;
        try {
          for (const [subscriberToken, subscriber] of [...state.listeners]) {
            if (!state.listeners.has(subscriberToken)) continue;
            try { subscriber(level, args); }
            catch (error) {
              try { state.originals.get('error')!.call(target, '[Log Scanner] Capture listener failed', error); }
              catch { /* Instrumentation must not change application console behavior. */ }
            }
          }
        } finally { state.busy = false; }
        return result;
      };
      try {
        target[level] = wrapper;
        if (target[level] === wrapper) state.wrappers.set(level, wrapper);
      } catch { /* Read-only consoles still retain their native output. */ }
    }
  }
  const state = capture;
  const token = Symbol();
  state.listeners.set(token, listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    state.listeners.delete(token);
    if (state.listeners.size > 0) return;
    for (const [level, wrapper] of state.wrappers) {
      try {
        if (target[level] === wrapper) target[level] = state.originals.get(level)!;
      } catch { /* A later integration may have made a method read-only. */ }
    }
    registry.delete(target);
  };
}
