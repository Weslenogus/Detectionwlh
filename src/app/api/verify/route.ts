import { verify } from "@/lib/detection/server/token";

export const dynamic = "force-dynamic";

/**
 * Lets another backend confirm a verdict token without trusting the browser:
 *   POST /api/verify  { "token": "<report.signature.token>" }
 */
export async function POST(request: Request) {
  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown }).token;
  } catch {
    return Response.json({ valid: false, error: "invalid JSON" }, { status: 400 });
  }
  if (typeof token !== "string") return Response.json({ valid: false, error: "token required" }, { status: 400 });
  const res = verify<Record<string, unknown> & { exp?: number; typ?: string }>(token, "verdict");
  if (!res.ok) return Response.json({ valid: false, error: res.error }, { status: 401 });
  return Response.json({ valid: true, verdict: res.payload }, { headers: { "Cache-Control": "no-store" } });
}
