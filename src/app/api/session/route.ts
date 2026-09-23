import { randomSequence } from "@/lib/detection/camera/flash";
import { extractServerSignals } from "@/lib/detection/server/headers";
import { rateLimit } from "@/lib/detection/server/store";
import { cryptoRandom, randomId, sign } from "@/lib/detection/server/token";
import type { SessionPayload } from "@/lib/detection/server/token";

export const dynamic = "force-dynamic";

/**
 * Issues a short-lived signed session with the camera flash challenge.
 * POST (not GET) so it is never cached or prefetched.
 */
export async function POST(request: Request) {
  const server = extractServerSignals(request.headers);
  if (!rateLimit(`session:${server.ip ?? "unknown"}`, 30)) {
    return Response.json({ error: "rate limited" }, { status: 429 });
  }
  const now = Date.now();
  const payload: SessionPayload = {
    typ: "session",
    sid: randomId("ses"),
    iat: now,
    exp: now + 15 * 60_000,
    seq: randomSequence(cryptoRandom),
    v: 1,
  };
  return Response.json(
    { sessionToken: sign(payload), sessionId: payload.sid, challenge: payload.seq, expiresAt: payload.exp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
