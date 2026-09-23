/** Helpers that keep a single broken probe from taking the whole scan down. */

export function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? `${e.name}: ${e.message}` : typeof e === "string" ? e : JSON.stringify(e);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Read a nested property without throwing (getters on exotic objects can throw). */
export function get<T = unknown>(obj: unknown, path: string): T | undefined {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null) return undefined;
    try {
      cur = (cur as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  }
  return cur as T;
}
