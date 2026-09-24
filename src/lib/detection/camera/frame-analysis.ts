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

/* ------------------------- Moiré / screen recapture ------------------------ */

/** In-place iterative radix-2 complex FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * Re-filming a screen aliases its pixel grid against the camera sensor and
 * produces moiré: sharp, isolated peaks in the 2-D spectrum at mid/high
 * frequencies. Natural scenes have a smooth ~1/f spectrum. Returns the ratio of
 * the strongest mid-band peak to the median magnitude at the same radius.
 */
export function moireScore(y: Float32Array, w: number, h: number): { peakRatio: number; frequency: number } {
  const N = [256, 128, 64, 32].find((s) => s <= w && s <= h) ?? 0;
  if (N < 32) return { peakRatio: 1, frequency: 0 };
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  let m = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) m += y[r * w + c];
  m /= N * N;
  for (let r = 0; r < N; r++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * r) / (N - 1));
    for (let c = 0; c < N; c++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * c) / (N - 1));
      re[r * N + c] = (y[r * w + c] - m) * wx * wy;
    }
  }
  const rowRe = new Float64Array(N);
  const rowIm = new Float64Array(N);
  for (let r = 0; r < N; r++) {
    rowRe.set(re.subarray(r * N, r * N + N));
    rowIm.set(im.subarray(r * N, r * N + N));
    fft(rowRe, rowIm);
    re.set(rowRe, r * N);
    im.set(rowIm, r * N);
  }
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) {
      rowRe[r] = re[r * N + c];
      rowIm[r] = im[r * N + c];
    }
    fft(rowRe, rowIm);
    for (let r = 0; r < N; r++) {
      re[r * N + c] = rowRe[r];
      im[r * N + c] = rowIm[r];
    }
  }
  // Radial bins of magnitude over the mid band (0.12–0.45 cycles/pixel).
  const bins = new Map<number, number[]>();
  const cells: { bin: number; mag: number; f: number }[] = [];
  for (let v = 0; v < N; v++) {
    const fv = (v < N / 2 ? v : v - N) / N;
    for (let u = 0; u < N / 2; u++) {
      const fu = u / N;
      const f = Math.hypot(fu, fv);
      if (f < 0.12 || f > 0.45) continue;
      const mag = Math.hypot(re[v * N + u], im[v * N + u]);
      const bin = Math.round(f * 100);
      if (!bins.has(bin)) bins.set(bin, []);
      bins.get(bin)!.push(mag);
      cells.push({ bin, mag, f });
    }
  }
  const medians = new Map<number, number>();
  for (const [b, v] of bins) medians.set(b, median(v));
  let best = { peakRatio: 1, frequency: 0 };
  for (const c of cells) {
    const r = c.mag / Math.max(1e-6, medians.get(c.bin) ?? 1);
    if (r > best.peakRatio) best = { peakRatio: r, frequency: c.f };
  }
  return { peakRatio: Math.round(best.peakRatio * 100) / 100, frequency: Math.round(best.frequency * 1000) / 1000 };
}

export const MOIRE_THRESHOLD = 18;

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
  const moire: { peakRatio: number; frequency: number }[] = [];
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
    if (idx % 6 === 0 && moire.length < 4) moire.push(moireScore(y, f.cw, f.ch));
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
      moire: moire.length
        ? (() => {
            const ratio = median(moire.map((m) => m.peakRatio));
            const top = moire.reduce((a, b) => (b.peakRatio > a.peakRatio ? b : a));
            return { peakRatio: Math.round(ratio * 100) / 100, frequency: top.frequency, suspicious: ratio >= MOIRE_THRESHOLD };
          })()
        : null,
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
