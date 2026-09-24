import { describe, expect, it } from "vitest";
import { analyzeFlash, isValidSequence, randomSequence } from "../camera/flash";
import { analyzeFrames, blockiness, immerkaerSigma, type RawFrame } from "../camera/frame-analysis";
import { analyzeInteraction } from "../interaction/analysis";
import { classifyCameraLabel } from "../knowledge/cameras";
import { matchEmulatorModel } from "../knowledge/devices";
import { classifyGpu, cleanRenderer } from "../knowledge/gpu";
import { parseUA } from "../knowledge/ua";
import { analyzeMotion } from "../sensors/analysis";
import type { FrameMetric } from "../types";
import { fingerTaps, gauss, handheldMotion, mouseClicks, nullMotion, rng, staticMotion } from "./fixtures";

const W = 96;

function frame(t: number, pixel: (x: number, y: number) => number): RawFrame {
  const crop = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const v = pixel(x, y);
      const i = (y * W + x) * 4;
      crop[i] = crop[i + 1] = crop[i + 2] = v;
      crop[i + 3] = 255;
    }
  const thumb = new Uint8ClampedArray(16 * 12 * 4).fill(128);
  return { t, crop, cw: W, ch: W, thumb, tw: 16, th: 12 };
}

const scene = (x: number, y: number) => 60 + ((x * 3 + y * 2) % 120);

describe("frame forensics", () => {
  it("reports zero temporal noise and frozen frames for a still image", () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame(i * 33, scene));
    const { aggregate } = analyzeFrames(frames);
    expect(aggregate!.duplicateRatio).toBe(1);
    expect(aggregate!.temporalNoise).toBe(0);
    expect(aggregate!.zeroDiffRatio).toBe(1);
  });

  it("measures sensor-like Gaussian noise", () => {
    const r = rng(1);
    const frames = Array.from({ length: 12 }, (_, i) => frame(i * 33, (x, y) => scene(x, y) + gauss(r) * 2));
    const { aggregate } = analyzeFrames(frames);
    expect(aggregate!.duplicateRatio).toBe(0);
    expect(aggregate!.temporalNoise!).toBeGreaterThan(1.5);
    expect(aggregate!.temporalNoise!).toBeLessThan(2.6);
    expect(aggregate!.zeroDiffRatio!).toBeLessThan(0.4);
  });

  it("estimates single-image noise (Immerkær)", () => {
    const r = rng(2);
    const y = new Float32Array(128 * 128).map(() => 128 + gauss(r) * 3);
    expect(immerkaerSigma(y, 128, 128)).toBeGreaterThan(2.5);
    expect(immerkaerSigma(y, 128, 128)).toBeLessThan(3.5);
  });

  it("detects 8×8 codec blocking but not natural gradients", () => {
    const r = rng(3);
    const blocks = new Float32Array(W * W).map((_, i) => {
      const x = i % W;
      const y = Math.floor(i / W);
      return 40 + ((Math.floor(x / 8) * 37 + Math.floor(y / 8) * 53) % 160);
    });
    const natural = new Float32Array(W * W).map((_, i) => (i % W) * 1.5 + Math.floor(i / W) + gauss(r));
    expect(blockiness(blocks, W, W)).toBeGreaterThan(3);
    expect(blockiness(natural, W, W)).toBeLessThan(1.2);
  });
});

describe("flash challenge", () => {
  const schedule = (["red", "blue", "green", "red"] as const).map((color, i) => ({ color, start: i * 250, end: (i + 1) * 250 }));
  const metrics = (respond: boolean, lag = 96): FrameMetric[] => {
    const r = rng(9);
    return Array.from({ length: 30 }, (_, i) => {
      const t = i * 33.3;
      const c = schedule.find((s) => t - lag >= s.start && t - lag < s.end)?.color;
      const k = respond ? 12 : 0;
      return { t, meanY: 100, stdY: 30, r: 100 + (c === "red" ? k : 0) + gauss(r), g: 100 + (c === "green" ? k : 0) + gauss(r), b: 100 + (c === "blue" ? k : 0) + gauss(r), diff: 1, zeroDiff: 0.3, temporalSigma: 1, spatialSigma: 2, clipped: 0 };
    });
  };

  it("detects a lagged reflection", () => {
    const res = analyzeFlash(metrics(true), ["red", "blue", "green", "red"], schedule);
    expect(res.verdict).toBe("responsive");
    expect(res.lagMs).toBeGreaterThanOrEqual(64);
    expect(res.lagMs).toBeLessThanOrEqual(128);
  });

  it("rejects a feed that ignores the flashes", () => {
    const res = analyzeFlash(metrics(false), ["red", "blue", "green", "red"], schedule);
    expect(res.verdict).not.toBe("responsive");
  });

  it("generates valid challenges", () => {
    const r = rng(5);
    for (let i = 0; i < 200; i++) {
      const s = randomSequence(r);
      expect(isValidSequence(s)).toBe(true);
      expect(new Set(s.slice(0, 3)).size).toBe(3);
      s.forEach((c, j) => j && expect(c).not.toBe(s[j - 1]));
    }
  });
});

