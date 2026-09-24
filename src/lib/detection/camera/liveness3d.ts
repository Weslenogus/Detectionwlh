/**
 * Active 3D liveness (pure analysis — runs in the browser and again on the server).
 *
 * During a short, server-randomised head-turn challenge we track 478 face
 * landmarks and keep three key frames (frontal, max-left, max-right):
 *
 *  1. Order: the head must reach the requested directions in the issued order.
 *     A pre-recorded video can't know the order in advance.
 *  2. Parallax: the nose tip sits ~⅓ face-width in front of the cheeks, so as a
 *     real head yaws the nose shifts strongly relative to the face outline.
 *     A photo or screen tilted in front of the camera barely changes it.
 *     Calibrated on MediaPipe itself: a rendered 3D face mesh turned 35° moves the
 *     nose ±0.48 face widths, while a portrait photo tilted ±35° in front of the
 *     camera only reaches ±0.07 — the landmark model's face prior can't invent the
 *     parallax. Each side therefore has to reach ±0.15 (≈ 12° of real head turn).
 *  3. Foreshortening without parallax: tilting a photo narrows the face (width /
 *     height drops ≥ 10 %) while the nose stays centred — a real head can't do
 *     that, its nose always leads the turn. Pitch only widens the ratio.
 *  4. Planarity consistency: any view of a flat face is related to another by one
 *     homography. On landmark streams the residual grows ≈ 0.17 × nose shift; a
 *     stream whose landmarks move as one plane despite a large shift is fabricated.
 *  5. Device rotation: if the phone rotated as much as the "head", the camera
 *     orbited a static object instead of a person turning.
 *
 * All measurements are roll-invariant and use isotropic coordinates (normalised
 * x is rescaled by the frame aspect ratio).
 */
import type { MotionSignals } from "../types";
import { median, pearson } from "../util/stats";

export type PoseDir = "left" | "right";

/** Stable landmarks spread over the face at different depths (MediaPipe FaceMesh indices). */
export const KEY_LANDMARKS = [
  1, 2, 4, 6, 168, 10, 152, 234, 454, 127, 356, 93, 323, 132, 361, 58, 288, 172, 397, 136, 365, 150, 379, 149, 378, 176, 400, 148, 377, 21,
  251, 54, 284, 103, 332, 67, 297, 109, 338, 33, 133, 362, 263, 159, 145, 386, 374, 70, 105, 107, 336, 334, 300, 61, 291, 0, 17, 13, 14, 50,
  280, 205, 425,
];
export const NOSE_TIP = 1;
/** Subject's right / left face contour (image-left / image-right in a raw, unmirrored frame). */
export const CHEEK_A = 234;
export const CHEEK_B = 454;
/** Forehead top and nose base: a face height the jaw (mouth opening) doesn't change. */
export const FOREHEAD = 10;
export const NOSE_BASE = 2;

/** Relative nose offset needed to count a direction as reached (fraction of face width). */
export const TURN_THRESHOLD = 0.15;
/** Largest |offset| the first frame may contribute as the frontal baseline. */
export const BASELINE_CLAMP = 0.05;
/** Face width/height drop (vs the median frontal frame) with a centred nose: a tilted flat face. */
export const FLAT_TILT = 0.1;
/** "Centred nose" for the tilt test (face widths from the baseline). */
export const FLAT_NOSE_MAX = 0.08;
/** Minimum planarity-residual growth per unit of nose shift for a real head. */
export const DEPTH_SLOPE_LIVE = 0.08;
/** Below this, landmarks moved as one plane despite a large nose shift. */
export const DEPTH_SLOPE_FLAT = 0.03;

const IDX = {
  nose: KEY_LANDMARKS.indexOf(NOSE_TIP),
  a: KEY_LANDMARKS.indexOf(CHEEK_A),
  b: KEY_LANDMARKS.indexOf(CHEEK_B),
  top: KEY_LANDMARKS.indexOf(FOREHEAD),
  base: KEY_LANDMARKS.indexOf(NOSE_BASE),
};

export interface PoseFrame {
  t: number;
  /** Nose-tip offset from the face-contour midpoint along the contour axis (face widths; + = user's left). */
  nose: number;
  yaw: number | null;
  faceW: number;
  /** Forehead (10) to nose base (2) distance, isotropic units. */
  faceH?: number;
  faces: number;
}

