import { analyzeFlash } from "@/lib/detection/camera/flash";
import { evaluate } from "@/lib/detection/engine";
import { extractServerSignals } from "@/lib/detection/server/headers";
import { analyzeRequestSchema, MAX_BODY_BYTES } from "@/lib/detection/server/schema";
import { consumeSession, rateLimit } from "@/lib/detection/server/store";
import { keyId, sign, verify, type SessionPayload } from "@/lib/detection/server/token";
import type { SignalBundle } from "@/lib/detection/types";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Authoritative scoring. The browser's preliminary verdict is never trusted:
 * the raw signals are re-scored here together with network-layer evidence,
 * the flash challenge is re-checked against the sequence this server issued,
 * and the result is returned with an HMAC-signed verdict token.
 */
export async function POST(request: Request) {
  const server = extractServerSignals(request.headers);
  if (!rateLimit(`analyze:${server.ip ?? "unknown"}`, 20)) return json({ error: "rate limited" }, 429);

  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const parsed = analyzeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid payload", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  }

  const session = verify<SessionPayload>(parsed.data.sessionToken, "session");
  if (!session.ok) return json({ error: `session rejected: ${session.error}` }, 401);
  if (!consumeSession(session.payload.sid, session.payload.exp)) return json({ error: "session already used" }, 409);

  const bundle = parsed.data.bundle as unknown as SignalBundle;
  bundle.server = server;

  // Re-derive the liveness verdict using the colour sequence *this server* issued.
  const front = bundle.camera?.front;
  const seq = session.payload.seq;
  if (bundle.camera) bundle.camera.challengeSequence = seq;
  if (front && Array.isArray(front.metrics) && front.flash?.schedule?.length) {
    const schedule = front.flash.schedule.slice(0, seq.length).map((s, i) => ({ ...s, color: seq[i] }));
    front.flash = analyzeFlash(front.metrics, seq, schedule, front.aggregate?.dark ?? false);
  }

  const report = evaluate(bundle, { source: "server", id: session.payload.sid.replace(/^ses_/, "rep_") });
  const now = Date.now();
  const expiresAt = now + 60 * 60_000;
  const token = sign({
    typ: "verdict",
    sid: session.payload.sid,
    rid: report.id,
    iat: now,
    exp: expiresAt,
    decision: report.decision,
    deviceClass: report.deviceClass,
    pPhone: Math.round(report.probabilities.phone * 10000) / 10000,
    cameraClass: report.camera.cameraClass,
    liveness: report.camera.liveness,
    risk: report.riskScore,
    fp: bundle.device.fingerprint?.visitorId ?? null,
    engine: report.version,
  });
  report.signature = { alg: "HS256", token, keyId: keyId(), expiresAt };
  return json({ report });
}
