import { analyzeFlash } from "@/lib/detection/camera/flash";
import { isValidPose } from "@/lib/detection/camera/liveness3d";
import { evaluate } from "@/lib/detection/engine";
import { extractServerSignals } from "@/lib/detection/server/headers";
import { lookupIp } from "@/lib/detection/server/ip-intel";
import { analyzeRequestSchema, MAX_BODY_BYTES } from "@/lib/detection/server/schema";
import { consumeSession, rateLimit, recordSession } from "@/lib/detection/server/store";
import { keyId, randomId, sign, verify, type SessionPayload } from "@/lib/detection/server/token";
import type { FlashResponse, SignalBundle } from "@/lib/detection/types";
import { errorMessage } from "@/lib/detection/util/safe";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Authoritative scoring. The browser's preliminary verdict is never trusted:
 * the raw signals are re-scored here together with network-layer evidence
 * (headers, IP reputation, velocity), the liveness challenge is always
 * recomputed with the sequence this server issued, and the result comes back
 * with a single-use HMAC-signed verdict token.
 */
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    console.error("[detection] analyze failed", e);
    return json({ error: `server error: ${errorMessage(e)}` }, 500);
  }
}

async function handle(request: Request) {
  const server = extractServerSignals(request.headers);
  if (!rateLimit(`analyze:${server.ip ?? "unknown"}`, 40)) return json({ error: "rate limited" }, 429);

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

  // Liveness is always re-derived here, from per-frame metrics and the sequence *this server*
  // issued. A client-sent verdict is discarded; a missing schedule means "inconclusive".
  const front = bundle.camera?.front;
  const seq = session.payload.seq;
  if (bundle.camera) bundle.camera.challengeSequence = seq;
  if (front) {
    const schedule = Array.isArray(front.flash?.schedule) ? front.flash!.schedule.slice(0, seq.length) : [];
    const inconclusive: FlashResponse = { sequence: seq, schedule: [], correlation: null, lagMs: null, amplitude: null, perChannel: {}, verdict: "inconclusive" };
    front.flash =
      schedule.length === seq.length && Array.isArray(front.metrics)
        ? analyzeFlash(
            front.metrics,
            seq,
            schedule.map((s, i) => ({ start: Number(s.start), end: Number(s.end), color: seq[i] })),
            front.aggregate?.dark ?? false,
          )
        : inconclusive;
  }

  // The head-turn order is also this server's: the client's copy is replaced before scoring, and
  // a camera result that silently drops the issued 3D challenge counts as not having passed it.
  const pose = session.payload.pose;
  const depthIssued = isValidPose(pose);
  if (bundle.camera) {
    if (!depthIssued) bundle.camera.active3d = null;
    else if (bundle.camera.active3d) bundle.camera.active3d.challenge = pose;
    else if (bundle.camera.front)
      bundle.camera.active3d = { status: "skipped", challenge: pose, achieved: [], window: null, frames: 0, track: [], keyFrames: { frontal: null, left: null, right: null } };
  }

  // Network-layer evidence: IP reputation, velocity / identity links, clock skew.
  const [ipIntel] = await Promise.all([lookupIp(server.ip, server.privateIp).catch(() => null)]);
  server.ipIntel = ipIntel;
  server.velocity = recordSession({
    ip: server.ip,
    fp: bundle.device.fpjs?.visitorId ?? bundle.device.fingerprint?.visitorId ?? null,
    storageId: bundle.client?.storageId ?? null,
    ua: bundle.device.navigator.userAgent,
  });
  server.clockSkewMs = typeof bundle.client?.sentAt === "number" ? server.receivedAt - bundle.client.sentAt : null;

  const report = evaluate(bundle, { source: "server", id: session.payload.sid.replace(/^ses_/, "rep_"), requireCamera: true, requireDepth: depthIssued });
  const now = Date.now();
  const expiresAt = now + 60 * 60_000;
  const token = sign({
    typ: "verdict",
    jti: randomId("vt"),
    sid: session.payload.sid,
    sub: session.payload.sub ?? null,
    rid: report.id,
    iat: now,
    exp: expiresAt,
    decision: report.decision,
    deviceClass: report.deviceClass,
    pPhone: Math.round(report.probabilities.phone * 10000) / 10000,
    cameraClass: report.camera.cameraClass,
    liveness: report.camera.liveness,
    depth: report.camera.depth?.verdict ?? null,
    risk: report.riskScore,
    fp: bundle.device.fpjs?.visitorId ?? bundle.device.fingerprint?.visitorId ?? null,
    ip: server.ip,
    engine: report.version,
  });
  report.signature = { alg: "HS256", token, keyId: keyId(), expiresAt };
  return json({ report });
}