export interface Active3DSignals {
  status: "completed" | "timeout" | "no-face" | "unavailable" | "error" | "skipped";
  error?: string;
  /** videoWidth / videoHeight of the analysed frames (landmark x is normalised by width, y by height). */
  frameAspect?: number;
  challenge: PoseDir[];
  achieved: PoseDir[];
  window: { start: number; end: number } | null;
  frames: number;
  track: PoseFrame[];
  /** Flattened [x0, y0, x1, y1, …] of KEY_LANDMARKS in normalised image coordinates. */
  keyFrames: { frontal: number[] | null; left: number[] | null; right: number[] | null };
  /** Landmark frames sampled across the challenge, same layout as keyFrames. */
  samples?: number[][];
  /** Gyroscope during the challenge: [t, alpha, beta, gamma] rotation rate (deg/s), t on performance.now(). */
  gyro?: number[][];
}

export interface Active3DAnalysis {
  verdict: "live-3d" | "flat" | "incomplete" | "unavailable";
  orderOk: boolean | null;
  reached: PoseDir[];
  parallax: number | null;
  planarityResidual: number | null;
  /** Planarity residual per unit of nose shift across the sampled frames (≈ 0.17 for a real head). */
  depthSlope: number | null;
  /** Largest face-width drop seen while the nose stayed centred (a tilted flat face). */
  tilt: number | null;
  deviceRotationDeg: number | null;
  yawNoseCorr: number | null;
  durationMs: number | null;
}

type Pt = { x: number; y: number };

const unflatten = (a: number[] | null | undefined, aspect = 1): Pt[] | null => {
  if (!Array.isArray(a) || a.length < 16 || a.length % 2) return null;
  const out: Pt[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) {
    if (typeof a[i] !== "number" || typeof a[i + 1] !== "number" || !Number.isFinite(a[i]) || !Number.isFinite(a[i + 1])) return null;
    out.push({ x: a[i] * aspect, y: a[i + 1] });
  }
  return out;
};

export interface FaceGeom {
  /** Nose offset along the contour axis, in face widths (+ = towards CHEEK_B = user's left). */
  nose: number;
  width: number;
  height: number;
}

/** Roll-invariant face measurements from five landmarks in isotropic coordinates. */
export function faceGeometry(p: { nose: Pt; a: Pt; b: Pt; top: Pt; base: Pt }): FaceGeom {
  const ax = p.b.x - p.a.x;
  const ay = p.b.y - p.a.y;
  const width = Math.hypot(ax, ay) || 1e-6;
  const mx = (p.a.x + p.b.x) / 2;
  const my = (p.a.y + p.b.y) / 2;
  return {
    nose: ((p.nose.x - mx) * ax + (p.nose.y - my) * ay) / (width * width),
    width,
    height: Math.hypot(p.base.x - p.top.x, p.base.y - p.top.y) || 1e-6,
  };
}

/** faceGeometry() of a flattened KEY_LANDMARKS frame. */
export function frameGeometry(pts: Pt[]): FaceGeom | null {
  const g = (i: number) => pts[i];
  if (pts.length < KEY_LANDMARKS.length) return null;
  return faceGeometry({ nose: g(IDX.nose), a: g(IDX.a), b: g(IDX.b), top: g(IDX.top), base: g(IDX.base) });
}

/** The frontal reference: the first tracked offset, clamped so a turned start can't shift the thresholds far. */
export function baselineOf(first: number | undefined): number {
  return typeof first === "number" && Number.isFinite(first) ? Math.max(-BASELINE_CLAMP, Math.min(BASELINE_CLAMP, first)) : 0;
}

/** Hartley normalisation: centroid at origin, mean distance √2. */
function normalise(pts: Pt[]): { p: Pt[]; s: number; cx: number; cy: number } {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const d = pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
  const s = Math.SQRT2 / d;
  return { p: pts.map((q) => ({ x: (q.x - cx) * s, y: (q.y - cy) * s })), s, cx, cy };
}

/** Solve A x = b (n×n) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Least-squares homography src → dst (DLT with h33 = 1) and its mean reprojection
 * error, expressed in units of the destination face width.
 */
