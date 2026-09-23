import { androidModelName, IPAD_SCREENS, IPHONE_SCREENS, matchAppleScreen } from "../knowledge/devices";
import { windowsName } from "../knowledge/ua";
import type { DeviceProfile } from "../types";
import type { Ctx } from "./context";

/** "Apple" + "iPhone 15 Pro" → "Apple iPhone 15 Pro"; "Google" + "Google Pixel 8" → "Google Pixel 8". */
export function deviceName(p: Pick<DeviceProfile, "vendor" | "model" | "os">): string {
  if (!p.model) return [p.vendor, p.os].filter(Boolean).join(" ");
  return p.vendor && !p.model.startsWith(p.vendor) ? `${p.vendor} ${p.model}` : p.model;
}

export function buildProfile(c: Ctx): DeviceProfile {
  const { ua, d, claims } = c;
  const nav = d.navigator;
  const high = nav.uaData?.high;

  let os: string = ua.os;
  let osVersion = ua.osVersion;
  if (claims.macTouch) os = "iPadOS / iOS (desktop-class UA)";
  if (ua.os === "Windows") {
    const w = windowsName(high?.platformVersion);
    if (w) osVersion = w;
  }
  if (ua.os === "Android" && high?.platformVersion) osVersion = high.platformVersion;
  if ((ua.os === "iOS" || ua.os === "iPadOS") && ua.browser === "Safari" && ua.browserVersion) {
    const major = parseInt(ua.browserVersion, 10);
    // Safari 26+ freezes the OS token in the UA at 18_6; the Safari version tracks the OS.
    if (major >= 26) osVersion = `${major} (UA reports ${ua.osVersion ?? "?"})`;
  }

  let model: string | null = null;
  let modelSource: string | null = null;
  let vendor: string | null = null;
  if (claims.ios || claims.macTouch) {
    vendor = "Apple";
    const table = ua.os === "iPadOS" || claims.macTouch ? [...IPAD_SCREENS, ...IPHONE_SCREENS] : IPHONE_SCREENS;
    const m = matchAppleScreen(table, d.screen.width, d.screen.height, d.screen.dpr);
    if (m) {
      const labels = (c.bundle.camera?.devicesAfter ?? []).map((x) => x.label).join(" ");
      // A telephoto lens narrows a shared screen size down to the Pro models, its absence to the non-Pro ones.
      const refine = (keep: (x: string) => boolean) => (m.models.some(keep) ? m.models.filter(keep) : m.models);
      const models = /Triple|Telephoto/i.test(labels)
        ? refine((x) => /Pro/.test(x))
        : /Dual|Ultra Wide/i.test(labels)
          ? refine((x) => !/Pro/.test(x))
          : m.models;
      model = models.join(" / ");
      modelSource = /Triple|Telephoto|Dual|Ultra Wide/i.test(labels) ? "screen geometry + camera lenses" : "screen geometry";
    }
  } else if (claims.android || ua.os === "Linux") {
    const raw = high?.model || ua.model;
    if (raw) {
      model = androidModelName(raw);
      modelSource = high?.model ? "Client Hints (Sec-CH-UA-Model)" : "User-Agent";
      vendor = /^Pixel|Google/.test(model ?? "") ? "Google" : /Samsung/.test(model ?? "") ? "Samsung" : /Xiaomi|Redmi|POCO/.test(model ?? "") ? "Xiaomi" : null;
    }
  } else if (ua.os === "macOS") vendor = "Apple";

  const bitness = high?.bitness;
  const cpuArch = c.cpuArch === "unknown" ? "unknown" : `${c.cpuArch === "arm" ? "ARM" : "x86"}${bitness ? ` · ${bitness}-bit` : ""}`;
  const s = d.screen;
  return {
    os,
    osVersion,
    browser: ua.browser,
    browserVersion: ua.browserVersion,
    engine: c.engine !== "Unknown" ? c.engine : ua.engine,
    claimedFormFactor: claims.macTouch ? "tablet (Mac UA + touch)" : ua.claimedForm,
    model,
    modelSource,
    vendor,
    gpu: c.gpu.label === "Unavailable" ? null : c.gpu.label,
    gpuClass: c.gpu.class,
    cpuArch,
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    screen: `${s.width}×${s.height} @${Math.round(s.dpr * 100) / 100}x`,
    webview: [ua.webview, ua.inApp].filter(Boolean).join(" · ") || null,
  };
}
