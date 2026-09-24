/**
 * Screen-flash reflection challenge ("active illumination" liveness).
 *
 * While the front camera records, the screen flashes a server-chosen colour
 * sequence. Light from the display reflects off the user's face and shifts the
 * chromaticity of the captured frames in lock-step. A physical camera pointed at
 * a real person follows the sequence (with ~1–4 frames of display+sensor lag);
 * a virtual camera, a replayed video or an injected stream cannot know the
 * sequence in advance and does not respond.
 */
import type { FlashColor, FlashResponse, FlashSegment, FrameMetric } from "../types";
import { mean, pearson } from "../util/stats";

export const FLASH_COLORS: Record<FlashColor, string> = {
  red: "#ff1f3d",
  green: "#19ff5a",
  blue: "#2a5bff",
  white: "#ffffff",
};

export const FLASH_PALETTE: FlashColor[] = ["red", "green", "blue"];

/**
 * Four segments: a shuffled permutation of the three primaries (so every channel
 * can be correlated) plus one more colour that differs from the third.
 */
export function randomSequence(rand: () => number = Math.random): FlashColor[] {
  const p = [...FLASH_PALETTE];
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const others = FLASH_PALETTE.filter((c) => c !== p[2]);
  p.push(others[Math.floor(rand() * others.length)]);
  return p;
}

export function isValidSequence(seq: unknown): seq is FlashColor[] {
  return Array.isArray(seq) && seq.length >= 3 && seq.length <= 8 && seq.every((c) => c === "red" || c === "green" || c === "blue" || c === "white");
}

const CHANNEL: Record<Exclude<FlashColor, "white">, (m: FrameMetric) => number> = {
  red: (m) => m.r / Math.max(1, m.r + m.g + m.b),
  green: (m) => m.g / Math.max(1, m.r + m.g + m.b),
  blue: (m) => m.b / Math.max(1, m.r + m.g + m.b),
};

function colorAt(schedule: FlashSegment[], t: number): FlashColor | null {
  for (const s of schedule) if (t >= s.start && t < s.end) return s.color;
  return null;
}

interface Fit {
  corr: number;
  lag: number;
  amp: number;
  per: Record<string, number>;
}

/** Best lag-searched mean per-channel correlation between frame chromaticity and a colour schedule. */
function bestFit(metrics: FrameMetric[], schedule: FlashSegment[], lagMin = 0, lagMax = 320): Fit | null {
  const colors = Array.from(new Set(schedule.map((s) => s.color))).filter((c): c is Exclude<FlashColor, "white"> => c !== "white");
  let best: Fit | null = null;
  for (let lag = Math.max(0, lagMin); lag <= lagMax; lag += 16) {
    const rows = metrics
      .map((m) => ({ m, c: colorAt(schedule, m.t - lag) }))
      .filter((r): r is { m: FrameMetric; c: FlashColor } => r.c !== null);
    if (rows.length < 6) continue;
    const per: Record<string, number> = {};
    const amps: number[] = [];
    for (const c of colors) {
      const chroma = rows.map((r) => CHANNEL[c](r.m));
      const expected = rows.map((r) => (r.c === c ? 1 : 0));
      if (!expected.some((v) => v === 1) || !expected.some((v) => v === 0)) continue;
      const corr = pearson(chroma, expected);
      if (corr === null) continue;
      per[c] = Math.round(corr * 1000) / 1000;
      const on = chroma.filter((_, i) => expected[i] === 1);
      const off = chroma.filter((_, i) => expected[i] === 0);
      amps.push(mean(on) - mean(off));
    }
    const vals = Object.values(per);
    if (!vals.length) continue;
    const corr = mean(vals);
    if (!best || corr > best.corr) best = { corr, lag, amp: mean(amps), per };
  }
  return best;
}

/** Colour assignments of the same timing that differ from the real one in at least half the segments. */
function alternatives(real: FlashColor[]): FlashColor[][] {
  const out: FlashColor[][] = [];
  const n = Math.min(real.length, 6);
  const total = FLASH_PALETTE.length ** n;
  for (let k = 0; k < total; k++) {
    const seq: FlashColor[] = [];
    let x = k;
    for (let i = 0; i < n; i++) {
      seq.push(FLASH_PALETTE[x % FLASH_PALETTE.length]);
      x = Math.floor(x / FLASH_PALETTE.length);
    }
    if (seq.filter((c, i) => c !== real[i]).length >= Math.ceil(n / 2)) out.push(seq);
  }
  return out;
}

/**
 * A live reflection follows *the* sequence the server chose. Colour drift in a
 * replayed or generated feed can correlate with it by chance, but then it
 * correlates just as well with other colour assignments — so the true
 * sequence must beat every alternative by a margin (a permutation test).
 */
export function analyzeFlash(metrics: FrameMetric[], sequence: FlashColor[], schedule: FlashSegment[], dark = false): FlashResponse {
  const base: FlashResponse = { sequence, schedule, correlation: null, lagMs: null, amplitude: null, perChannel: {}, specificity: null, verdict: "inconclusive" };
  if (!schedule.length || metrics.length < 8 || dark) return base;
  const fit = bestFit(metrics, schedule);
  if (!fit) return base;
  // Rivals are scored at the same display→sensor latency (a property of the device, not of the
  // colour order); otherwise a sequence shifted by one segment could borrow a longer lag.
  let rival = -1;
  for (const alt of alternatives(schedule.map((s) => s.color))) {
    const f = bestFit(metrics, schedule.map((s, i) => ({ ...s, color: alt[i] ?? s.color })), fit.lag - 48, fit.lag + 48);
    if (f && f.corr > rival) rival = f.corr;
  }
  const correlation = Math.round(fit.corr * 1000) / 1000;
  const amplitude = Math.round(fit.amp * 10000) / 10000;
  const specificity = Math.round((fit.corr - rival) * 1000) / 1000;
  const verdict: FlashResponse["verdict"] =
    correlation >= 0.55 && amplitude >= 0.003 && specificity >= 0.2
      ? "responsive"
      : correlation >= 0.3 && amplitude >= 0.0015 && specificity > 0
        ? "weak"
        : "none";
  return { ...base, correlation, lagMs: fit.lag, amplitude, perChannel: fit.per, specificity, verdict };
}
