import { describe, expect, it } from "vitest";
import { evaluate } from "../engine";
import {
  androidEmulator,
  bundle,
  desktopModePixel,
  devtoolsPixel,
  fingerTaps,
  handheldMotion,
  honestDesktop,
  mouseClicks,
  nullMotion,
  obsCamera,
  physicalCamera,
  realIPhone,
  realPixel,
  staticMotion,
} from "./fixtures";

const run = (b: Parameters<typeof evaluate>[0]) => evaluate(b, { source: "server", now: 0, id: "rep_test" });

describe("scoring engine", () => {
  it("approves a real iPhone with a physical camera", () => {
    const r = run(bundle(realIPhone(), { motion: { ...handheldMotion(), permission: "granted" }, interaction: fingerTaps(), camera: physicalCamera("ios") }));
    expect(r.deviceClass).toBe("phone");
    expect(r.probabilities.phone).toBeGreaterThan(0.95);
    expect(r.camera.cameraClass).toBe("physical");
    expect(r.camera.liveness).toBe("responsive");
    expect(r.decision).toBe("approve");
    expect(r.profile.model).toMatch(/iPhone 1[456]/);
  });

  it("approves a real Android phone, including with Chromium's rounded sensor values", () => {
    const r = run(bundle(realPixel(), { motion: handheldMotion(3, 11, true), interaction: fingerTaps(), camera: physicalCamera("android") }));
    expect(r.deviceClass).toBe("phone");
    expect(r.decision).toBe("approve");
    expect(r.profile.model).toContain("Pixel 8");
  });

  it("still leans phone for a real device before the camera step", () => {
    const r = run(bundle(realPixel(), { motion: handheldMotion() }));
    expect(r.deviceClass).toBe("phone");
    expect(r.camera.tested).toBe(false);
  });

  it("classifies an honest desktop as desktop", () => {
    const r = run(bundle(honestDesktop(), { motion: nullMotion(), interaction: mouseClicks() }));
    expect(r.deviceClass).toBe("desktop");
    expect(r.isRealPhone).toBe(false);
    expect(r.decision).not.toBe("approve");
  });

  it("catches DevTools device emulation on a PC", () => {
    const r = run(bundle(devtoolsPixel(), { motion: nullMotion(), interaction: mouseClicks() }));
    expect(r.deviceClass).toBe("spoofed");
    expect(r.decision).toBe("decline");
    const ids = r.categories.flatMap((c) => c.findings).filter((f) => f.status === "fail").map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["hardware.cpu", "platform.desktop-apis", "hardware.window", "identity.platform"]));
  });

  it("catches an Android emulator", () => {
    const r = run(bundle(androidEmulator(), { motion: staticMotion([0, 9.77622, 0.813417]) }));
    expect(r.deviceClass).toBe("emulator");
    expect(r.decision).toBe("decline");
  });

  it("recognises a phone in desktop-site mode as a phone", () => {
    const r = run(bundle(desktopModePixel(), { motion: handheldMotion(), interaction: fingerTaps() }));
    expect(r.deviceClass).toBe("phone");
  });

  it("flags a virtual camera even on otherwise genuine hardware", () => {
    const r = run(bundle(realPixel(), { motion: handheldMotion(), interaction: fingerTaps(), camera: obsCamera() }));
    expect(r.camera.cameraClass).toBe("virtual");
    expect(r.decision).toBe("decline");
  });

  it("flags JavaScript-level tampering", () => {
    const d = devtoolsPixel();
    d.navigator.platform = "Linux armv8l";
    d.integrity.checks = [{ target: "Navigator.platform", ok: false, reasons: ["source is not [native code]"], critical: true }];
    d.integrity.worker = { ok: true, mismatches: ["platform"] };
    const r = run(bundle(d));
    const integrity = r.categories.find((c) => c.id === "integrity")!;
    expect(integrity.status).toBe("fail");
    expect(r.deviceClass).toBe("spoofed");
  });

  it("detects automation", () => {
    const d = honestDesktop();
    d.automation.webdriver = true;
    d.navigator.webdriver = true;
    d.webgl.unmaskedRenderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
    const r = run(bundle(d));
    expect(r.deviceClass).toBe("automation");
  });

  it("never throws on malformed input", () => {
    const d = realPixel() as unknown as Record<string, unknown>;
    d.webgl = null;
    d.integrity = { checks: "nope" };
    d.fingerprint = {};
    const r = run(bundle(d as never, { motion: { motion: "x" } as never, camera: { supported: true, permission: "granted", front: {} } as never }));
    expect(r.categories.length).toBeGreaterThan(3);
    expect(Object.values(r.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("produces probabilities that sum to one and a sorted, capped flag list", () => {
    const r = run(bundle(devtoolsPixel()));
    expect(Object.values(r.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(r.flags.length).toBeLessThanOrEqual(6);
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.riskScore).toBeLessThanOrEqual(100);
  });
});
