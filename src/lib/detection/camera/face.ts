import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { FaceSignals } from "../types";
import { errorMessage, withTimeout } from "../util/safe";
import { mean, median, std } from "../util/stats";

const WASM_BASE = "/mediapipe/wasm";
const MODEL = "/models/face_landmarker.task";

let loader: Promise<FaceLandmarker> | null = null;

/** MediaPipe's wasm prints INFO/W-level logs through console.error; keep them out of error tooling. */
const MEDIAPIPE_LOG = /^(INFO:|[IWE]\d{4} \d)/;
export async function quiet<T>(fn: () => T | Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && MEDIAPIPE_LOG.test(args[0])) return;
    orig(...args);
  };
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
}
let loadError: string | null = null;

/** Start loading MediaPipe FaceLandmarker (478 landmarks + blendshapes + head pose) in the background. */
export function preloadFaceDetector(): Promise<FaceLandmarker> {
  if (!loader) {
    loader = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "IMAGE" as const,
        numFaces: 3,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      let lm: FaceLandmarker;
      try {
        lm = await quiet(() => FaceLandmarker.createFromOptions(fileset, opts("GPU")));
      } catch {
        lm = await quiet(() => FaceLandmarker.createFromOptions(fileset, opts("CPU")));
      }
      // Warm-up inference: the first detect() initialises the graph (seconds on slow devices);
      // pay that while the user reads the scan result, not during the head-turn challenge.
      await quiet(() => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        lm.detect(c);
      }).catch(() => undefined);
      return lm;
    })();
    loader.catch((e) => {
      loadError = errorMessage(e);
    });
  }
  return loader;
}

/** One analysed frame: normalised landmarks of the primary face plus derived measurements. */
export interface FrameFace {
  frame: number;
  faces: number;
  landmarks: { x: number; y: number }[] | null;
  pose: { yaw: number; pitch: number; roll: number } | null;
  blink: number | null;
  score: number | null;
}

const DEG = 180 / Math.PI;

/** Euler angles from MediaPipe's 4×4 facial transformation matrix (column-major). */
export function poseFromMatrix(data: number[]): { yaw: number; pitch: number; roll: number } | null {
  if (!Array.isArray(data) || data.length < 16) return null;
  const r = (row: number, col: number) => data[col * 4 + row];
  const sy = Math.hypot(r(0, 0), r(1, 0));
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * DEG;
  const yaw = Math.atan2(-r(2, 0), sy) * DEG;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * DEG;
  if (![yaw, pitch, roll].every(Number.isFinite)) return null;
  return { yaw, pitch, roll };
}

function bbox(pts: { x: number; y: number }[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Mean landmark displacement between frames, relative to face width; `rigidFree` first removes translation + scale. */
function landmarkMotion(a: { x: number; y: number }[], b: { x: number; y: number }[], rigidFree: boolean): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  const norm = (pts: { x: number; y: number }[]) => {
    const bb = bbox(pts);
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const s = Math.max(1e-6, bb.w);
    return pts.map((p) => ({ x: (p.x - cx) / s, y: (p.y - cy) / s }));
  };
  const A = rigidFree ? norm(a) : a;
  const B = rigidFree ? norm(b) : b;
  const scale = rigidFree ? 1 : Math.max(1e-6, bbox(a).w);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.hypot(A[i].x - B[i].x, A[i].y - B[i].y);
  return sum / n / scale;
}

/** Pure summary of per-frame landmark results (unit tested). */
export function summarizeFaces(frames: FrameFace[]): Omit<FaceSignals, "available" | "error"> {
  const withFace = frames.filter((f) => f.landmarks && f.landmarks.length);
  const boxes = withFace.map((f) => {
    const b = bbox(f.landmarks!);
    return { frame: f.frame, x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), score: round(f.score ?? 1) };
  });
  const poses = withFace.map((f) => f.pose).filter((p): p is NonNullable<typeof p> => p !== null);
  const blinks = withFace.map((f) => f.blink).filter((b): b is number => b !== null);
  const motions: number[] = [];
  const nonRigid: number[] = [];
  for (let i = 1; i < withFace.length; i++) {
    motions.push(landmarkMotion(withFace[i - 1].landmarks!, withFace[i].landmarks!, false));
    nonRigid.push(landmarkMotion(withFace[i - 1].landmarks!, withFace[i].landmarks!, true));
  }
  const centres = boxes.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));
  const area = boxes.length ? median(boxes.map((b) => b.w * b.h)) : null;
  return {
    model: "landmarker",
    framesAnalyzed: frames.length,
    framesWithFace: withFace.length,
    maxFaces: frames.reduce((m, f) => Math.max(m, f.faces), 0),
    meanScore: withFace.length ? round(mean(withFace.map((f) => f.score ?? 1))) : null,
    boxes,
    movement: centres.length >= 2 ? round((std(centres.map((c) => c.x)) + std(centres.map((c) => c.y))) / Math.max(0.01, mean(boxes.map((b) => b.w))), 4) : null,
    pose: poses.length
      ? {
          yaw: round(median(poses.map((p) => p.yaw)), 1),
          pitch: round(median(poses.map((p) => p.pitch)), 1),
          roll: round(median(poses.map((p) => p.roll)), 1),
          yawSpread: round(std(poses.map((p) => p.yaw)), 2),
          pitchSpread: round(std(poses.map((p) => p.pitch)), 2),
        }
      : null,
    eyeBlink: blinks.length ? { median: round(median(blinks)), max: round(Math.max(...blinks)) } : null,
    landmarkMotion: motions.length ? round(median(motions), 5) : null,
    nonRigidMotion: nonRigid.length ? round(median(nonRigid), 5) : null,
    faceArea: area === null ? null : round(area, 3),
    centered: centres.length ? centres.every((c) => c.x > 0.25 && c.x < 0.75 && c.y > 0.2 && c.y < 0.8) : null,
  };
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export async function detectFaces(frames: HTMLCanvasElement[], waitMs = 3000): Promise<FaceSignals> {
  const base: FaceSignals = { available: false, framesAnalyzed: 0, framesWithFace: 0, maxFaces: 0, meanScore: null, boxes: [], movement: null };
  if (!frames.length) return { ...base, error: "no frames" };
  let landmarker: FaceLandmarker;
  try {
    landmarker = await withTimeout(preloadFaceDetector(), waitMs, "face model load");
  } catch (e) {
    return { ...base, error: loadError ?? errorMessage(e) };
  }
  const perFrame: FrameFace[] = await quiet(() => frames.map((canvas, i) => {
    try {
      const r = landmarker.detect(canvas);
      const lm = r.faceLandmarks ?? [];
      const primary = lm[0];
      const blend = r.faceBlendshapes?.[0]?.categories ?? [];
      const bl = blend.find((c) => c.categoryName === "eyeBlinkLeft")?.score;
      const br = blend.find((c) => c.categoryName === "eyeBlinkRight")?.score;
      return {
        frame: i,
        faces: lm.length,
        landmarks: primary ? primary.map((p) => ({ x: p.x, y: p.y })) : null,
        pose: r.facialTransformationMatrixes?.[0] ? poseFromMatrix(r.facialTransformationMatrixes[0].data) : null,
        blink: bl !== undefined && br !== undefined ? (bl + br) / 2 : null,
        score: primary ? 1 : null,
      };
    } catch {
      return { frame: i, faces: 0, landmarks: null, pose: null, blink: null, score: null };
    }
  }));
  return { available: true, ...summarizeFaces(perFrame) };
}
