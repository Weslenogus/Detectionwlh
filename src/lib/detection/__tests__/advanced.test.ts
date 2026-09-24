import { describe, expect, it } from "vitest";
import { poseFromMatrix, summarizeFaces, type FrameFace } from "../camera/face";
import { moireScore } from "../camera/frame-analysis";
import { intlOffsetMinutes } from "../collectors/timezone";
import { evaluate } from "../engine";
import { parseIpapi } from "../server/ip-intel";
import { recordSession } from "../server/store";
import { haversineKm } from "../util/geo";
import { parseSecChUa } from "../util/sec-ch-ua";
import { bundle, devtoolsPixel, fingerTaps, gauss, handheldMotion, physicalCamera, realIPhone, realPixel, rng } from "./fixtures";

const run = (b: Parameters<typeof evaluate>[0], requireCamera = true) => evaluate(b, { source: "server", now: 0, id: "rep_t", requireCamera });
const ids = (r: ReturnType<typeof run>, status?: string) =>
  r.categories.flatMap((c) => c.findings).filter((f) => !status || f.status === status).map((f) => f.id);

describe("moiré / screen recapture", () => {
  const N = 128;
  it("finds a sharp periodic peak in a re-filmed screen grating", () => {
    const r = rng(4);
    const y = new Float32Array(N * N).map((_, i) => {
      const x = i % N;
      const yy = Math.floor(i / N);
      return 128 + 40 * Math.sin(2 * Math.PI * (0.31 * x + 0.07 * yy)) + gauss(r) * 2;
    });
    const m = moireScore(y, N, N);
    expect(m.peakRatio).toBeGreaterThan(18);
    expect(m.frequency).toBeGreaterThan(0.25);
  });

  it("stays low on a natural, noisy scene", () => {
    const r = rng(5);
    const y = new Float32Array(N * N).map((_, i) => 60 + (i % N) * 0.8 + Math.floor(i / N) * 0.4 + gauss(r) * 3);
    expect(moireScore(y, N, N).peakRatio).toBeLessThan(10);
  });
});

describe("timezone consistency", () => {
  it("computes IANA offsets with Date's sign convention", () => {
    expect(intlOffsetMinutes("UTC", new Date("2026-01-15T12:00:00Z"))).toBe(0);
    expect(intlOffsetMinutes("America/Toronto", new Date("2026-01-15T12:00:00Z"))).toBe(300);
    expect(intlOffsetMinutes("America/Toronto", new Date("2026-07-15T12:00:00Z"))).toBe(240);
    expect(intlOffsetMinutes("Asia/Kolkata", new Date("2026-07-15T12:00:00Z"))).toBe(-330);
  });
});

describe("face landmarks", () => {
  it("extracts yaw from a transformation matrix", () => {
    const a = (30 * Math.PI) / 180;
    // rotation about Y, column-major
    const m = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, -40, 1];
    const p = poseFromMatrix(m)!;
    expect(Math.abs(p.yaw)).toBeCloseTo(30, 3);
    expect(Math.abs(p.pitch)).toBeLessThan(1e-6);
  });

  it("summarises motion, blinks and framing", () => {
    const base = Array.from({ length: 50 }, (_, i) => ({ x: 0.4 + (i % 10) * 0.02, y: 0.35 + Math.floor(i / 10) * 0.06 }));
    const still: FrameFace[] = [0, 1, 2, 3].map((f) => ({ frame: f, faces: 1, landmarks: base, pose: { yaw: 2, pitch: -3, roll: 1 }, blink: 0.1, score: 1 }));
    const s = summarizeFaces(still);
    expect(s.landmarkMotion).toBe(0);
    expect(s.framesWithFace).toBe(4);
    expect(s.centered).toBe(true);
    const moving = still.map((f, k) => ({ ...f, landmarks: base.map((p, i) => ({ x: p.x + k * 0.002 + (i % 3) * 0.0005 * k, y: p.y })), blink: k === 2 ? 0.9 : 0.1 }));
    const m = summarizeFaces(moving);
    expect(m.landmarkMotion!).toBeGreaterThan(0);
    expect(m.nonRigidMotion!).toBeGreaterThan(0);
    expect(m.eyeBlink!.max).toBeCloseTo(0.9, 3);
  });
});

