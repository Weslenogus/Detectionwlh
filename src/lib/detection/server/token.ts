import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoseDir } from "../camera/liveness3d";
import type { FlashColor } from "../types";

export interface SessionPayload {
  typ: "session";
  sid: string;
  /** Optional relying-party subject (user / transaction id) the session is bound to. */
  sub?: string;
  iat: number;
  exp: number;
  seq: FlashColor[];
  /** Head-turn order for the active 3D liveness challenge. */
  pose?: PoseDir[];
  v: 1;
}

/**
 * Compact signed tokens (base64url(payload).base64url(HMAC-SHA256)).
 * Used for the session challenge handed to the browser and for the final
 * verdict a backend can verify without trusting the client.
 */

let secret: Buffer | null = null;
let warned = false;

function key(): Buffer {
  if (secret) return secret;
  const env = process.env.DETECTION_SECRET;
  if (env && env.length >= 32) {
    secret = Buffer.from(env, "utf8");
  } else if (process.env.NODE_ENV === "production" && process.env.DETECTION_ALLOW_EPHEMERAL_KEY !== "1") {
    // With several instances an ephemeral key silently breaks every session; refuse instead.
    throw new Error("DETECTION_SECRET (>= 32 chars) must be set in production");
  } else {
    if (!warned) console.warn("[detection] DETECTION_SECRET missing — using an ephemeral per-process key (dev only).");
    warned = true;
    secret = randomBytes(32);
  }
  return secret;
}

export function keyId(): string {
  return createHash("sha256").update(key()).digest("hex").slice(0, 10);
}

const b64 = (b: Buffer) => b.toString("base64url");

export function sign<T extends object>(payload: T): string {
  const body = b64(Buffer.from(JSON.stringify({ ...payload, kid: keyId() })));
  const mac = createHmac("sha256", key()).update(body).digest();
  return `${body}.${b64(mac)}`;
}

export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; error: string };

export function verify<T extends { exp?: number; typ?: string }>(token: string, typ: string, now = Date.now()): VerifyResult<T> {
  if (typeof token !== "string" || token.length > 8192) return { ok: false, error: "malformed token" };
  const [body, mac] = token.split(".");
  if (!body || !mac) return { ok: false, error: "malformed token" };
  const expected = createHmac("sha256", key()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "bad signature" };
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return { ok: false, error: "malformed payload" };
  }
  if (payload.typ !== typ) return { ok: false, error: `expected ${typ} token` };
  if (typeof payload.exp === "number" && payload.exp < now) return { ok: false, error: "token expired" };
  return { ok: true, payload };
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

/** Unbiased crypto-random float in [0, 1) for challenge generation. */
export function cryptoRandom(): number {
  return randomBytes(4).readUInt32BE() / 2 ** 32;
}
