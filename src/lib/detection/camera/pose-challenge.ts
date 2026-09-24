import { errorMessage, withTimeout } from "../util/safe";
import { poseFromMatrix, preloadFaceDetector } from "./face";
import {
  baselineOf,
  CHEEK_A,
  CHEEK_B,
  faceGeometry,
  FOREHEAD,
  KEY_LANDMARKS,
  NOSE_BASE,
  NOSE_TIP,
  TURN_THRESHOLD,
  type Active3DSignals,
  type PoseDir,
  type PoseFrame,
} from "./liveness3d";

export interface PoseProgress {
  target: PoseDir | null;
  progress: number;
  achieved: PoseDir[];
  face: boolean;
  /** False until the head has been near frontal once (a turned start doesn't count). */
  armed: boolean;
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
};

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Live head-turn challenge on an already-playing front-camera <video>.
 * Tracks landmarks with FaceLandmarker on every new frame until the user has
 * turned in each requested direction (in order), or the time runs out.
 */
export async function runPoseChallenge(
  video: RVFCVideo,
  challenge: PoseDir[],
  onProgress: (p: PoseProgress) => void,
  opts: { timeoutMs?: number; noFaceMs?: number; isCancelled?: () => boolean } = {},
): Promise<Active3DSignals> {
  const timeoutMs = opts.timeoutMs ?? 9000;
  const noFaceMs = opts.noFaceMs ?? 3000;
  const base: Active3DSignals = { status: "unavailable", challenge, achieved: [], window: null, frames: 0, track: [], keyFrames: { frontal: null, left: null, right: null } };
  let landmarker: Awaited<ReturnType<typeof preloadFaceDetector>>;
  try {
    landmarker = await withTimeout(preloadFaceDetector(), 8000, "face model load");
  } catch (e) {
    return { ...base, error: errorMessage(e) };
  }

  const track: PoseFrame[] = [];
  let baseline: number | null = null;
  let armed = false;
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
  const keyFrames: Active3DSignals["keyFrames"] = { frontal: null, left: null, right: null };
  const samples: number[][] = [];
  let maxRel = -Infinity;
  let minRel = Infinity;
  let frontalAbs = Infinity;
  const achieved: PoseDir[] = [];
  let stage = 0;
  let frames = 0;
  const start = performance.now();
  let lastFace = start;
  let sawFace = false;
  // Record how the phone itself rotates while the head turns (a camera orbiting a static prop).
  const gyro: number[][] = [];
  const onMotion = (e: DeviceMotionEvent) => {
    const r = e.rotationRate;
    if (!r || (r.alpha === null && r.beta === null && r.gamma === null) || gyro.length >= 600) return;
    gyro.push([Math.round(performance.now()), r4(r.alpha ?? 0), r4(r.beta ?? 0), r4(r.gamma ?? 0)]);
  };
  window.addEventListener("devicemotion", onMotion);

  const status = await new Promise<Active3DSignals["status"]>((resolve) => {
    let done = false;
    const finish = (s: Active3DSignals["status"]) => {
      if (done) return;
      done = true;
      resolve(s);
    };
    const step = () => {
      if (done) return;
      const now = performance.now();
      if (opts.isCancelled?.()) return finish("error");
      if (now - start > timeoutMs) return finish("timeout");
      if (!sawFace && now - start > noFaceMs && frames >= 5) return finish("no-face");
      try {
        // IMAGE mode on every frame: independent landmark estimates (no temporal smoothing to
        // blur the geometry) and no running-mode switch before detectFaces() reuses the graph.
        const r = landmarker.detect(video);
        frames++;
        const lm = r.faceLandmarks?.[0];
        if (lm && lm.length > CHEEK_B) {
          sawFace = true;
          lastFace = now;
          const at = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y });
          const g = faceGeometry({ nose: at(NOSE_TIP), a: at(CHEEK_A), b: at(CHEEK_B), top: at(FOREHEAD), base: at(NOSE_BASE) });
          if (baseline === null) baseline = baselineOf(g.nose);
          const rel = g.nose - baseline;
          const pose = r.facialTransformationMatrixes?.[0] ? poseFromMatrix(r.facialTransformationMatrixes[0].data) : null;
          track.push({ t: Math.round(now), nose: r4(g.nose), yaw: pose ? Math.round(pose.yaw * 10) / 10 : null, faceW: r4(g.width), faceH: r4(g.height), faces: r.faceLandmarks.length });
          const flat = () => KEY_LANDMARKS.flatMap((i) => [r4(lm[i].x), r4(lm[i].y)]);
          samples.push(flat());
          if (Math.abs(rel) < frontalAbs && achieved.length === 0) {
            frontalAbs = Math.abs(rel);
            keyFrames.frontal = flat();
          }
          if (rel > maxRel) {
            maxRel = rel;
            keyFrames.left = flat();
          }
          if (rel < minRel) {
            minRel = rel;
            keyFrames.right = flat();
          }
          // Same rule as the server: a turn counts only once the head has been near frontal first.
          if (Math.abs(rel) < TURN_THRESHOLD) armed = true;
          const target = challenge[stage] ?? null;
          const signed = target === "left" ? rel : target === "right" ? -rel : 0;
          if (armed && target && signed >= TURN_THRESHOLD) {
            achieved.push(target);
            stage++;
          }
          onProgress({ target: challenge[stage] ?? null, progress: armed ? Math.max(0, Math.min(1, signed / TURN_THRESHOLD)) : 0, achieved: [...achieved], face: true, armed });
          if (stage >= challenge.length) return finish("completed");
        } else {
          onProgress({ target: challenge[stage] ?? null, progress: 0, achieved: [...achieved], face: now - lastFace < 400, armed });
        }
      } catch {
        /* skip frame */
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    step();
  });

  window.removeEventListener("devicemotion", onMotion);
  // Keep the payload small: ≤ 150 evenly spaced track points, ≤ 300 gyro samples.
  const every = Math.max(1, Math.ceil(track.length / 150));
  const gEvery = Math.max(1, Math.ceil(gyro.length / 300));
  return {
    status,
    frameAspect: Math.round(aspect * 10000) / 10000,
    challenge,
    achieved,
    window: { start: Math.round(start), end: Math.round(performance.now()) },
    frames,
    track: track.filter((_, i) => i % every === 0),
    keyFrames,
    // Raw landmark frames across the whole turn (≤ 40), for the server's own geometry.
    samples: samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 40)) === 0).slice(0, 40),
    gyro: gyro.filter((_, i) => i % gEvery === 0),
  };
}
