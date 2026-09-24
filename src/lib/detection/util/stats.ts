/** Small numeric toolkit shared by the collectors, analysers and the engine. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function mean(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

export const std = (xs: readonly number[]) => Math.sqrt(variance(xs));

export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: readonly number[]) => quantile(xs, 0.5);

export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/** Standard deviation of first differences — a motion-robust noise-floor estimate. */
export function diffStd(xs: readonly number[]): number {
  if (xs.length < 3) return 0;
  const d: number[] = [];
  for (let i = 1; i < xs.length; i++) d.push(xs[i] - xs[i - 1]);
  return std(d);
}

export function uniqueCount(xs: readonly number[], precision = 1e6): number {
  const set = new Set<number>();
  for (const x of xs) set.add(Math.round(x * precision));
  return set.size;
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function softmax<K extends string>(scores: Record<K, number>): Record<K, number> {
  const keys = Object.keys(scores) as K[];
  const max = Math.max(...keys.map((k) => scores[k]));
  let sum = 0;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    out[k] = Math.exp(scores[k] - max);
    sum += out[k];
  }
  for (const k of keys) out[k] /= sum;
  return out;
}

export function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Downsample an array to at most `max` evenly spaced entries. */
export function downsample<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  const out: T[] = [];
  const step = xs.length / max;
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  return out;
}
