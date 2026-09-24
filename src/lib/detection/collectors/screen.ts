import type { ScreenSignals, TouchSignals } from "../types";
import { attempt } from "../util/safe";
import { median } from "../util/stats";

const MEDIA_QUERIES: Record<string, string> = {
  pointerCoarse: "(pointer: coarse)",
  pointerFine: "(pointer: fine)",
  pointerNone: "(pointer: none)",
  anyPointerCoarse: "(any-pointer: coarse)",
  anyPointerFine: "(any-pointer: fine)",
  hoverNone: "(hover: none)",
  hoverHover: "(hover: hover)",
  anyHoverHover: "(any-hover: hover)",
  portrait: "(orientation: portrait)",
  colorGamutP3: "(color-gamut: p3)",
  colorGamutRec2020: "(color-gamut: rec2020)",
  dynamicRangeHigh: "(dynamic-range: high)",
  prefersDark: "(prefers-color-scheme: dark)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  reducedTransparency: "(prefers-reduced-transparency: reduce)",
  forcedColors: "(forced-colors: active)",
  invertedColors: "(inverted-colors: inverted)",
  displayStandalone: "(display-mode: standalone)",
  displayBrowser: "(display-mode: browser)",
  updateFast: "(update: fast)",
  scriptingEnabled: "(scripting: enabled)",
};

/** Physical safe-area insets (notch / Dynamic Island / home indicator) via env(). */
function measureSafeArea(): ScreenSignals["safeArea"] {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);" +
    "padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);";
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const px = (v: string) => Math.round(parseFloat(v) || 0);
  const out = {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
  el.remove();
  return out;
}

/** Estimate display refresh rate from requestAnimationFrame cadence. */
export function measureRefreshRate(durationMs = 500): Promise<number | null> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const start = performance.now();
    const tick = (t: number) => {
      stamps.push(t);
      if (t - start < durationMs) requestAnimationFrame(tick);
      else {
        const d: number[] = [];
        for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
        const m = median(d);
        resolve(Number.isFinite(m) && m > 0 ? Math.round(1000 / m) : null);
      }
    };
    requestAnimationFrame(tick);
    setTimeout(() => resolve(null), durationMs + 1000);
  });
}

export async function collectScreen(): Promise<ScreenSignals> {
  const w = window as unknown as Record<string, unknown>;
  const media: Record<string, boolean> = {};
  for (const [k, q] of Object.entries(MEDIA_QUERIES)) media[k] = attempt(() => matchMedia(q).matches, false);
  const vv = window.visualViewport;
  return {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
    orientationType: attempt(() => screen.orientation?.type ?? null, null),
    orientationAngle: attempt(() => screen.orientation?.angle ?? null, null),
    windowOrientation: typeof w.orientation === "number" ? (w.orientation as number) : null,
    hasWindowOrientation: "orientation" in window,
    visualViewport: vv ? { width: vv.width, height: vv.height, scale: vv.scale } : null,
    safeArea: attempt(measureSafeArea, { top: 0, right: 0, bottom: 0, left: 0 }),
    media,
    refreshRate: await measureRefreshRate(),
    isExtended: attempt(() => (typeof (screen as unknown as { isExtended?: boolean }).isExtended === "boolean" ? (screen as unknown as { isExtended: boolean }).isExtended : null), null),
  };
}

export function collectTouch(): TouchSignals {
  return {
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    ontouchstart: "ontouchstart" in window,
    touchEvent: typeof (window as unknown as Record<string, unknown>).TouchEvent === "function",
    createTouchEvent: attempt(() => {
      document.createEvent("TouchEvent");
      return true;
    }, false),
    pointerEvent: typeof window.PointerEvent === "function",
  };
}
