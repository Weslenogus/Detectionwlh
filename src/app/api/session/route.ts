import { randomSequence } from "@/lib/detection/camera/flash";
import { randomPoseOrder } from "@/lib/detection/camera/liveness3d";
import { DETECTION_CONFIG } from "@/lib/detection/config";
import { extractServerSignals } from "@/lib/detection/server/headers";
import { rateLimit } from "@/lib/detection/server/store";
import { cryptoRandom, randomId, sign, type SessionPayload } from "@/lib/detection/server/token";
import { errorMessage } from "@/lib/detection/util/safe";

export const dynamic = "force-dynamic";

/**
 * Issues a short-lived signed session with the camera flash challenge and
 * the head-turn order for the active 3D liveness check.
 * A relying party may bind it to its own user/transaction by POSTing
 * `{ "subject": "<opaque id>" }`; the subject is echoed in the verdict token.
 * POST (not GET) so it is never cached or prefetched.
 */
export async function POST(request: Request) {
  try {
    const server = extractServerSignals(request.headers);
    if (!rateLimit(`session:${server.ip ?? "unknown"}`, 60)) {
      return Response.json({ error: "rate limited" }, { status: 429 });
    }
    let subject: string | undefined;
    try {
      const body = (await request.json()) as { subject?: unknown };
      if (typeof body?.subject === "string") subject = body.subject.slice(0, 128);
    } catch {
      /* no body */
    }
    const now = Date.now();
    const payload: SessionPayload = {
      typ: "session",
      sid: randomId("ses"),
      sub: subject,
      iat: now,
      exp: now + 15 * 60_000,
      seq: randomSequence(cryptoRandom),
      pose: DETECTION_CONFIG.activeLiveness ? randomPoseOrder(cryptoRandom) : undefined,
      v: 1,
    };
    return Response.json(
      { sessionToken: sign(payload), sessionId: payload.sid, challenge: payload.seq, pose: payload.pose, expiresAt: payload.exp },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[detection] session failed", e);
    return Response.json({ error: `server error: ${errorMessage(e)}` }, { status: 500 });
  }
}
