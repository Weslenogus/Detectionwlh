import { ANDROID_ONLY_APIS, DESKTOP_ONLY_BLINK_APIS, IOS_ONLY_APIS } from "../../collectors/platform";
import type { Add, Ctx } from "../context";
import { list } from "../context";

export function platformRules(c: Ctx, add: Add) {
  const { d, claims, engine } = c;
  const p = d.platformApis ?? {};
  const present = (keys: readonly string[]) => keys.filter((k) => p[k]);
  const android = present(ANDROID_ONLY_APIS);
  const desktop = present(DESKTOP_ONLY_BLINK_APIS);
  const ios = present(IOS_ONLY_APIS);

  if (engine === "Blink" && claims.mobile && !claims.ios) {
    if (desktop.length >= 2) {
      add({
        id: "platform.desktop-apis",
        title: "Desktop-only Chromium APIs",
        value: list(desktop),
        detail: "These interfaces are compiled only into desktop Chrome. Device emulation cannot remove them — this “phone” is desktop Chrome.",
        status: "fail",
        evidence: { spoofed: 4.0, desktop: 0.5, automation: 0.8, phone: -4.0, tablet: -3.5, emulator: -1.0 },
      });
    } else if (desktop.length === 1) {
      add({
        id: "platform.desktop-apis",
        title: "Desktop-only Chromium APIs",
        value: desktop[0],
        detail: "One desktop-only interface is exposed.",
        status: "warn",
        evidence: { spoofed: 1.2, phone: -1.0 },
      });
    } else {
      add({ id: "platform.desktop-apis", title: "Desktop-only Chromium APIs", value: "none", detail: "No desktop-only interfaces — as expected on Android.", status: "pass", evidence: { spoofed: -0.5 } });
    }
    if (android.length >= 2) {
      add({
        id: "platform.android-apis",
        title: "Android-only APIs",
        value: list(android),
        detail: "Web NFC / Contact Picker / window.orientation only exist in Android builds of Chromium.",
        status: "pass",
        evidence: { phone: 1.8, tablet: 1.8, emulator: 1.0, spoofed: -3.0, desktop: -2.5, automation: -1.5 },
      });
    } else if (android.length === 1) {
      add({
        id: "platform.android-apis",
        title: "Android-only APIs",
        value: android[0],
        detail: "Partial Android API surface (Samsung Internet, WebViews and forks ship fewer).",
        status: "pass",
        evidence: { phone: 0.8, tablet: 0.8, emulator: 0.4, spoofed: -1.2, desktop: -1.0 },
      });
    } else {
      add({
        id: "platform.android-apis",
        title: "Android-only APIs",
        value: "none",
        detail: "None of NDEFReader, ContactsManager or window.orientation exist: this Chromium was not built for Android.",
        status: "fail",
        evidence: { spoofed: 1.8, phone: -1.5, tablet: -1.2 },
      });
    }
  } else if (claims.ios || (claims.macTouch && engine === "WebKit")) {
    if (ios.length >= 3) {
      add({
        id: "platform.ios-apis",
        title: "iOS WebKit markers",
        value: list(ios),
        detail: "Motion permission prompt, -webkit-touch-callout and touch events exist only in iOS/iPadOS WebKit.",
        status: "pass",
        evidence: { phone: 1.5, tablet: 1.5, emulator: 0.8, spoofed: -3.0, desktop: -2.0 },
      });
    } else if (ios.length <= 1) {
      add({
        id: "platform.ios-apis",
        title: "iOS WebKit markers",
        value: ios.length ? ios[0] : "none",
        detail: "The iOS-only WebKit surface is missing — macOS Safari's responsive mode or a Chromium emulation.",
        status: "fail",
        evidence: { spoofed: 3.0, desktop: 0.5, phone: -2.5, tablet: -2.5 },
      });
    } else {
      add({ id: "platform.ios-apis", title: "iOS WebKit markers", value: list(ios), detail: "Partial iOS surface.", status: "warn", evidence: { spoofed: 0.5 } });
    }
    if (desktop.length) {
      add({
        id: "platform.desktop-apis",
        title: "Desktop-only APIs",
        value: list(desktop),
        detail: "Desktop Chromium APIs cannot exist on iOS.",
        status: "fail",
        evidence: { spoofed: 3.0, phone: -2.5, tablet: -2.5 },
      });
    }
  } else if (engine === "Gecko" && claims.mobile) {
    const ok = Boolean(p.windowOrientation);
    add({
      id: "platform.gecko",
      title: "Firefox for Android markers",
      value: ok ? "window.orientation" : "missing",
      detail: ok ? "Mobile-only orientation API present." : "Desktop Firefox build behind a mobile UA (responsive design mode).",
      status: ok ? "pass" : "fail",
      evidence: ok ? { phone: 0.8, tablet: 0.8, spoofed: -1.2 } : { spoofed: 1.5, phone: -1.2 },
    });
  } else if (claims.desktop) {
    const mobileHw = android.length >= 2 || (p.webkitTouchCallout && p.motionRequestPermission);
    if (mobileHw) {
      add({
        id: "platform.desktop-mode",
        title: "Mobile browser build behind a desktop UA",
        value: list([...android, ...ios]),
        detail: "Mobile-only APIs exist although the UA says desktop: a phone or tablet using “Request desktop site”.",
        status: "pass",
        evidence: { phone: 2.0, tablet: 1.6, desktop: -2.5, automation: -0.8, spoofed: -0.5 },
      });
    } else if (engine === "Blink" && desktop.length >= 2) {
      add({
        id: "platform.desktop-apis",
        title: "Desktop-only Chromium APIs",
        value: list(desktop),
        detail: "Desktop Chromium build, consistent with the UA.",
        status: "info",
        evidence: { desktop: 0.8, phone: -1.0, tablet: -0.8 },
      });
    } else {
      add({ id: "platform.apis", title: "Platform API surface", value: `${Object.values(p).filter(Boolean).length} APIs`, detail: "No platform-exclusive contradictions.", status: "info" });
    }
  } else {
    add({ id: "platform.apis", title: "Platform API surface", value: `${Object.values(p).filter(Boolean).length} APIs`, detail: "Recorded.", status: "info" });
  }
}
