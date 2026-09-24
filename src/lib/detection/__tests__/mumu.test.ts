/**
 * NetEase MuMu Player, the emulator people ask about most.
 *
 * - MuMu Player 12 (Windows): Android 12 on x86-64 with ARM app translation, rendered by the
 *   PC's graphics card; virtual sensors; mouse clicks turned into touches.
 * - MuMu Player Pro (Apple-silicon Mac): Android running natively on the Mac's ARM cores —
 *   the CPU check can't see it, so everything else has to.
 * "hardened" = the user changed the model in MuMu's settings and the GPU string is spoofed.
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../engine";
import type { CameraSignals, DeviceSignals, InteractionSignals, Report } from "../types";
import { bundle, device, handheldMotion, physicalCamera, realPixel, staticMotion } from "./fixtures";

type Variant = "windows" | "windows-hardened" | "mac" | "mac-hardened";

function mumu(v: Variant): DeviceSignals {
  const mac = v.startsWith("mac");
  const hardened = v.endsWith("hardened");
  const d = realPixel();
  return device({
    ...d,
    navigator: {
      ...d.navigator,
      platform: mac ? "Linux aarch64" : "Linux x86_64",
      uaData: { ...d.navigator.uaData!, high: { ...d.navigator.uaData!.high, model: hardened ? "Pixel 8 Pro" : "MuMu" } },
    },
    cpu: mac ? { nanArchJs: "arm", nanBitsJs: "7fc00000", nanArchWasm: "arm", nanBitsWasm: "7fc00000" } : { nanArchJs: "x86", nanBitsJs: "ffc00000", nanArchWasm: "x86", nanBitsWasm: "ffc00000" },
    webgl: {
      ...d.webgl,
      unmaskedVendor: hardened ? "Qualcomm" : mac ? "Apple" : "NVIDIA Corporation",
      unmaskedRenderer: hardened ? "Adreno (TM) 740" : mac ? "Apple M2" : "NVIDIA GeForce RTX 3060/PCIe/SSE2",
      // Apple GPUs decode ASTC and run half floats; a PC's GPU brings desktop S3TC and full-precision mediump.
      extensions: mac ? ["WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc"] : ["WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_etc"],
      precision: { fragmentMedium: mac ? { rangeMin: 15, rangeMax: 15, precision: 10 } : { rangeMin: 127, rangeMax: 127, precision: 23 } },
      mediumpProbeBits: mac ? 10 : 23,
    },
    webgpu: { supported: false, adapter: null },
    mediaCaps: { supported: true, decode: { "h264-1080p": { supported: true, smooth: true, powerEfficient: false } }, rtcVideoCodecs: ["VP8", "VP9", "H264"] },
    environment: {
      ...d.environment,
      battery: { supported: true, level: 1, charging: true, chargingTime: 0, dischargingTime: null },
      connection: { supported: true, type: "wifi", effectiveType: "4g", rtt: 50, downlink: 10, saveData: false },
    },
  });
}

/** Mouse / trackpad clicks that the emulator turns into touches: a 1×1 px point contact. */
function emulatedTaps(): InteractionSignals {
  const p = (type: string, t: number) => ({ type, pointerType: "touch", isTrusted: true, width: 1, height: 1, pressure: 1, tiltX: 0, tiltY: 0, t, x: 200, y: 700, buttons: 1, target: "continue-device" });
  return {
    pointers: [p("pointerdown", 1000), p("pointerup", 1070), p("pointerdown", 5000), p("pointerup", 5075)],
    touches: [],
    clicks: [
      { t: 1072, isTrusted: true, detail: 1, pointerType: "touch", target: "continue-device", precededByPointerDown: true, holdMs: 70 },
      { t: 5078, isTrusted: true, detail: 1, pointerType: "touch", target: "continue-camera", precededByPointerDown: true, holdMs: 75 },
    ],
    counts: { hoverMouseMoves: 0, pointerMoves: 2, touchStarts: 2, wheel: 0, keys: 0 },
  };
}

/** The PC/Mac webcam behind the emulator's camera HAL: real sensor, but no phone camera module. */
function emulatorWebcam(): CameraSignals {
  const c = physicalCamera("android");
  const f = c.front!;
  f.capabilities = { facingMode: ["user"], width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } };
  f.photoCapabilities = null;
  c.rear = null;
  c.rearError = "No second camera enumerated";
  c.devicesAfter = c.devicesAfter.slice(0, 1);
  return c;
}

/** A person's finger on glass: the contact patch an emulator's mouse-to-touch mapping doesn't have. */
function fingerLikeTaps(): InteractionSignals {
  const t = emulatedTaps();
  t.pointers = t.pointers.map((p, i) => ({ ...p, width: 22 + i, height: 25 + i, pressure: 0.4 }));
  return t;
}

const run = (v: Variant, opts: { realisticSensors?: boolean; everythingFaked?: boolean } = {}): Report => {
  const d = mumu(v);
  let camera = emulatorWebcam();
  if (opts.everythingFaked) {
    d.mediaCaps = { ...d.mediaCaps!, decode: { "h264-1080p": { supported: true, smooth: true, powerEfficient: true } } };
    camera = physicalCamera("android");
  }
  return evaluate(
    bundle(d, {
      motion: opts.realisticSensors || opts.everythingFaked ? handheldMotion(3, 5, true) : staticMotion([0, 9.80665, 0]),
      interaction: opts.everythingFaked ? fingerLikeTaps() : emulatedTaps(),
      camera,
    }),
    { source: "server", now: 0, id: "rep_mumu", requireCamera: true },
  );
};

const failed = (r: Report) => r.categories.flatMap((c) => c.findings).filter((f) => f.status === "fail").map((f) => f.id);

describe("MuMu Player 12 (Windows, x86-64)", () => {
  it("is declined as an emulator, even with its model renamed, a spoofed GPU and realistic sensor data", () => {
    for (const v of ["windows", "windows-hardened"] as const) {
      for (const realisticSensors of [false, true]) {
        const r = run(v, { realisticSensors });
        expect(r.decision, `${v} ${realisticSensors}`).toBe("decline");
        expect(r.deviceClass).toBe("emulator");
        // The x86 FPU can't be renamed.
        expect(failed(r)).toContain("hardware.cpu");
      }
    }
  });
});

describe("MuMu Player Pro (Apple-silicon Mac, native ARM)", () => {
  it("is declined when it shows the Mac's GPU or its own model name, even with realistic sensor data", () => {
    for (const realisticSensors of [false, true]) {
      const r = run("mac", { realisticSensors });
      expect(r.decision).toBe("decline");
      expect(r.deviceClass).toBe("emulator");
      expect(failed(r)).toEqual(expect.arrayContaining(["graphics.gpu", "identity.emulator-model"]));
    }
  });

  it("is kept from approval by corroborating hints when the model and GPU string are spoofed", () => {
    // Point-contact taps, software H.264, a single camera without a rear lens (and static sensors).
    for (const realisticSensors of [false, true]) expect(run("mac-hardened", { realisticSensors }).decision).toBe("review");
  });

  it("documents the limit: an ARM VM that fakes every reported property is indistinguishable in a browser", () => {
    // Realistic sensor stream, finger-sized touches, hardware decoding reported, a phone-like
    // camera inventory. Only hardware attestation (a native app) can tell it apart — see docs/BYPASS-ANALYSIS.md.
    expect(run("mac-hardened", { everythingFaked: true }).decision).toBe("approve");
  });
});
