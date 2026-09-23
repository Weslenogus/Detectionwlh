import { describe, expect, it } from "vitest";
import { sign, verify } from "../server/token";
import { isPrivateIp } from "../server/headers";

describe("signed tokens", () => {
  it("round-trips a payload", () => {
    const t = sign({ typ: "verdict", decision: "approve", exp: Date.now() + 1000 });
    const r = verify<{ typ: string; decision: string; exp: number }>(t, "verdict");
    expect(r.ok && r.payload.decision).toBe("approve");
  });

  it("rejects tampering, wrong type and expiry", () => {
    const t = sign({ typ: "verdict", decision: "decline", exp: Date.now() + 1000 });
    const [body, mac] = t.split(".");
    const forged = Buffer.from(Buffer.from(body, "base64url").toString().replace("decline", "approve")).toString("base64url");
    expect(verify(`${forged}.${mac}`, "verdict").ok).toBe(false);
    expect(verify(t, "session").ok).toBe(false);
    const old = sign({ typ: "verdict", exp: Date.now() - 1 });
    expect(verify(old, "verdict")).toEqual({ ok: false, error: "token expired" });
  });
});

describe("ip helpers", () => {
  it("detects private ranges", () => {
    expect(isPrivateIp("192.168.1.4")).toBe(true);
    expect(isPrivateIp("172.20.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("2001:4860::8888")).toBe(false);
  });
});