describe("server intelligence", () => {
  it("parses keyed and keyless ipapi.is responses", () => {
    const keyed = parseIpapi({
      is_mobile: true,
      is_datacenter: false,
      is_vpn: false,
      is_proxy: false,
      is_tor: false,
      is_abuser: false,
      asn: { asn: 22140, org: "T-Mobile USA, Inc.", type: "isp" },
      location: { country: "United States", city: "Seattle", latitude: 47.6, longitude: -122.3, timezone: "America/Los_Angeles" },
    });
    expect([keyed.source, keyed.isMobile, keyed.asn, keyed.lat]).toEqual(["api", true, "AS22140", 47.6]);
    const flat = parseIpapi({ company: "DigitalOcean, LLC", asn: "AS14061 DigitalOcean, LLC", country: "Germany", lat: 50.1, lon: 8.6, timezone: "Europe/Berlin" });
    expect([flat.source, flat.isDatacenter, flat.asn, flat.org]).toEqual(["heuristic", true, "AS14061", "DigitalOcean, LLC"]);
    expect(parseIpapi({ company: "Rogers Communications", asn: "AS812 Rogers Wireless" }).isMobile).toBe(true);
  });

  it("parses Sec-CH-UA and distances", () => {
    expect(parseSecChUa('"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"')).toEqual([
      { brand: "Chromium", version: "141" },
      { brand: "Not?A_Brand", version: "8" },
      { brand: "Google Chrome", version: "141" },
    ]);
    expect(haversineKm(43.65, -79.38, 40.71, -74.01)).toBeGreaterThan(540);
    expect(haversineKm(43.65, -79.38, 40.71, -74.01)).toBeLessThan(560);
  });

  it("links identities per device and counts velocity", () => {
    const t = 1_000_000_000;
    recordSession({ ip: "9.9.9.9", fp: "fpA", storageId: "dev1", ua: "UA-1" }, t);
    recordSession({ ip: "9.9.9.9", fp: "fpA", storageId: "dev1", ua: "UA-2" }, t + 1000);
    const v = recordSession({ ip: "9.9.9.9", fp: "fpA", storageId: "dev1", ua: "UA-3" }, t + 2000);
    expect(v.sessionsFromIp).toBe(3);
    expect(v.identitiesOnDevice).toBe(3);
  });
});

describe("advanced engine rules", () => {
  it("never approves on the server without a camera test", () => {
    const r = run(bundle(realPixel(), { motion: handheldMotion(), interaction: fingerTaps() }));
    expect(r.decision).not.toBe("approve");
    expect(run(bundle(realPixel(), { motion: handheldMotion(), interaction: fingerTaps() }), false).decision).toBe("approve");
  });

  it("keeps a genuine Android phone clean now that keyboard/file pickers are not desktop-only", () => {
    const r = run(bundle(realPixel(), { motion: handheldMotion(), interaction: fingerTaps(), camera: physicalCamera("android") }));
    expect(ids(r, "fail")).not.toContain("platform.desktop-apis");
    expect(r.decision).toBe("approve");
  });

  it("flags the host OS text stack under DevTools emulation", () => {
    const r = run(bundle(devtoolsPixel()));
    expect(ids(r, "fail")).toEqual(expect.arrayContaining(["environment.system-ui", "environment.flag-emoji"]));
  });

  it("flags a UA string that was not reduced like real Chrome", () => {
    const d = realPixel();
    d.navigator.userAgent = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
    expect(ids(run(bundle(d)), "fail")).toContain("identity.ua-reduction");
  });

  it("uses network intelligence and GNSS", () => {
    const d = realIPhone();
    const b = bundle(d, {
      motion: { ...handheldMotion(), permission: "granted" },
      interaction: fingerTaps(),
      camera: physicalCamera("ios"),
      location: { state: "granted", accuracy: 8, altitude: 91, lat: 43.65, lon: -79.38 },
      server: {
        ip: "172.56.1.2",
        ipVersion: 4,
        privateIp: false,
        headers: {},
        headerOrder: [],
        geo: null,
        tls: null,
        receivedAt: 0,
        ipIntel: { provider: "t", source: "api", asn: "AS21928", org: "T-Mobile", country: "CA", city: "Toronto", lat: 43.7, lon: -79.4, timezone: "America/Toronto", isMobile: true, isDatacenter: false, isVpn: false, isProxy: false, isTor: false, isAbuser: false },
        velocity: { windowMinutes: 60, sessionsFromIp: 1, sessionsFromFingerprint: 1, identitiesOnDevice: 1, identitiesOnFingerprint: 1 },
      },
    });
    const r = run(b);
    expect(ids(r, "pass")).toEqual(expect.arrayContaining(["network.carrier", "network.location", "network.location-vs-ip"]));
    expect(r.decision).toBe("approve");

    b.server!.ipIntel = { ...b.server!.ipIntel!, isMobile: false, isDatacenter: true, lat: 52.5, lon: 13.4 };
    b.server!.velocity = { ...b.server!.velocity!, identitiesOnDevice: 4 };
    const bad = run(b);
    expect(ids(bad, "fail")).toEqual(expect.arrayContaining(["network.datacenter", "behavior.identity-switch"]));
    expect(ids(bad, "warn")).toContain("network.location-vs-ip");
  });
});
