/**
 * Pure analysis of motion-sensor traces. Runs identically in the browser and
 * on the server so the signed verdict never trusts a client-side conclusion.
 *
 * Key ideas:
 *  - A physical MEMS accelerometer always shows gravity (~9.81 m/s²) and a
 *    non-zero noise floor at full precision. Emulators and DevTools produce
 *    constant or perfectly smooth (scripted) values.
 *  - Chromium rounds readings to 0.1 m/s² as an anti-fingerprinting measure,
 *    so a phone resting on a table can look constant: that case is reported as
 *    "resting" (ambiguous) instead of "synthetic".
 *  - The gravity vector and the orientation Euler angles are produced by
 *    different sensor pipelines; on real hardware they agree geometrically.
 */
import type { GenericSensorSignals, MotionSignals } from "../types";
import { downsample, isNum, mean, median, std, uniqueCount } from "../util/stats";

export type MotionVerdict = "physical" | "resting" | "synthetic" | "null-sensors" | "absent" | "denied" | "insufficient";

export interface MotionAnalysis {
  samples: number;
  rateHz: number | null;
  gravityMagnitude: number | null;
  gravityPlausible: boolean | null;
  noise: number | null;
  roughness: number | null;
  /** Deviation of each sample from the midpoint of its neighbours: ≈0 only for generated curves. */
  jitter: number | null;
  quantum: number | null;
  /** Every value is a multiple of 0.1 (Chromium's anti-fingerprinting rounding). */
  coarse: boolean | null;
  static: boolean | null;
  gyroNoise: number | null;
  gyroStatic: boolean | null;
  orientationSamples: number;
  orientationStatic: boolean | null;
  orientationRoundPreset: boolean | null;
  compass: boolean;
  consistencyErrorDeg: number | null;
  consistencyPairs: number;
  handheld: "handheld" | "resting" | "unknown";
  tiltVariationDeg: number | null;
  verdict: MotionVerdict;
  generic: { accelerometer: SensorTraceAnalysis; gyroscope: SensorTraceAnalysis };
  series: { t: number; magnitude: number }[];
  orientationSeries: { t: number; beta: number; gamma: number }[];
}

export interface SensorTraceAnalysis {
  state: GenericSensorSignals["state"];
  samples: number;
  static: boolean | null;
  noise: number | null;
  magnitude: number | null;
}

const DEG = 180 / Math.PI;

function diffs(xs: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]);
  return out;
}

/** Smallest step between distinct values — reveals rounding (e.g. Chromium's 0.1 m/s²). */
function quantumOf(axes: number[][]): number | null {
  let best = Infinity;
  for (const axis of axes) {
    const u = Array.from(new Set(axis.map((v) => Math.round(v * 1e5) / 1e5))).sort((a, b) => a - b);
    for (let i = 1; i < u.length; i++) best = Math.min(best, u[i] - u[i - 1]);
  }
  return Number.isFinite(best) ? best : null;
}

function traceAnalysis(g: GenericSensorSignals | undefined): SensorTraceAnalysis {
  const readings = Array.isArray(g?.readings) ? g.readings.filter(Array.isArray) : [];
  if (!g || readings.length < 5) return { state: g?.state ?? "unsupported", samples: readings.length, static: null, noise: null, magnitude: null };
  const axes = [1, 2, 3].map((i) => readings.map((r) => r[i]));
  const uniq = axes.map((a) => uniqueCount(a, 1e4));
  const noise = median(axes.map((a) => std(diffs(a))));
  const mags = readings.map((r) => Math.hypot(r[1], r[2], r[3]));
  return {
    state: g.state,
    samples: readings.length,
    static: readings.length >= 15 ? uniq.every((u) => u <= 2) : null,
    noise,
    magnitude: mean(mags),
  };
}

