import "server-only";

/**
 * Process-local replay protection and rate limiting. Good enough for a single
 * instance; swap for Redis/KV when running several replicas.
 */
const consumed = new Map<string, number>();
const buckets = new Map<string, { tokens: number; at: number }>();

function sweep(now: number) {
  if (consumed.size > 5000) for (const [k, exp] of consumed) if (exp < now) consumed.delete(k);
  if (buckets.size > 5000) for (const [k, b] of buckets) if (now - b.at > 120_000) buckets.delete(k);
}

/** Returns false if the session was already used. */
export function consumeSession(sid: string, exp: number, now = Date.now()): boolean {
  sweep(now);
  if (consumed.has(sid)) return false;
  consumed.set(sid, exp);
  return true;
}

/** Token bucket: `perMinute` requests per key, bursting up to the same amount. */
export function rateLimit(key: string, perMinute: number, now = Date.now()): boolean {
  sweep(now);
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
