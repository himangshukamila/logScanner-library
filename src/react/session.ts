/** Session storage that degrades to a no-op when it is unavailable, partitioned, or full. */
export function readSession(key: string): unknown {
  try {
    if (typeof window === 'undefined') return undefined;
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function writeSession(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode and quota failures leave the session in memory only.
  }
}