export function analyzeMotion(input: MotionSignals | null | undefined): MotionAnalysis {
  let m = input;
  const empty: MotionAnalysis = {
    samples: 0,
    rateHz: null,
    gravityMagnitude: null,
    gravityPlausible: null,
    noise: null,
    roughness: null,
    jitter: null,
    quantum: null,
    coarse: null,
    static: null,
    gyroNoise: null,
    gyroStatic: null,
    orientationSamples: 0,
    orientationStatic: null,
    orientationRoundPreset: null,
    compass: false,
    consistencyErrorDeg: null,
    consistencyPairs: 0,
    handheld: "unknown",
    tiltVariationDeg: null,
    verdict: "absent",
    generic: { accelerometer: traceAnalysis(undefined), gyroscope: traceAnalysis(undefined) },
    series: [],
    orientationSeries: [],
  };
  if (!m || typeof m !== "object") return empty;
  const arr = <T>(x: T[] | undefined): T[] => (Array.isArray(x) ? x.filter(Array.isArray) : []);
  m = { ...m, motion: arr(m.motion), orientation: arr(m.orientation) };
  const out: MotionAnalysis = {
    ...empty,
    generic: { accelerometer: traceAnalysis(m.accelerometer), gyroscope: traceAnalysis(m.gyroscope) },
  };

  /* --------------------------- Orientation stream --------------------------- */
  const ori = (m.orientation ?? []).filter((o) => isNum(o[2]) && isNum(o[3]));
  out.orientationSamples = ori.length;
  out.compass = (m.orientation ?? []).some((o) => isNum(o[4]));
  if (ori.length >= 10) {
    const a = ori.map((o) => o[1] ?? 0);
    const b = ori.map((o) => o[2] as number);
    const c = ori.map((o) => o[3] as number);
    out.orientationStatic = [a, b, c].every((x) => uniqueCount(x, 1e3) <= 2);
    out.orientationRoundPreset = out.orientationStatic && [a, b, c].every((x) => x.every((v) => Math.abs(v - Math.round(v)) < 1e-6));
    out.orientationSeries = downsample(ori, 120).map((o) => ({ t: o[0], beta: o[2] as number, gamma: o[3] as number }));
  }

  /* ----------------------------- Motion stream ----------------------------- */
  const withG = (m.motion ?? []).filter((s) => isNum(s[4]) && isNum(s[5]) && isNum(s[6]));
  const linOnly = (m.motion ?? []).filter((s) => isNum(s[1]) && isNum(s[2]) && isNum(s[3]));
  const src = withG.length >= linOnly.length ? withG : linOnly;
  const off = withG.length >= linOnly.length ? 4 : 1;
  out.samples = src.length;

  if (m.permission === "denied" && src.length === 0 && ori.length === 0) {
    out.verdict = "denied";
    return out;
  }
  if (src.length === 0 && ori.length === 0 && out.generic.accelerometer.samples === 0) {
    // Chromium also sends all-null events when the user blocked motion sensors for the site.
    const blocked = m.accelerometer?.state === "denied" || m.gyroscope?.state === "denied";
    out.verdict = blocked ? "denied" : (m.motionNullEvents ?? 0) + (m.orientationNullEvents ?? 0) > 0 ? "null-sensors" : "absent";
    return out;
  }

  if (src.length >= 3) {
    const intervals = diffs(src.map((s) => s[0])).filter((d) => d > 0);
    const mi = median(intervals);
    out.rateHz = Number.isFinite(mi) && mi > 0 ? Math.round(1000 / mi) : null;
  }

  if (src.length >= 15) {
    const axes = [0, 1, 2].map((i) => src.map((s) => s[off + i] as number));
    const uniq = axes.map((a) => uniqueCount(a, 1e4));
    out.static = uniq.every((u) => u <= 2);
    out.quantum = quantumOf(axes);
    out.coarse = axes.every((a) => a.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-4));
    const d1 = axes.map((a) => diffs(a));
    const d2 = d1.map((d) => diffs(d));
    out.noise = median(d1.map((d) => std(d)));
    const r = d1.map((d, i) => {
      const s1 = std(d);
      return s1 > 0 ? std(d2[i]) / s1 : null;
    });
    const rs = r.filter((x): x is number => x !== null);
    out.roughness = rs.length ? median(rs) : null;
    out.jitter = median(axes.map((a) => std(a.slice(1, -1).map((v, i) => v - (a[i] + a[i + 2]) / 2))));

    if (off === 4) {
      const mags = src.map((s) => Math.hypot(s[4] as number, s[5] as number, s[6] as number));
      out.gravityMagnitude = mean(mags);
      out.gravityPlausible = out.gravityMagnitude > 8.8 && out.gravityMagnitude < 10.8;
      out.series = downsample(src, 120).map((s) => ({ t: s[0], magnitude: Math.hypot(s[4] as number, s[5] as number, s[6] as number) }));
      // Tilt of the device z-axis from vertical, per sample: variation => hand-held.
      const tilts = src.map((s) => Math.acos(Math.min(1, Math.abs(s[6] as number) / Math.hypot(s[4] as number, s[5] as number, s[6] as number))) * DEG);
      out.tiltVariationDeg = std(tilts);
    }

    const gyro = (m.motion ?? []).filter((s) => isNum(s[7]) && isNum(s[8]) && isNum(s[9]));
    if (gyro.length >= 15) {
      const gAxes = [7, 8, 9].map((i) => gyro.map((s) => s[i] as number));
      out.gyroStatic = gAxes.every((a) => uniqueCount(a, 1e4) <= 2);
      out.gyroNoise = median(gAxes.map((a) => std(diffs(a))));
    }
  }

  /* -------------------- Gravity ↔ Euler-angle consistency ------------------- */
  if (withG.length >= 10 && ori.length >= 10) {
    const errs: number[] = [];
    let j = 0;
    for (const s of withG) {
      while (j < ori.length - 1 && Math.abs(ori[j + 1][0] - s[0]) <= Math.abs(ori[j][0] - s[0])) j++;
      const o = ori[j];
      if (Math.abs(o[0] - s[0]) > 60) continue;
      const g = Math.hypot(s[4] as number, s[5] as number, s[6] as number);
      if (g < 1) continue;
      const beta = (o[2] as number) / DEG;
      const gamma = (o[3] as number) / DEG;
      // |device-axis · world-vertical| predicted from Z-X'-Y'' Euler angles (sign/convention free).
      const pred = [Math.abs(Math.cos(beta) * Math.sin(gamma)), Math.abs(Math.sin(beta)), Math.abs(Math.cos(beta) * Math.cos(gamma))];
      const obs = [Math.abs(s[4] as number) / g, Math.abs(s[5] as number) / g, Math.abs(s[6] as number) / g];
      const dot = Math.min(1, pred[0] * obs[0] + pred[1] * obs[1] + pred[2] * obs[2]);
      errs.push(Math.acos(dot) * DEG);
    }
    out.consistencyPairs = errs.length;
    out.consistencyErrorDeg = errs.length >= 5 ? median(errs) : null;
  }

  /* -------------------------------- Verdict -------------------------------- */
  if (out.tiltVariationDeg !== null) out.handheld = out.tiltVariationDeg > 0.35 ? "handheld" : "resting";

  const n = Math.max(src.length, ori.length);
  if (n < 15) out.verdict = "insufficient";
  else if (src.length >= 15 && out.static) {
    // Full-precision values that never change cannot come from a MEMS sensor.
    out.verdict = out.coarse ? "resting" : "synthetic";
    if (out.orientationRoundPreset) out.verdict = "synthetic";
  } else if (src.length >= 15) {
    // Full-precision data with no sample-to-sample jitter is a generated curve; real MEMS noise
    // is orders of magnitude larger than 0.002 m/s² even while walking.
    const smoothScripted = !out.coarse && out.jitter !== null && out.jitter < 0.002;
    if (smoothScripted) out.verdict = "synthetic";
    else if (out.gravityPlausible === false) out.verdict = "synthetic";
    else out.verdict = "physical";
  } else if (ori.length >= 15) {
    // Orientation without any accelerometer data: real devices derive orientation *from*
    // the accelerometer/gyro, so this pattern is what a DevTools sensor override on a
    // sensor-less desktop looks like.
    if (out.orientationRoundPreset || (m.motionNullEvents ?? 0) > 0) out.verdict = "synthetic";
    else out.verdict = "insufficient";
  }
  return out;
}
