import type { InteractionSignals } from "../types";
import { isNum, median, std } from "../util/stats";

export type InteractionVerdict = "finger" | "point-contact" | "mouse" | "scripted" | "none";

export interface InteractionAnalysis {
  taps: number;
  pointerTypes: Record<string, number>;
  untrusted: number;
  programmaticClicks: number;
  trustedClicks: number;
  contactSizes: number[];
  maxContact: number | null;
  contactVariation: number | null;
  forces: number[];
  hoverMouseMoves: number;
  medianHoldMs: number | null;
  minHoldMs: number | null;
  verdict: InteractionVerdict;
}

/**
 * A real fingertip has a contact patch (PointerEvent width/height, Touch
 * radiusX/Y) of several CSS pixels that varies tap to tap. Mouse-driven touch
 * emulation reports a 1×1 point contact; scripted clicks are untrusted or lack
 * the pointerdown → pointerup → click chain.
 */
export function analyzeInteraction(s: InteractionSignals | null | undefined): InteractionAnalysis {
  const out: InteractionAnalysis = {
    taps: 0,
    pointerTypes: {},
    untrusted: 0,
    programmaticClicks: 0,
    trustedClicks: 0,
    contactSizes: [],
    maxContact: null,
    contactVariation: null,
    forces: [],
    hoverMouseMoves: s?.counts?.hoverMouseMoves ?? 0,
    medianHoldMs: null,
    minHoldMs: null,
    verdict: "none",
  };
  if (!s) return out;
  const downs = (s.pointers ?? []).filter((p) => p.type === "pointerdown");
  out.taps = downs.length;
  for (const p of downs) out.pointerTypes[p.pointerType || "unknown"] = (out.pointerTypes[p.pointerType || "unknown"] ?? 0) + 1;
  out.untrusted =
    (s.pointers ?? []).filter((p) => !p.isTrusted).length +
    (s.touches ?? []).filter((t) => !t.isTrusted).length +
    (s.clicks ?? []).filter((c) => !c.isTrusted).length;
  out.programmaticClicks = (s.clicks ?? []).filter((c) => !c.isTrusted || !c.precededByPointerDown).length;
  out.trustedClicks = (s.clicks ?? []).filter((c) => c.isTrusted && c.precededByPointerDown).length;

  const touchDowns = downs.filter((p) => p.pointerType === "touch");
  const sizes = touchDowns.map((p) => Math.max(p.width, p.height));
  for (const t of s.touches ?? []) {
    if (t.type === "touchstart" && isNum(t.radiusX) && isNum(t.radiusY)) sizes.push(2 * Math.max(t.radiusX, t.radiusY));
  }
  out.contactSizes = sizes;
  out.maxContact = sizes.length ? Math.max(...sizes) : null;
  out.contactVariation = sizes.length >= 2 ? std(sizes) : null;
  out.forces = Array.from(new Set((s.touches ?? []).map((t) => t.force).filter(isNum)));

  const holds = (s.clicks ?? []).map((c) => c.holdMs).filter(isNum);
  out.medianHoldMs = holds.length ? median(holds) : null;
  out.minHoldMs = holds.length ? Math.min(...holds) : null;

  if ((s.clicks ?? []).length && out.programmaticClicks === (s.clicks ?? []).length) out.verdict = "scripted";
  else if (touchDowns.length) out.verdict = (out.maxContact ?? 0) > 2.5 ? "finger" : "point-contact";
  else if ((out.pointerTypes.mouse ?? 0) > 0) out.verdict = "mouse";
  else if ((out.pointerTypes.pen ?? 0) > 0) out.verdict = "finger";
  return out;
}
