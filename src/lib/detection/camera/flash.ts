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

export function analyzeFlash(metrics: FrameMetric[], sequence: FlashColor[], schedule: FlashSegment[], dark = false): FlashResponse {
  const base: FlashResponse = { sequence, schedule, correlation: null, lagMs: null, amplitude: null, perChannel: {}, verdict: "inconclusive" };
  if (!schedule.length || metrics.length < 8 || dark) return base;
  const colors = Array.from(new Set(schedule.map((s) => s.color))).filter((c): c is Exclude<FlashColor, "white"> => c !== "white");
  let best = { corr: -Infinity, lag: 0, amp: 0, per: {} as Record<string, number> };
  for (let lag = 0; lag <= 320; lag += 16) {
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
    if (corr > best.corr) best = { corr, lag, amp: mean(amps), per };
  }
  if (!Number.isFinite(best.corr)) return base;
  const correlation = Math.round(best.corr * 1000) / 1000;
  const amplitude = Math.round(best.amp * 10000) / 10000;
  const verdict: FlashResponse["verdict"] =
    correlation >= 0.55 && amplitude >= 0.003 ? "responsive" : correlation >= 0.3 && amplitude >= 0.0015 ? "weak" : "none";
  return { ...base, correlation, lagMs: best.lag, amplitude, perChannel: best.per, verdict };
}
