/**
 * Pixel-level forensics on camera frames (pure functions, unit tested).
 *
 * A physical CMOS sensor is a noisy photon counter: consecutive frames of a
 * still scene never match bit-for-bit, noise follows intensity (shot noise),
 * and there are no codec block boundaries because frames come straight from
 * the ISP. Generated feeds (emulator scenes, Chromium's fake device, still
 * images pushed through a virtual camera) have zero temporal noise; replayed
 * video files carry 8×8 compression blocking.
 */
import type { FrameAggregate, FrameMetric } from "../types";
import { mean, median, pearson } from "../util/stats";

export interface RawFrame {
  t: number;
  crop: Uint8ClampedArray; // native-resolution centre crop, RGBA
  cw: number;
  ch: number;
  thumb: Uint8ClampedArray; // downscaled full frame, RGBA
  tw: number;
  th: number;
}

const CLIP_LO = 3;
const CLIP_HI = 252;
const MOTION_CUTOFF = 20;
/** E|X−Y| for X,Y ~ N(0,σ²) equals σ·2/√π ≈ 1.128σ. */
const ABS_DIFF_TO_SIGMA = 1.1284;

export function luma(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return out;
}

/** Immerkær (1996) fast single-image noise estimate. */
export function immerkaerSigma(y: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      const v =
        y[i - w - 1] - 2 * y[i - w] + y[i - w + 1] -
        2 * y[i - 1] + 4 * y[i] - 2 * y[i + 1] +
        y[i + w - 1] - 2 * y[i + w] + y[i + w + 1];
      sum += Math.abs(v);
    }
  }
  return (Math.sqrt(Math.PI / 2) * sum) / (6 * (w - 2) * (h - 2));
}

/**
 * Ratio of gradient energy on the strongest 8-px phase vs the median phase.
 * ≈1.0 for sensor output; >1.3 when a block-based codec touched the frames.
 */
export function blockiness(y: Float32Array, w: number, h: number): number {
  if (w < 24 || h < 24) return 1;
  const col = new Array(8).fill(0);
  const colN = new Array(8).fill(0);
  const row = new Array(8).fill(0);
  const rowN = new Array(8).fill(0);
  for (let r = 0; r < h; r++) {
    for (let c = 1; c < w; c++) {
      const i = r * w + c;
      col[c % 8] += Math.abs(y[i] - y[i - 1]);
      colN[c % 8]++;
    }
  }
  for (let r = 1; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      row[r % 8] += Math.abs(y[i] - y[i - w]);
      rowN[r % 8]++;
    }
  }
  // +0.1 luma floor keeps flat images at ≈1 and perfectly flat blocks finite.
  const ratio = (acc: number[], n: number[]) => {
    const v = acc.map((a, i) => a / Math.max(1, n[i])).sort((a, b) => a - b);
    const max = v[v.length - 1];
    return (max + 0.1) / (median(v.slice(0, -1)) + 0.1);
  };
  return (ratio(col, colN) + ratio(row, rowN)) / 2;
}

