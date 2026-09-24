import type { NavigatorSignals, UADataSignals } from "../types";
import { attempt, errorMessage, withTimeout } from "../util/safe";

type AnyRecord = Record<string, unknown>;

const HIGH_ENTROPY_HINTS = [
  "architecture",
  "bitness",
  "model",
  "platformVersion",
  "uaFullVersion",
  "fullVersionList",
  "formFactors",
  "wow64",
];

async function collectUAData(): Promise<UADataSignals | null> {
  const uad = (navigator as unknown as { userAgentData?: AnyRecord }).userAgentData;
  if (!uad) return null;
  const out: UADataSignals = {
    brands: attempt(() => ((uad.brands as UADataSignals["brands"]) ?? []).map((b) => ({ brand: b.brand, version: b.version })), []),
    mobile: attempt(() => Boolean(uad.mobile), false),
    platform: attempt(() => String(uad.platform ?? ""), ""),
    high: null,
  };
  try {
    const fn = uad.getHighEntropyValues as ((h: string[]) => Promise<AnyRecord>) | undefined;
    if (typeof fn === "function") {
      const h = await withTimeout(fn.call(uad, HIGH_ENTROPY_HINTS), 1500, "getHighEntropyValues");
      out.high = {
        architecture: h.architecture as string | undefined,
        bitness: h.bitness as string | undefined,
        model: h.model as string | undefined,
        platformVersion: h.platformVersion as string | undefined,
        uaFullVersion: h.uaFullVersion as string | undefined,
        fullVersionList: (h.fullVersionList as { brand: string; version: string }[] | undefined)?.map((b) => ({
          brand: b.brand,
          version: b.version,
        })),
        formFactors: Array.isArray(h.formFactors) ? (h.formFactors as string[]) : undefined,
        wow64: typeof h.wow64 === "boolean" ? h.wow64 : undefined,
      };
    }
  } catch (e) {
    out.highError = errorMessage(e);
  }
  return out;
}

/** Engine behaviour probes: what the JS runtime *is*, regardless of the UA string. */
function engineFeatures(): NavigatorSignals["engineFeatures"] {
  const w = window as unknown as AnyRecord;
  const n = navigator as unknown as AnyRecord;
  const css = (p: string, v: string) => attempt(() => CSS.supports(p, v), false);
  const details: Record<string, boolean> = {
    userAgentData: "userAgentData" in navigator,
    v8BreakIterator: attempt(() => "v8BreakIterator" in (Intl as unknown as AnyRecord), false),
    webkitTemporaryStorage: "webkitTemporaryStorage" in n,
    chromeObject: typeof w.chrome === "object" && w.chrome !== null,
    gestureEvent: "GestureEvent" in w,
    webkitTouchCallout: css("-webkit-touch-callout", "none"),
    safariObject: "safari" in w,
    applePaySession: "ApplePaySession" in w,
    webkitForceTouch: "onwebkitmouseforcewillbegin" in w || "WebKitMouseForceWillBegin" in w,
    mozInnerScreenX: "mozInnerScreenX" in w,
    mozAppearance: css("-moz-appearance", "none"),
    mozPaintCount: "mozPaintCount" in w,
  };
  const blink = details.userAgentData || details.v8BreakIterator || details.webkitTemporaryStorage;
  const gecko = details.mozInnerScreenX || details.mozAppearance;
  const webkit = !blink && !gecko && (details.gestureEvent || details.webkitTouchCallout || details.safariObject || details.applePaySession);
  return { blink, webkit, gecko, details };
}

export async function collectNavigator(): Promise<NavigatorSignals> {
  const n = navigator as unknown as AnyRecord;
  const perf = performance as unknown as { memory?: { jsHeapSizeLimit?: number } };
  const resolved = attempt(() => Intl.DateTimeFormat().resolvedOptions(), null as Intl.ResolvedDateTimeFormatOptions | null);
  return {
    userAgent: navigator.userAgent,
    appVersion: attempt(() => navigator.appVersion, ""),
    platform: attempt(() => navigator.platform, ""),
    vendor: attempt(() => navigator.vendor, ""),
    language: navigator.language,
    languages: attempt(() => [...(navigator.languages ?? [])], []),
    hardwareConcurrency: attempt(() => navigator.hardwareConcurrency ?? null, null),
    deviceMemory: attempt(() => (typeof n.deviceMemory === "number" ? (n.deviceMemory as number) : null), null),
    maxTouchPoints: attempt(() => navigator.maxTouchPoints ?? 0, 0),
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: attempt(() => (n.doNotTrack as string | null) ?? null, null),
    globalPrivacyControl: attempt(() => (typeof n.globalPrivacyControl === "boolean" ? (n.globalPrivacyControl as boolean) : null), null),
    pdfViewerEnabled: attempt(() => (typeof n.pdfViewerEnabled === "boolean" ? (n.pdfViewerEnabled as boolean) : null), null),
    webdriver: attempt(() => (typeof navigator.webdriver === "boolean" ? navigator.webdriver : null), null),
    pluginsCount: attempt(() => navigator.plugins?.length ?? 0, 0),
    pluginNames: attempt(() => Array.from(navigator.plugins ?? []).map((p) => p.name).slice(0, 12), []),
    mimeTypesCount: attempt(() => navigator.mimeTypes?.length ?? 0, 0),
    uaData: await collectUAData(),
    timezone: resolved?.timeZone ?? "",
    timezoneOffset: new Date().getTimezoneOffset(),
    locale: resolved?.locale ?? "",
    jsHeapSizeLimit: attempt(() => perf.memory?.jsHeapSizeLimit ?? null, null),
    isSecureContext: window.isSecureContext,
    standalone: attempt(() => (typeof n.standalone === "boolean" ? (n.standalone as boolean) : null), null),
    brave: "brave" in n,
    engineFeatures: engineFeatures(),
  };
}
