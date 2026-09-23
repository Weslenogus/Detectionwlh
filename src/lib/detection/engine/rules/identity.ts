import { matchEmulatorModel } from "../../knowledge/devices";
import type { Add, Ctx } from "../context";

const CH_PLATFORM: Record<string, string[]> = {
  Android: ["Android"],
  Windows: ["Windows"],
  macOS: ["macOS"],
  Linux: ["Linux"],
  ChromeOS: ["Chrome OS", "ChromeOS", "Chromium OS"],
  HarmonyOS: ["HarmonyOS", "OpenHarmony", "Android"],
};

export function identityRules(c: Ctx, add: Add) {
  const { ua, claims, d } = c;
  const nav = d.navigator;
  const uad = nav.uaData;

  /* ---------------------------- What is claimed ---------------------------- */
  add({
    id: "identity.claim",
    title: "Claimed platform (User-Agent)",
    value: `${ua.os}${ua.osVersion ? ` ${ua.osVersion}` : ""} · ${ua.browser}${ua.browserVersion ? ` ${ua.browserVersion.split(".")[0]}` : ""} · ${claims.macTouch ? "Mac UA + touch" : ua.claimedForm}`,
    detail: claims.mobile
      ? "The browser claims to be a mobile device. Every other category below verifies whether the hardware agrees."
      : claims.macTouch
        ? "Desktop Safari UA on a touch screen: this is how iPadOS (and iPhones in desktop-site mode) identify themselves."
        : "The browser claims to be a desktop/laptop. Hardware evidence can still reveal a phone in desktop-site mode.",
    status: "info",
    evidence: claims.mobile
      ? { phone: 0.8, tablet: 0.5, spoofed: 0.8, emulator: 0.8, desktop: -1.5 }
      : claims.macTouch
        ? { tablet: 1.0, phone: 0.3, desktop: -0.5 }
        : { desktop: 1.2, automation: 0.3, phone: -0.8, tablet: -0.4, spoofed: -1.0, emulator: -1.0 },
  });

  /* ------------------------- UA-CH ↔ UA consistency ------------------------ */
  if (uad) {
    const expected = CH_PLATFORM[ua.os];
    const plat = uad.platform;
    if (plat && expected && !expected.includes(plat)) {
      const desktopMode = claims.desktop && plat === "Android";
      add({
        id: "identity.ch-platform",
        title: "Client Hints platform vs User-Agent",
        value: `UA-CH "${plat}" vs UA "${ua.os}"`,
        detail: desktopMode
          ? "Desktop UA string but Client Hints still say Android: the signature of Chrome's “Desktop site” mode on a phone."
          : "The high-level Client Hints disagree with the UA string. UA-switcher extensions typically rewrite one and forget the other.",
        status: desktopMode ? "pass" : "fail",
        evidence: desktopMode ? { phone: 1.0, tablet: 0.8, desktop: -1.0 } : { spoofed: 2.5, phone: -2.0, tablet: -1.5 },
      });
    } else if (plat && expected) {
      add({
        id: "identity.ch-platform",
        title: "Client Hints platform vs User-Agent",
        value: plat,
        detail: "Client Hints platform agrees with the UA string.",
        status: "pass",
        evidence: {},
      });
    }
    if (claims.android && typeof uad.mobile === "boolean" && uad.mobile !== ua.mobileToken) {
      add({
        id: "identity.ch-mobile",
        title: "Client Hints mobile flag",
        value: `mobile=${uad.mobile}, UA "Mobile" token=${ua.mobileToken}`,
        detail: "Sec-CH-UA-Mobile contradicts the UA's form factor.",
        status: "fail",
        evidence: { spoofed: 1.5, phone: -1.0 },
      });
    }
    // Every Blink UA carries a Chrome/NNN token and every Blink brand list a "Chromium" entry.
    const chromiumBrand = uad.brands.find((b) => b.brand === "Chromium");
    const uaMajor = nav.userAgent.match(/Chrome\/(\d+)/)?.[1];
    if (chromiumBrand && uaMajor && chromiumBrand.version !== uaMajor) {
      add({
        id: "identity.ch-version",
        title: "Brand version vs UA version",
        value: `Chromium ${chromiumBrand.version} vs UA Chrome/${uaMajor}`,
        detail: "userAgentData.brands reports a different major version than the UA string — a rewritten UA.",
        status: "fail",
        evidence: { spoofed: 1.5, phone: -0.8, desktop: -0.3 },
      });
    }
    const high = uad.high;
    const model = high?.model ?? "";
    const emu = matchEmulatorModel(model) ?? matchEmulatorModel(ua.model);
    if (emu) {
      add({
        id: "identity.emulator-model",
        title: "Emulator device model",
        value: model || ua.model || "",
        detail: `The device model string belongs to ${emu}.`,
        status: "fail",
        evidence: { emulator: 5.0, phone: -3.0, tablet: -3.0, spoofed: -0.5 },
      });
    } else if (model && claims.android) {
      add({
        id: "identity.model",
        title: "Hardware model (UA-CH)",
        value: model,
        detail: "A concrete OEM model identifier was reported via high-entropy Client Hints.",
        status: "pass",
        evidence: { phone: 0.3, tablet: 0.3 },
      });
    } else if (claims.android && high && !model) {
      add({
        id: "identity.model",
        title: "Hardware model (UA-CH)",
        value: "empty",
        detail: "Android Chrome normally reports its model through Sec-CH-UA-Model; it is empty here.",
        status: "warn",
        evidence: { spoofed: 0.8, phone: -0.5 },
      });
    }
    if (model && ua.model && !ua.reducedModel && model !== ua.model && !emu) {
      add({
        id: "identity.model-mismatch",
        title: "Model: UA vs Client Hints",
        value: `${ua.model} vs ${model}`,
        detail: "The UA string and Client Hints name different hardware models.",
        status: "fail",
        evidence: { spoofed: 1.2, phone: -0.8 },
      });
    }
    const ff = high?.formFactors;
    if (ff?.length) {
      const isMobileFF = ff.includes("Mobile");
      const isTabletFF = ff.includes("Tablet");
      const isDesktopFF = ff.includes("Desktop");
      add({
        id: "identity.form-factors",
        title: "Declared form factors",
        value: ff.join(", "),
        detail: isDesktopFF && claims.mobile ? "The browser build declares itself a desktop browser while the UA claims mobile." : "Sec-CH-UA-Form-Factors reported by the browser build.",
        status: isDesktopFF && claims.mobile ? "fail" : "info",
        evidence: isDesktopFF && claims.mobile ? { spoofed: 1.2, phone: -1.0, tablet: -0.8 } : isMobileFF ? { phone: 0.4, spoofed: 0.1 } : isTabletFF ? { tablet: 0.4 } : {},
      });
    }
    const arch = high?.architecture;
    if (arch && claims.android) {
      const x86 = /x86/i.test(arch);
      add({
        id: "identity.ch-arch",
        title: "Architecture (UA-CH)",
        value: `${arch}${high?.bitness ? ` / ${high.bitness}-bit` : ""}`,
        detail: x86 ? "Android on x86 is almost exclusively an emulator or an Android VM." : "ARM architecture, as expected for Android hardware.",
        status: x86 ? "fail" : "pass",
        evidence: x86 ? { emulator: 2.0, spoofed: 1.5, phone: -2.0, tablet: -1.5 } : { phone: 0.3, tablet: 0.3 },
      });
    }
  }

  /* ------------------------ navigator.platform check ----------------------- */
  const platform = nav.platform ?? "";
  if (claims.ios && ua.os === "iOS") {
    const ok = platform === "iPhone" || platform === "iPod";
    const desktopHost = /Win|Linux x86|Linux i\d86/i.test(platform);
    add({
      id: "identity.platform",
      title: "navigator.platform",
      value: platform || "(empty)",
      detail: ok
        ? "Matches an iPhone."
        : desktopHost
          ? "An iPhone UA running on a Windows/Linux platform string."
          : "iPhone UA but a non-iPhone platform string.",
      status: ok ? "pass" : "fail",
      evidence: ok ? { phone: 0.5 } : desktopHost ? { spoofed: 3.0, phone: -2.5, tablet: -1.5 } : { spoofed: 1.5, phone: -1.0 },
    });
  } else if (claims.android) {
    const arm = /^Linux (arm|aarch64)/i.test(platform);
    const x86 = /^Linux (x86_64|i\d86)/i.test(platform);
    const desktopHost = /^(Win|Mac)/i.test(platform);
    add({
      id: "identity.platform",
      title: "navigator.platform",
      value: platform || "(empty)",
      detail: arm
        ? "ARM Linux userland, as on real Android hardware."
        : x86
          ? "x86 Linux userland under an Android UA: emulator / Android-x86 VM signature."
          : desktopHost
            ? "Android UA over a Windows/macOS platform string: DevTools or UA spoofing."
            : "Unusual platform string for Android.",
      status: arm ? "pass" : "fail",
      evidence: arm
        ? { phone: 0.5, tablet: 0.5 }
        : x86
          ? { emulator: 2.0, spoofed: 1.0, phone: -1.5, tablet: -1.2 }
          : desktopHost
            ? { spoofed: 3.0, phone: -3.0, tablet: -2.5, emulator: -0.5 }
            : { spoofed: 0.8, phone: -0.5 },
    });
  } else if (claims.desktop && /^Linux (arm|aarch64)/i.test(platform) && !/CrOS/.test(nav.userAgent)) {
    add({
      id: "identity.platform",
      title: "navigator.platform",
      value: platform,
      detail: "Desktop UA over an ARM Linux platform string — typical of Android Chrome in desktop-site mode.",
      status: "pass",
      evidence: { phone: 1.0, tablet: 0.8, desktop: -0.8 },
    });
  } else {
    add({ id: "identity.platform", title: "navigator.platform", value: platform || "(empty)", detail: "Recorded for consistency checks.", status: "info" });
  }

  /* ---------------------------- Vendor & engine ---------------------------- */
  const vendor = nav.vendor ?? "";
  let vendorOk: boolean | null = null;
  if (ua.engine === "WebKit") vendorOk = vendor === "Apple Computer, Inc.";
  else if (ua.engine === "Blink") vendorOk = vendor === "Google Inc.";
  else if (ua.engine === "Gecko") vendorOk = vendor === "";
  if (vendorOk !== null) {
    add({
      id: "identity.vendor",
      title: "navigator.vendor",
      value: vendor || "(empty)",
      detail: vendorOk
        ? `Consistent with the claimed ${ua.engine} engine.`
        : `A ${ua.engine} browser must report ${ua.engine === "WebKit" ? '"Apple Computer, Inc."' : ua.engine === "Blink" ? '"Google Inc."' : "an empty vendor"} — Chrome DevTools' iPhone emulation famously leaves "Google Inc." here.`,
      status: vendorOk ? "pass" : "fail",
      evidence: vendorOk ? {} : { spoofed: 2.5, phone: -2.0, tablet: -2.0 },
    });
  }
  if (ua.engine !== "Unknown" && c.engine !== "Unknown") {
    const match = ua.engine === c.engine;
    add({
      id: "identity.engine",
      title: "JavaScript engine behaviour",
      value: `behaves like ${c.engine}, UA claims ${ua.engine}`,
      detail: match
        ? "Engine-specific APIs match the claimed browser engine."
        : "Engine-specific APIs (userAgentData, Intl.v8BreakIterator, GestureEvent, -moz-*) reveal a different engine than the UA claims. On iOS every browser must be WebKit.",
      status: match ? "pass" : "fail",
      evidence: match ? {} : { spoofed: 3.0, phone: -2.0, tablet: -2.0, emulator: -0.5 },
    });
  }

  /* -------------------------------- WebViews ------------------------------- */
  if (ua.webview || ua.inApp) {
    add({
      id: "identity.webview",
      title: "Embedded browser",
      value: [ua.webview, ua.inApp].filter(Boolean).join(" · "),
      detail: "Running inside an app's WebView / in-app browser. Some APIs (sensors, camera) may be restricted by the host app.",
      status: "info",
      evidence: { phone: 0.3, tablet: 0.2 },
    });
  }
}