describe("motion analysis", () => {
  it("recognises a hand-held physical sensor", () => {
    const m = analyzeMotion(handheldMotion());
    expect(m.verdict).toBe("physical");
    expect(m.gravityPlausible).toBe(true);
    expect(m.consistencyErrorDeg!).toBeLessThan(10);
    expect(m.handheld).toBe("handheld");
  });

  it("treats Chromium-rounded constant readings as resting, not synthetic", () => {
    expect(analyzeMotion(staticMotion([0, 9.8, 0.8])).verdict).toBe("resting");
  });

  it("flags full-precision constant readings (emulator defaults) as synthetic", () => {
    expect(analyzeMotion(staticMotion([0, 9.77622, 0.813417])).verdict).toBe("synthetic");
  });

  it("flags null-valued events as no hardware", () => {
    expect(analyzeMotion(nullMotion()).verdict).toBe("null-sensors");
  });

  it("detects orientation that contradicts gravity", () => {
    const m = handheldMotion();
    m.orientation = m.orientation.map((o) => [o[0], o[1], 0, 80, null]);
    expect(analyzeMotion(m).consistencyErrorDeg!).toBeGreaterThan(40);
  });
});

describe("interaction analysis", () => {
  it("distinguishes finger taps from mouse clicks", () => {
    expect(analyzeInteraction(fingerTaps()).verdict).toBe("finger");
    expect(analyzeInteraction(mouseClicks()).verdict).toBe("mouse");
  });

  it("flags untrusted (script-dispatched) clicks", () => {
    const s = fingerTaps();
    s.pointers = [];
    s.clicks = s.clicks.map((c) => ({ ...c, isTrusted: false, precededByPointerDown: false }));
    expect(analyzeInteraction(s).verdict).toBe("scripted");
  });

  it("does not treat keyboard / screen-reader activation as scripted", () => {
    const s = fingerTaps();
    s.pointers = [];
    s.clicks = s.clicks.map((c) => ({ ...c, precededByPointerDown: false }));
    expect(analyzeInteraction(s).verdict).not.toBe("scripted");
  });
});

describe("knowledge bases", () => {
  it("parses user agents", () => {
    const ios = parseUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1");
    expect([ios.os, ios.browser, ios.engine, ios.claimedForm]).toEqual(["iOS", "Safari", "WebKit", "phone"]);
    const crios = parseUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1");
    expect([crios.browser, crios.engine]).toEqual(["Chrome (iOS)", "WebKit"]);
    const samsung = parseUA("Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36");
    expect([samsung.os, samsung.browser, samsung.model, samsung.engine]).toEqual(["Android", "Samsung Internet", "SM-S928B", "Blink"]);
    const tablet = parseUA("Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36");
    expect(tablet.claimedForm).toBe("tablet");
    const wv = parseUA("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0");
    expect([wv.webview, wv.inApp, wv.model]).toEqual(["android-webview", "Instagram", "Pixel 8"]);
    expect(parseUA("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36").headless).toBe(true);
  });

  it("classifies GPUs", () => {
    expect(classifyGpu("ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)").class).toBe("mobile");
    expect(classifyGpu("ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)").class).toBe("desktop");
    expect(classifyGpu("Apple GPU").class).toBe("apple");
    expect(classifyGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)").class).toBe("desktop");
    expect(classifyGpu("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)").class).toBe("software");
    expect(classifyGpu("Android Emulator OpenGL ES Translator (Apple M1)").class).toBe("emulator");
    expect(classifyGpu("Mali-G78").family).toBe("mali");
    expect(cleanRenderer("ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)")).toBe("Adreno (TM) 740");
  });

  it("classifies camera labels", () => {
    expect(classifyCameraLabel("OBS Virtual Camera").kind).toBe("virtual");
    expect(classifyCameraLabel("camera2 1, facing front").kind).toBe("android");
    expect(classifyCameraLabel("Back Triple Camera").kind).toBe("ios");
    expect(classifyCameraLabel("HD Pro Webcam C920 (046d:082d)").kind).toBe("desktop-webcam");
    expect(classifyCameraLabel("fake_device_0").kind).toBe("synthetic");
    expect(classifyCameraLabel("Jane’s iPhone Camera").kind).toBe("continuity");
    expect(classifyCameraLabel("Cam Link 4K").kind).toBe("capture-card");
  });

  it("recognises emulator models", () => {
    expect(matchEmulatorModel("sdk_gphone64_arm64")).toBeTruthy();
    expect(matchEmulatorModel("Pixel 8")).toBeNull();
  });
});

describe("flash permutation test", () => {
  it("does not credit colour drift that only correlates by chance", () => {
    const schedule = (["red", "blue", "green", "red"] as const).map((color, i) => ({ color, start: i * 250, end: (i + 1) * 250 }));
    // A generated feed cycling its hue — like a canvas-injected stream.
    const metrics = Array.from({ length: 30 }, (_, i) => {
      const hue = (i * 7 * Math.PI) / 180;
      return { t: i * 33.3, meanY: 100, stdY: 30, r: 120 + 60 * Math.cos(hue), g: 120 + 60 * Math.cos(hue - 2.1), b: 120 + 60 * Math.cos(hue + 2.1), diff: 1, zeroDiff: 0.3, temporalSigma: 1, spatialSigma: 2, clipped: 0 };
    });
    expect(analyzeFlash(metrics, ["red", "blue", "green", "red"], schedule).verdict).not.toBe("responsive");
  });
});
