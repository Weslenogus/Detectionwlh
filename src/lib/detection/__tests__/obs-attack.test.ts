/**
 * The "renamed OBS camera" attack: a desktop emulating a phone, OBS Virtual Camera renamed to
 * an Android lens name, feeding either a still image (ID card + face) or the attacker's real
 * webcam with a doctored ID card pasted in. The camera must be caught on its own merits, even
 * if the device spoof were perfect — so these run on a genuine Pixel's device signals.
 */
import { describe, expect, it } from "vitest";
import { analyzeNoiseMap, NOISE_GRID, noiseVerdict } from "../camera/frame-analysis";
import { evaluate } from "../engine";
import type { Report } from "../types";
import { bundle, fingerTaps, gauss, handheldMotion, noiseMapFixture, obsRenamedAsPhone, physicalCamera, realPixel, rng } from "./fixtures";

const run = (camera: ReturnType<typeof physicalCamera>) =>
  evaluate(bundle(realPixel(), { motion: handheldMotion(3, 11, true), interaction: fingerTaps(), camera }), {
    source: "server",
    now: 0,
    id: "rep_test",
    requireCamera: true,
    requireDepth: Boolean(camera.active3d),
  });

const finding = (r: Report, id: string) => r.categories.flatMap((c) => c.findings).find((f) => f.id === id);

/** Tile mosaics as the capture loop produces them: textured scene + per-frame sensor noise, optional frozen regions. */
function mosaics(frames: number, frozen: (tile: number) => boolean, noise = 2.2) {
  const { cols, rows, size } = NOISE_GRID;
  const W = cols * size;
  const H = rows * size;
  const r = rng(4);
  const scene = Array.from({ length: W * H }, (_, i) => 60 + ((i * 37) % 90) + 20 * Math.sin(i / 7));
  const still = scene.map((v) => Math.round(v + gauss(r) * noise));
  return Array.from({ length: frames }, () => {
    const out = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      const tile = Math.floor(y / size) * cols + Math.floor(x / size);
      const v = frozen(tile) ? still[i] : Math.round(scene[i] + gauss(r) * noise);
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    return out;
  });
}

describe("sensor-noise map", () => {
  it("sees fresh noise everywhere on a physical sensor", () => {
    expect(analyzeNoiseMap(mosaics(20, () => false))?.verdict).toBe("sensor");
  });

  it("finds an ID card pasted over a live feed", () => {
    const m = analyzeNoiseMap(mosaics(20, (t) => t === 18 || t === 19 || t === 20))!;
    expect(m.verdict).toBe("composite");
    expect(m.tiles.filter((t) => t.state === "static").map((t) => [t.c, t.r])).toEqual([[0, 3], [1, 3], [2, 3]]);
  });

  it("finds a still image and ignores whole-frame repeats of a live feed", () => {
    expect(analyzeNoiseMap(mosaics(20, () => true))?.verdict).toBe("static");
    const live = mosaics(20, () => false);
    const withRepeats = live.flatMap((f, i) => (i % 4 === 0 ? [f, f] : [f]));
    expect(analyzeNoiseMap(withRepeats)?.verdict).toBe("sensor");
  });

  it("does not mistake uniform colour changes (a generated feed) for sensor noise", () => {
    const { cols, rows, size } = NOISE_GRID;
    const frames = Array.from({ length: 20 }, (_, k) => {
      const out = new Uint8ClampedArray(cols * size * rows * size * 4);
      for (let i = 0; i < out.length; i += 4) {
        out[i] = out[i + 1] = out[i + 2] = 60 + ((i / 4) % 50) + k * 3;
        out[i + 3] = 255;
      }
      return out;
    });
    expect(analyzeNoiseMap(frames)?.verdict).toBe("static");
  });

  it("re-derives the verdict from tile statistics (a client-sent verdict is ignored)", () => {
    const forged = noiseMapFixture("composite");
    expect(forged.verdict).toBe("sensor");
    expect(noiseVerdict(forged.tiles, forged.pairs, forged.duplicatePairs).verdict).toBe("composite");
  });
});

describe("renamed OBS virtual camera on an emulated phone", () => {
  it("control: the genuine phone camera is approved", () => {
    const cam = physicalCamera("android");
    cam.front!.noiseMap = noiseMapFixture("sensor");
    const r = run(cam);
    expect(r.camera.cameraClass).toBe("physical");
    expect(finding(r, "camera.label-driver")?.status).toBe("pass");
    expect(r.decision).toBe("approve");
  });

  it("still image of an ID card and a face: declined", () => {
    const r = run(obsRenamedAsPhone("still"));
    expect(r.camera.cameraClass).not.toBe("physical");
    expect(finding(r, "camera.label-driver")?.status).toBe("fail");
    expect(finding(r, "camera.noise-map")?.value).toMatch(/^frozen/);
    expect(r.camera.depth?.verdict).toBe("flat");
    expect(r.decision).toBe("decline");
  });

  it("real webcam relayed through OBS with a doctored ID pasted in: declined despite a live 3D face and flash reflection", () => {
    const cam = obsRenamedAsPhone("relay");
    const r = run(cam);
    // What the attacker gets right…
    expect(r.camera.liveness).toBe("responsive");
    expect(r.camera.depth?.verdict).toBe("live-3d");
    // …and what still gives it away.
    expect(finding(r, "camera.label-driver")?.status).toBe("fail");
    expect(finding(r, "camera.noise-map")?.value).toMatch(/^composited/);
    expect(finding(r, "camera.second-face")?.status).toBe("fail");
    expect(r.camera.cameraClass).toBe("virtual");
    expect(r.decision).toBe("decline");
  });

  it("each giveaway alone is enough to stop an approval", () => {
    const base = () => {
      const c = physicalCamera("android");
      c.front!.noiseMap = noiseMapFixture("sensor");
      return c;
    };
    const renamed = base();
    renamed.front!.settings = { deviceId: "dev-front", width: 1280, height: 720 };
    renamed.front!.capabilities = { width: { max: 1920 }, height: { max: 1080 } };
    renamed.devicesAfter = renamed.devicesAfter.map((d) => ({ ...d, facingMode: [] }));
    const pasted = base();
    pasted.front!.noiseMap = noiseMapFixture("composite");
    const idHeldUp = base();
    idHeldUp.front!.face = { ...idHeldUp.front!.face!, maxFaces: 2 };
    for (const [name, cam] of [["renamed", renamed], ["pasted", pasted], ["id held up", idHeldUp]] as const) {
      expect(run(cam).decision, name).not.toBe("approve");
    }
  });
});
