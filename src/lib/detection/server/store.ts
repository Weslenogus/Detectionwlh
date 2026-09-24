import "server-only";

/**
 * Process-local replay protection and rate limiting. Good enough for a single
 * instance; swap for Redis/KV when running several replicas.
 */
import type { VelocitySignals } from "../types";

const consumed = new Map<string, number>();
const verdicts = new Map<string, number>();
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

/** Verdict tokens are single-use when verified by a relying party. */
export function consumeVerdict(jti: string, exp: number, now = Date.now()): boolean {
  if (verdicts.size > 5000) for (const [k, e] of verdicts) if (e < now) verdicts.delete(k);
  if (verdicts.has(jti)) return false;
  verdicts.set(jti, exp);
  return true;
}

interface SessionEvent {
  t: number;
  ip: string | null;
  fp: string | null;
  storageId: string | null;
  ua: string;
}
const events: SessionEvent[] = [];
const DAY = 86_400_000;

/**
 * Persona-style link analysis over recent sessions: velocity per IP / device
 * fingerprint and how many different identities one browser profile presents.
 */
export function recordSession(e: Omit<SessionEvent, "t">, now = Date.now(), windowMinutes = 60): VelocitySignals {
  while (events.length && (now - events[0].t > DAY || events.length > 50_000)) events.shift();
  events.push({ ...e, t: now });
  const recent = events.filter((x) => now - x.t <= windowMinutes * 60_000);
  const uas = (pred: (x: SessionEvent) => boolean) => new Set(events.filter(pred).map((x) => x.ua)).size;
  return {
    windowMinutes,
    sessionsFromIp: e.ip ? recent.filter((x) => x.ip === e.ip).length : 0,
    sessionsFromFingerprint: e.fp ? recent.filter((x) => x.fp === e.fp).length : 0,
    identitiesOnDevice: e.storageId ? uas((x) => x.storageId === e.storageId) : 0,
    identitiesOnFingerprint: e.fp ? uas((x) => x.fp === e.fp) : 0,
  };
}