export function homographyResidual(src: Pt[], dst: Pt[]): number | null {
  const n = Math.min(src.length, dst.length);
  if (n < 8) return null;
  const S = normalise(src.slice(0, n));
  const D = normalise(dst.slice(0, n));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const { x, y } = S.p[i];
    const { x: u, y: v } = D.p[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const xs = dst.slice(0, n).map((p) => p.x);
  const width = Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
  let err = 0;
  for (let i = 0; i < n; i++) {
    const { x, y } = S.p[i];
    const w = h[6] * x + h[7] * y + 1;
    const u = (h[0] * x + h[1] * y + h[2]) / w;
    const v = (h[3] * x + h[4] * y + h[5]) / w;
    // back to image units
    const pu = u / D.s + D.cx;
    const pv = v / D.s + D.cy;
    err += Math.hypot(pu - dst[i].x, pv - dst[i].y);
  }
  return err / n / width;
}

/** Largest excursion of the integrated rotation rate on any axis (degrees). */
export function gyroRotation(gyro: number[][] | null | undefined): number | null {
  if (!Array.isArray(gyro)) return null;
  const rows = gyro.filter((r) => Array.isArray(r) && r.length >= 4 && r.every((v) => typeof v === "number" && Number.isFinite(v)));
  if (rows.length < 5) return null;
  let best = 0;
  for (let axis = 1; axis <= 3; axis++) {
    let angle = 0;
    let lo = 0;
    let hi = 0;
    for (let i = 1; i < rows.length; i++) {
      const dt = Math.min(0.2, Math.max(0, (rows[i][0] - rows[i - 1][0]) / 1000));
      angle += ((rows[i][axis] + rows[i - 1][axis]) / 2) * dt;
      lo = Math.min(lo, angle);
      hi = Math.max(hi, angle);
    }
    best = Math.max(best, hi - lo);
  }
  return Math.round(best * 10) / 10;
}

/** Largest range of the device orientation angles inside a time window (degrees). */
export function deviceRotation(motion: MotionSignals | null | undefined, window: { start: number; end: number } | null): number | null {
  if (!motion || !window || !Array.isArray(motion.orientation)) return null;
  const inWin = motion.orientation.filter((o) => {
    const t = (motion.startedAt ?? 0) + o[0];
    return t >= window.start && t <= window.end;
  });
  if (inWin.length < 5) return null;
  const range = (xs: number[], circular = false) => {
    if (!xs.length) return 0;
    if (!circular) return Math.max(...xs) - Math.min(...xs);
    const ref = xs[0];
    const d = xs.map((x) => ((x - ref + 540) % 360) - 180);
    return Math.max(...d) - Math.min(...d);
  };
  const a = inWin.map((o) => o[1]).filter((v): v is number => typeof v === "number");
  const b = inWin.map((o) => o[2]).filter((v): v is number => typeof v === "number");
  const g = inWin.map((o) => o[3]).filter((v): v is number => typeof v === "number");
  return Math.round(Math.max(range(a, true), range(b), range(g)) * 10) / 10;
}

/**
 * Directions reached, in order, from the relative nose-offset track. A turn only
 * counts once the head moves into it: frames that start out already turned are ignored.
 */
export function reachedDirections(track: PoseFrame[], threshold = TURN_THRESHOLD): PoseDir[] {
  const out: PoseDir[] = [];
  let armed = false;
  for (const f of track) {
    const dir: PoseDir | null = f.nose >= threshold ? "left" : f.nose <= -threshold ? "right" : null;
    if (!dir) armed = true;
    else if (armed && out[out.length - 1] !== dir) out.push(dir);
  }
  return out;
}

export function analyzeActive3d(a: Active3DSignals | null | undefined, challenge: PoseDir[], motion?: MotionSignals | null): Active3DAnalysis {
  const empty: Active3DAnalysis = {
    verdict: "unavailable",
    orderOk: null,
    reached: [],
    parallax: null,
    planarityResidual: null,
    depthSlope: null,
    tilt: null,
    deviceRotationDeg: null,
    yawNoseCorr: null,
    durationMs: null,
  };
  if (!a || a.status === "skipped" || a.status === "unavailable" || a.status === "error") return empty;
  const aspect = typeof a.frameAspect === "number" && a.frameAspect > 0.2 && a.frameAspect < 5 ? a.frameAspect : 1;
  const raw = Array.isArray(a.track) ? a.track.filter((f) => typeof f?.nose === "number" && Number.isFinite(f.nose)) : [];
  const base = baselineOf(raw[0]?.nose);
  const track = raw.map((f) => ({ ...f, nose: f.nose - base }));
  const reached = reachedDirections(track);
  const orderOk = reached.length >= challenge.length ? challenge.every((d, i) => reached[i] === d) : false;
  const noses = track.map((f) => f.nose);
  const parallax = noses.length ? Math.round((Math.max(...noses) - Math.min(...noses)) * 1000) / 1000 : null;

  // Geometry over the sampled landmark frames (preferred) or the three key frames (older clients).
  const keyed = [a.keyFrames?.frontal, a.keyFrames?.left, a.keyFrames?.right];
  const frames = [...(Array.isArray(a.samples) ? a.samples.slice(0, 48) : []), ...keyed]
    .map((f) => unflatten(f, aspect))
    .filter((p): p is Pt[] => p !== null && p.length >= KEY_LANDMARKS.length);
  const geoms = frames.map((p) => frameGeometry(p)!);
  let planarityResidual: number | null = null;
  let depthSlope: number | null = null;
  let tilt: number | null = null;
  if (frames.length >= 2) {
    const rel = geoms.map((g) => g.nose - base);
    const ref = rel.reduce((best, n, i) => (Math.abs(n) < Math.abs(rel[best]) ? i : best), 0);
    // Foreshortening is measured against the median width/height of the centred-nose frames,
    // so a start that is already tilted can't hide it.
    const centred = geoms.filter((_, i) => Math.abs(rel[i]) <= FLAT_NOSE_MAX).map((g) => g.width / g.height);
    const ratio0 = centred.length ? median(centred) : geoms[ref].width / geoms[ref].height;
    let num = 0;
    let den = 0;
    let maxRes = 0;
    let maxTilt = 0;
    for (let i = 0; i < frames.length; i++) {
      const n = Math.abs(rel[i]);
      if (n <= FLAT_NOSE_MAX) maxTilt = Math.max(maxTilt, 1 - geoms[i].width / geoms[i].height / ratio0);
      if (i === ref) continue;
      const r = homographyResidual(frames[ref], frames[i]);
      if (r === null) continue;
      maxRes = Math.max(maxRes, r);
      if (n >= TURN_THRESHOLD / 2) {
        num += r * n;
        den += n * n;
      }
    }
    planarityResidual = Math.round(maxRes * 10000) / 10000;
    depthSlope = den > 0 ? Math.round((num / den) * 1000) / 1000 : null;
    tilt = Math.round(maxTilt * 1000) / 1000;
  }
  const yawed = track.filter((f) => typeof f.yaw === "number");
  const yawNoseCorr = yawed.length >= 5 ? pearson(yawed.map((f) => f.yaw as number), yawed.map((f) => f.nose)) : null;
  const durationMs = a.window ? Math.round(a.window.end - a.window.start) : null;
  const rot = gyroRotation(a.gyro) ?? deviceRotation(motion, a.window);

  const flatTilt = tilt !== null && tilt >= FLAT_TILT && reached.length === 0;
  const flatPlanar = depthSlope !== null && depthSlope < DEPTH_SLOPE_FLAT && (parallax ?? 0) >= TURN_THRESHOLD * 1.5;
  const bothWays = reached.includes("left") && reached.includes("right");
  const deep = depthSlope !== null ? depthSlope >= DEPTH_SLOPE_LIVE : (planarityResidual ?? 0) >= 0.02;
  const verdict: Active3DAnalysis["verdict"] = flatTilt || flatPlanar ? "flat" : bothWays && deep ? "live-3d" : "incomplete";
  return {
    verdict,
    orderOk,
    reached,
    parallax,
    planarityResidual,
    depthSlope,
    tilt,
    deviceRotationDeg: rot,
    yawNoseCorr: yawNoseCorr === null ? null : Math.round(yawNoseCorr * 1000) / 1000,
    durationMs,
  };
}

/** Random head-turn order; both directions are always required so depth is seen from both sides. */
export function randomPoseOrder(rand: () => number = Math.random): PoseDir[] {
  return rand() < 0.5 ? ["left", "right"] : ["right", "left"];
}

export function isValidPose(p: unknown): p is PoseDir[] {
  return Array.isArray(p) && p.length >= 1 && p.length <= 4 && p.every((d) => d === "left" || d === "right");
}
