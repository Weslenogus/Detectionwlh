import { consumeVerdict } from "@/lib/detection/server/store";
import { verify } from "@/lib/detection/server/token";
import { errorMessage } from "@/lib/detection/util/safe";

export const dynamic = "force-dynamic";

/**
 * Lets another backend confirm a verdict token without trusting the browser:
 *   POST /api/verify  { "token": "<report.signature.token>", "subject": "<optional expected subject>" }
 * Tokens are single-use: a second verification of the same token is rejected.
 */
export async function POST(request: Request) {
  try {
    let body: { token?: unknown; subject?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ valid: false, error: "invalid JSON" }, { status: 400 });
    }
    if (typeof body.token !== "string") return Response.json({ valid: false, error: "token required" }, { status: 400 });
    const res = verify<Record<string, unknown> & { exp?: number; typ?: string; jti?: string; sub?: string | null }>(body.token, "verdict");
    if (!res.ok) return Response.json({ valid: false, error: res.error }, { status: 401 });
    if (typeof body.subject === "string" && res.payload.sub !== body.subject) {
      return Response.json({ valid: false, error: "subject mismatch" }, { status: 401 });
    }
    if (!res.payload.jti || !consumeVerdict(res.payload.jti, res.payload.exp ?? Date.now() + 3_600_000)) {
      return Response.json({ valid: false, error: "token already used" }, { status: 409 });
    }
    return Response.json({ valid: true, verdict: res.payload }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ valid: false, error: `server error: ${errorMessage(e)}` }, { status: 500 });
  }
}
