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

const MAX_SNAPS = 4;
const SNAP_EVERY_MS = 900;

type Box = { x0: number; y0: number; x1: number; y1: number };
type Lm = { x: number; y: number }[];

const boxOf = (lm: Lm): Box => ({
  x0: Math.min(...lm.map((p) => p.x)),
  y0: Math.min(...lm.map((p) => p.y)),
  x1: Math.max(...lm.map((p) => p.x)),
  y1: Math.max(...lm.map((p) => p.y)),
});

function snapshot(video: HTMLVideoElement): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")?.drawImage(video, 0, 0);
  return c;
}

/**
 * Faces outside the primary face's box, found on four overlapping 60 % crops of a snapshot.
 * Rows are [cx, cy, width, nose] in full-frame coordinates (width/nose in isotropic units).
 */
function closeUpFaces(landmarker: { detect(c: HTMLCanvasElement): { faceLandmarks?: Lm[] } }, frame: HTMLCanvasElement, primary: Box, aspect: number): number[][] {
  const W = frame.width;
  const H = frame.height;
  const cw = Math.round(W * 0.6);
  const ch = Math.round(H * 0.6);
  const crop = document.createElement("canvas");
  crop.width = cw;
  crop.height = ch;
  const ctx = crop.getContext("2d");
  if (!ctx) return [];
  const found: number[][] = [];
  for (const [ox, oy] of [[0, 0], [W - cw, 0], [0, H - ch], [W - cw, H - ch]]) {
    ctx.drawImage(frame, ox, oy, cw, ch, 0, 0, cw, ch);
    let faces: Lm[] = [];
    try {
      faces = crop.width ? (landmarker.detect(crop).faceLandmarks ?? []) : [];
    } catch {
      continue;
    }
    for (const f of faces) {
      if (f.length <= CHEEK_B) continue;
      const full = (i: number) => ({ x: ((ox + f[i].x * cw) / W) * aspect, y: (oy + f[i].y * ch) / H });
      const cx = (ox + ((f[CHEEK_A].x + f[CHEEK_B].x) / 2) * cw) / W;
      const cy = (oy + ((f[CHEEK_A].y + f[CHEEK_B].y) / 2) * ch) / H;
      if (cx >= primary.x0 && cx <= primary.x1 && cy >= primary.y0 && cy <= primary.y1) continue; // the person themself
      if (found.some((r) => Math.hypot(r[0] - cx, r[1] - cy) < 0.05)) continue; // same face in two crops
      const g = faceGeometry({ nose: full(NOSE_TIP), a: full(CHEEK_A), b: full(CHEEK_B), top: full(FOREHEAD), base: full(NOSE_BASE) });
      found.push([r4(cx), r4(cy), r4(g.width), r4(g.nose)]);
    }
  }
  return found;
}

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
  const others: number[][] = [];
  // Full-resolution snapshots for the close-up scan of small faces (an ID card photo).
  const snaps: { t: number; canvas: HTMLCanvasElement; box: Box }[] = [];
  let lastSnap = -Infinity;
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
        // The person doing the challenge is the largest face; any other face (an ID card photo held
        // up or composited in, a second person) is recorded separately.
        const faces = (r.faceLandmarks ?? []).filter((f) => f.length > CHEEK_B);
        const widthOf = (f: { x: number; y: number }[]) => Math.hypot((f[CHEEK_B].x - f[CHEEK_A].x) * aspect, f[CHEEK_B].y - f[CHEEK_A].y);
        const ranked = faces.map((f, i) => ({ i, w: widthOf(f) })).sort((p, q) => q.w - p.w);
        const pi = ranked[0]?.i ?? 0;
        const lm = faces[pi];
        const second = ranked[1] ? faces[ranked[1].i] : null;
        if (second && others.length < 300) {
          const at2 = (i: number) => ({ x: second[i].x * aspect, y: second[i].y });
          const g2 = faceGeometry({ nose: at2(NOSE_TIP), a: at2(CHEEK_A), b: at2(CHEEK_B), top: at2(FOREHEAD), base: at2(NOSE_BASE) });
          others.push([Math.round(now), r4((second[CHEEK_A].x + second[CHEEK_B].x) / 2), r4((second[CHEEK_A].y + second[CHEEK_B].y) / 2), r4(g2.width), r4(g2.nose)]);
        }
        if (lm) {
          sawFace = true;
          lastFace = now;
          if (snaps.length < MAX_SNAPS && now - lastSnap >= SNAP_EVERY_MS) {
            const c = snapshot(video);
            if (c) {
              snaps.push({ t: Math.round(now), canvas: c, box: boxOf(lm) });
              lastSnap = now;
            }
          }
          const at = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y });
          const g = faceGeometry({ nose: at(NOSE_TIP), a: at(CHEEK_A), b: at(CHEEK_B), top: at(FOREHEAD), base: at(NOSE_BASE) });
          if (baseline === null) baseline = baselineOf(g.nose);
          const rel = g.nose - baseline;
          const matrix = r.facialTransformationMatrixes?.[pi];
          const pose = matrix ? poseFromMatrix(matrix.data) : null;
          track.push({ t: Math.round(now), nose: r4(g.nose), yaw: pose ? Math.round(pose.yaw * 10) / 10 : null, faceW: r4(g.width), faceH: r4(g.height), faces: faces.length });
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
  // Small faces (a card photo is ~5 % of the frame) are below the selfie detector's range on the
  // whole frame; four overlapping crops present them at twice the size.
  const closeUp: number[][] = [];
  for (const snap of snaps) {
    for (const row of closeUpFaces(landmarker, snap.canvas, snap.box, aspect)) closeUp.push([snap.t, ...row]);
  }
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
    others: others.filter((_, i) => i % Math.max(1, Math.ceil(others.length / 150)) === 0),
    closeUp: closeUp.slice(0, 24),
    closeUpShots: snaps.length,
  };
}
