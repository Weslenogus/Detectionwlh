import { describe, expect, it } from "vitest";
import { analyzeActive3d, DEPTH_SLOPE_LIVE, gyroRotation, homographyResidual, reachedDirections, type Active3DSignals, type PoseFrame } from "../camera/liveness3d";
import data from "./data/mediapipe-head-turns.json";
import { flattenPts, headTurn, headView, syntheticHead } from "./fixtures";

const head = syntheticHead;
const view = headView;
const flatten = flattenPts;

describe("3D liveness geometry", () => {
  it("fits a flat face with a single homography", () => {
    const h = head(true);
    expect(homographyResidual(view(h, 0), view(h, 28))!).toBeLessThan(1e-6);
  });

  it("leaves a large residual for a real 3D face", () => {
    const h = head(false);
    expect(homographyResidual(view(h, 0), view(h, 28))!).toBeGreaterThan(0.012);
  });

  it("reads the turn order from the nose track", () => {
    const track: PoseFrame[] = [0, 0.05, 0.14, 0.2, 0.05, -0.1, -0.18, 0].map((nose, i) => ({ t: i * 100, nose, yaw: null, faceW: 0.3, faces: 1 }));
    expect(reachedDirections(track)).toEqual(["left", "right"]);
  });

  it("classifies a real head turn as live 3D and a tilted photo as flat", () => {
    const live = analyzeActive3d(headTurn("live", ["left", "right"]), ["left", "right"]);
    expect(live.verdict).toBe("live-3d");
    expect(live.orderOk).toBe(true);
    expect(live.depthSlope!).toBeGreaterThan(0.08);
    const photo = analyzeActive3d(headTurn("flat"), ["left", "right"]);
    expect(photo.verdict).toBe("flat");
    expect(photo.tilt!).toBeGreaterThan(0.07);
    expect(analyzeActive3d(headTurn("live", ["left", "right"]), ["right", "left"]).orderOk).toBe(false);
    expect(analyzeActive3d(headTurn("still"), ["left", "right"]).verdict).toBe("incomplete");
  });

  it("is not fooled by roll, distance or a turned start", () => {
    const h = syntheticHead(false, 5);
    const rollPts = (deg: number, scale = 1) => {
      const a = (deg * Math.PI) / 180;
      return headView(h, 0).map((p) => ({ x: 0.5 + scale * ((p.x - 0.5) * Math.cos(a) - (p.y - 0.5) * Math.sin(a)), y: 0.5 + scale * ((p.x - 0.5) * Math.sin(a) + (p.y - 0.5) * Math.cos(a)) }));
    };
    // A live face rolled 30° and moved closer: no turn, but certainly not "flat".
    const rolled: Active3DSignals = { ...headTurn("still"), samples: [0, 10, 20, 30, 15].map((d, i) => flatten(rollPts(d, 1 + i * 0.1))) };
    const r = analyzeActive3d(rolled, ["left", "right"]);
    expect(r.verdict).toBe("incomplete");
    expect(r.tilt!).toBeLessThan(0.02);
    // Starting ~20° turned: the clamped baseline and the "move into it" rule still read right → left.
    const offset = headTurn("live", ["right", "left"]);
    offset.track = offset.track.map((f) => ({ ...f, nose: f.nose + 0.18 }));
    expect(analyzeActive3d(offset, ["right", "left"]).reached).toEqual(["right", "left"]);
  });

  it("reads the MediaPipe geometry of a rendered face-mesh turn", () => {
    // Per-frame (nose shift, planarity residual) measured on MediaPipe landmarks of a rendered 3D face mesh
    // and of the same portrait printed flat and tilted ±35°: residual ≈ 0.17 × shift for the mesh.
    const mesh = [[0.317, 0.0566], [0.124, 0.0228], [-0.15, 0.0274], [-0.418, 0.0724], [-0.172, 0.0311]];
    for (const [n, r] of mesh) expect(r / Math.abs(n)).toBeGreaterThan(DEPTH_SLOPE_LIVE);
  });

  it("integrates the gyroscope into phone rotation", () => {
    expect(gyroRotation(headTurn("live", ["left", "right"], { phoneRotationDeg: 40 }).gyro)).toBeGreaterThan(30);
    expect(gyroRotation(headTurn("live", ["left", "right"], { phoneRotationDeg: 3 }).gyro)).toBeLessThan(5);
    expect(analyzeActive3d(headTurn("live", ["right", "left"]), ["right", "left"]).verdict).toBe("live-3d");
  });
});

describe("3D liveness on recorded MediaPipe output", () => {
  // Landmarks recorded from e2e/face-clips.mjs clips played through Chromium's fake camera.
  const rec = data as unknown as Record<string, Active3DSignals>;

  it("declines a photo tilted ±35°, even when the recording starts mid-tilt", () => {
    for (const k of ["photoTilt", "photoTiltTurnedStart"]) {
      const r = analyzeActive3d(rec[k], rec[k].challenge);
      expect(r.verdict, k).toBe("flat");
      expect(r.reached, k).toEqual([]);
    }
  });

  it("reads a turning 3D face mesh as 3D, and a clip that ignores the order as out of order", () => {
    const turn = analyzeActive3d(rec.meshTurn, rec.meshTurn.challenge);
    expect(turn.verdict).toBe("live-3d");
    expect(turn.orderOk).toBe(true);
    const loop = analyzeActive3d(rec.meshLoopingClip, rec.meshLoopingClip.challenge);
    expect(loop.verdict).not.toBe("flat");
    expect(loop.depthSlope!).toBeGreaterThan(DEPTH_SLOPE_LIVE);
  });
});