export function entropy(y: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < y.length; i++) hist[Math.min(255, Math.max(0, Math.round(y[i])))]++;
  let e = 0;
  for (const c of hist) {
    if (!c) continue;
    const p = c / y.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/** Mean RGB of the central ellipse of the thumbnail (where a face usually is). */
export function centreRGB(thumb: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.38;
  const ry = h * 0.42;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const i = (y * w + x) * 4;
      r += thumb[i];
      g += thumb[i + 1];
      b += thumb[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

interface PairStats {
  diff: number;
  zero: number;
  sigma: number;
  identical: boolean;
  bins: { sum: number; n: number }[];
}

/** Temporal comparison of two crops on the green channel (highest SNR, integer exact). */
export function comparePair(a: Uint8ClampedArray, b: Uint8ClampedArray): PairStats | null {
  const bins = Array.from({ length: 8 }, () => ({ sum: 0, n: 0 }));
  let diffSum = 0;
  let zeros = 0;
  let used = 0;
  let quietSum = 0;
  let quietN = 0;
  let identical = true;
  for (let i = 1; i < a.length; i += 4) {
    const x = a[i];
    const y = b[i];
    if (x !== y || a[i - 1] !== b[i - 1] || a[i + 1] !== b[i + 1]) identical = false;
    if (x <= CLIP_LO || x >= CLIP_HI || y <= CLIP_LO || y >= CLIP_HI) continue;
    const d = Math.abs(x - y);
    used++;
    diffSum += d;
    if (d === 0) zeros++;
    if (d < MOTION_CUTOFF) {
      quietSum += d;
      quietN++;
      const bin = Math.min(7, ((x + y) / 2 / 32) | 0);
      bins[bin].sum += d;
      bins[bin].n++;
    }
  }
  if (used < 50) return identical ? { diff: 0, zero: 1, sigma: 0, identical, bins } : null;
  return {
    diff: diffSum / used,
    zero: zeros / used,
    sigma: quietN ? quietSum / quietN / ABS_DIFF_TO_SIGMA : 0,
    identical,
    bins,
  };
}

export function analyzeFrames(frames: RawFrame[]): { metrics: FrameMetric[]; aggregate: FrameAggregate | null } {
  const metrics: FrameMetric[] = [];
  if (!frames.length) return { metrics, aggregate: null };
  const binAcc = Array.from({ length: 8 }, () => ({ sum: 0, n: 0 }));
  let duplicates = 0;
  let pairs = 0;
  const blocks: number[] = [];
  let lastY: Float32Array | null = null;

  frames.forEach((f, idx) => {
    const y = luma(f.crop);
    lastY = y;
    let sum = 0;
    let sq = 0;
    let clipped = 0;
    for (let i = 0; i < y.length; i++) {
      sum += y[i];
      sq += y[i] * y[i];
      const gch = f.crop[i * 4 + 1];
      if (gch <= CLIP_LO || gch >= CLIP_HI) clipped++;
    }
    const m = sum / y.length;
    const [r, g, b] = centreRGB(f.thumb, f.tw, f.th);
    let pair: PairStats | null = null;
    if (idx > 0) {
      pair = comparePair(frames[idx - 1].crop, f.crop);
      pairs++;
      if (pair?.identical || (pair && pair.diff < 0.02 && pair.zero > 0.998)) duplicates++;
      if (pair) pair.bins.forEach((bn, i) => {
        binAcc[i].sum += bn.sum;
        binAcc[i].n += bn.n;
      });
    }
    if (idx % 3 === 0) blocks.push(blockiness(y, f.cw, f.ch));
    metrics.push({
      t: Math.round(f.t * 10) / 10,
      meanY: Math.round(m * 100) / 100,
      stdY: Math.round(Math.sqrt(Math.max(0, sq / y.length - m * m)) * 100) / 100,
      r: Math.round(r * 100) / 100,
      g: Math.round(g * 100) / 100,
      b: Math.round(b * 100) / 100,
      diff: pair ? Math.round(pair.diff * 1000) / 1000 : null,
      zeroDiff: pair ? Math.round(pair.zero * 1000) / 1000 : null,
      temporalSigma: pair ? Math.round(pair.sigma * 1000) / 1000 : null,
      spatialSigma: Math.round(immerkaerSigma(y, f.cw, f.ch) * 1000) / 1000,
      clipped: Math.round((clipped / y.length) * 1000) / 1000,
    });
  });

  const tSig = metrics.map((m) => m.temporalSigma).filter((v): v is number => v !== null);
  const zeros = metrics.map((m) => m.zeroDiff).filter((v): v is number => v !== null);
  const noiseByIntensity = binAcc
    .map((bn, i) => ({ intensity: i * 32 + 16, sigma: bn.n >= 200 ? bn.sum / bn.n / ABS_DIFF_TO_SIGMA : NaN }))
    .filter((x) => Number.isFinite(x.sigma))
    .map((x) => ({ intensity: x.intensity, sigma: Math.round(x.sigma * 1000) / 1000 }));
  const meanLuma = median(metrics.map((m) => m.meanY));
  const lumaStd = median(metrics.map((m) => m.stdY));
  return {
    metrics,
    aggregate: {
      frames: frames.length,
      duplicateRatio: pairs ? duplicates / pairs : 0,
      temporalNoise: tSig.length ? median(tSig) : null,
      zeroDiffRatio: zeros.length ? median(zeros) : null,
      spatialNoise: median(metrics.map((m) => m.spatialSigma)),
      blockiness: blocks.length ? median(blocks) : 1,
      entropy: lastY ? entropy(lastY) : 0,
      meanLuma,
      lumaStd,
      dark: meanLuma < 18 && lumaStd < 8,
      uniform: lumaStd < 3,
      noiseIntensityCorr:
        noiseByIntensity.length >= 3
          ? pearson(
              noiseByIntensity.map((x) => x.intensity),
              noiseByIntensity.map((x) => x.sigma),
            )
          : null,
      noiseByIntensity,
    },
  };
}

export function frameTiming(ts: number[]): { fps: number | null; mean: number | null; std: number | null; cv: number | null } {
  if (ts.length < 3) return { fps: null, mean: null, std: null, cv: null };
  const d: number[] = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  const m = mean(d);
  const s = Math.sqrt(d.reduce((acc, x) => acc + (x - m) * (x - m), 0) / Math.max(1, d.length - 1));
  return { fps: m > 0 ? Math.round((1000 / m) * 10) / 10 : null, mean: Math.round(m * 100) / 100, std: Math.round(s * 100) / 100, cv: m > 0 ? Math.round((s / m) * 1000) / 1000 : null };
}
