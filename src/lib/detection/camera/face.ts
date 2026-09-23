import type { FaceDetector } from "@mediapipe/tasks-vision";
import type { FaceSignals } from "../types";
import { errorMessage, withTimeout } from "../util/safe";
import { mean, std } from "../util/stats";

const WASM_BASE = "/mediapipe/wasm";
const MODEL = "/models/blaze_face_short_range.tflite";

let loader: Promise<FaceDetector> | null = null;
let loadError: string | null = null;

/** Start loading BlazeFace (MediaPipe) in the background; safe to call repeatedly. */
export function preloadFaceDetector(): Promise<FaceDetector> {
  if (!loader) {
    loader = (async () => {
      const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      try {
        return await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        });
      } catch {
        return await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        });
      }
    })();
    loader.catch((e) => {
      loadError = errorMessage(e);
    });
  }
  return loader;
}

export async function detectFaces(frames: HTMLCanvasElement[], waitMs = 2500): Promise<FaceSignals> {
  const base: FaceSignals = { available: false, framesAnalyzed: 0, framesWithFace: 0, maxFaces: 0, meanScore: null, boxes: [], movement: null };
  if (!frames.length) return { ...base, error: "no frames" };
  let detector: FaceDetector;
  try {
    detector = await withTimeout(preloadFaceDetector(), waitMs, "face model load");
  } catch (e) {
    return { ...base, error: loadError ?? errorMessage(e) };
  }
  const boxes: FaceSignals["boxes"] = [];
  let withFace = 0;
  let maxFaces = 0;
  const scores: number[] = [];
  frames.forEach((canvas, i) => {
    try {
      const res = detector.detect(canvas);
      const dets = res.detections ?? [];
      if (dets.length) withFace++;
      maxFaces = Math.max(maxFaces, dets.length);
      for (const d of dets) {
        const s = d.categories?.[0]?.score ?? 0;
        scores.push(s);
        const bb = d.boundingBox;
        if (bb)
          boxes.push({
            frame: i,
            x: Math.round((bb.originX / canvas.width) * 1000) / 1000,
            y: Math.round((bb.originY / canvas.height) * 1000) / 1000,
            w: Math.round((bb.width / canvas.width) * 1000) / 1000,
            h: Math.round((bb.height / canvas.height) * 1000) / 1000,
            score: Math.round(s * 1000) / 1000,
          });
      }
    } catch {
      /* skip frame */
    }
  });
  // Micro-movement of the primary face centre across the capture, relative to face size.
  const primary = boxes.filter((b, idx, arr) => arr.findIndex((o) => o.frame === b.frame) === idx);
  const movement =
    primary.length >= 2
      ? (std(primary.map((b) => b.x + b.w / 2)) + std(primary.map((b) => b.y + b.h / 2))) / Math.max(0.01, mean(primary.map((b) => b.w)))
      : null;
  return {
    available: true,
    framesAnalyzed: frames.length,
    framesWithFace: withFace,
    maxFaces,
    meanScore: scores.length ? Math.round(mean(scores) * 1000) / 1000 : null,
    boxes,
    movement: movement === null ? null : Math.round(movement * 10000) / 10000,
  };
}
