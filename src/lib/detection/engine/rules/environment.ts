import { ANDROID_FONTS, APPLE_FONTS, countFamily, LINUX_DESKTOP_FONTS, MACOS_ONLY_FONTS, WINDOWS_FONTS } from "../../knowledge/fonts";
import type { Add, Ctx } from "../context";
import { list } from "../context";

export function environmentRules(c: Ctx, add: Add) {
  const { d, claims } = c;
  const env = d.environment;
  const fp = d.fingerprint;

  const conn = env.connection;
  if (conn.supported && conn.type) {
    const cellular = conn.type === "cellular";
    const ethernet = conn.type === "ethernet";
    add({
      id: "environment.network",
      title: "Network link",
      value: `${conn.type}${conn.effectiveType ? ` · ${conn.effectiveType}` : ""}${conn.rtt != null ? ` · ${conn.rtt} ms RTT` : ""}`,
      detail: cellular ? "Connected over a cellular modem." : ethernet ? "Wired Ethernet link." : "Recorded.",
      status: cellular ? "pass" : ethernet && claims.mobile ? "warn" : "info",
      evidence: cellular ? { phone: 1.0, tablet: 0.3, desktop: -1.0, spoofed: -1.0 } : ethernet && claims.mobile ? { spoofed: 1.0, emulator: 0.6, phone: -0.8 } : {},
    });
  } else if (conn.supported) {
    add({
      id: "environment.network",
      title: "Network link",
      value: conn.effectiveType ?? "unknown",
      detail: "Only the effective connection class is exposed.",
      status: "info",
    });
  }

  if (/^(UTC|Etc\/)/.test(d.navigator.timezone)) {
    add({
      id: "environment.timezone",
      title: "Timezone",
      value: d.navigator.timezone,
      detail: "UTC system time is the default of servers, containers and cloud emulators; consumer phones use a regional zone.",
      status: "warn",
      evidence: { automation: 0.8, emulator: 0.4, phone: -0.3 },
    });
  } else {
    add({ id: "environment.timezone", title: "Timezone", value: `${d.navigator.timezone} (UTC${-d.navigator.timezoneOffset / 60 >= 0 ? "+" : ""}${-d.navigator.timezoneOffset / 60})`, detail: "Regional timezone.", status: "info" });
  }

  /* ------------------------------- Fonts ----------------------------------- */
  const fonts = fp.fonts ?? [];
  const win = countFamily(fonts, WINDOWS_FONTS);
  const apple = countFamily(fonts, APPLE_FONTS);
  const mac = countFamily(fonts, MACOS_ONLY_FONTS);
  const droid = countFamily(fonts, ANDROID_FONTS);
  const linux = countFamily(fonts, LINUX_DESKTOP_FONTS);
  const fontTxt = `${fonts.length} detected · Windows ${win} · Apple ${apple} · Android ${droid} · Linux ${linux}`;
  if (claims.mobile && win >= 3) {
    add({
      id: "environment.fonts",
      title: "Installed system fonts",
      value: fontTxt,
      detail: `Windows-only fonts are installed (${list(fonts.filter((f) => WINDOWS_FONTS.includes(f)))}). Fonts come from the host OS, which emulation cannot swap.`,
      status: "fail",
      evidence: { spoofed: 2.2, emulator: 0.2, phone: -2.0, tablet: -2.0 },
    });
  } else if (claims.android && droid >= 2) {
    add({
      id: "environment.fonts",
      title: "Installed system fonts",
      value: fontTxt,
      detail: `Android system fonts present (${list(fonts.filter((f) => ANDROID_FONTS.includes(f)))}).`,
      status: "pass",
      evidence: { phone: 0.8, tablet: 0.8, emulator: 0.6, spoofed: -1.5, desktop: -1.0 },
    });
  } else if (claims.mobile && !claims.ios && linux >= 2 && droid < 2) {
    add({
      id: "environment.fonts",
      title: "Installed system fonts",
      value: fontTxt,
      detail: "Desktop-Linux font stack (DejaVu/Liberation) instead of Android's Roboto/Noto set.",
      status: "fail",
      evidence: { spoofed: 1.2, automation: 0.8, phone: -1.2, tablet: -1.0 },
    });
  } else if (claims.ios && fonts.length >= 3) {
    if (apple < 1) {
      add({
        id: "environment.fonts",
        title: "Installed system fonts",
        value: fontTxt,
        detail: "No Apple system fonts although the UA claims iOS.",
        status: "fail",
        evidence: { spoofed: 2.0, phone: -2.0, tablet: -2.0 },
      });
    } else if (mac >= 2) {
      add({
        id: "environment.fonts",
        title: "Installed system fonts",
        value: fontTxt,
        detail: `macOS-only fonts are present (${list(fonts.filter((f) => MACOS_ONLY_FONTS.includes(f)))}): a Mac in responsive/emulation mode.`,
        status: "warn",
        evidence: { spoofed: 1.5, phone: -1.2, tablet: -1.0 },
      });
    } else {
      add({ id: "environment.fonts", title: "Installed system fonts", value: fontTxt, detail: "Apple system font set.", status: "pass", evidence: { phone: 0.4, tablet: 0.4, spoofed: -0.4 } });
    }
  } else {
    add({ id: "environment.fonts", title: "Installed system fonts", value: fontTxt, detail: "Recorded.", status: "info" });
  }

  /* ------------------------------- Voices ---------------------------------- */
  const v = fp.voices;
  if (v) {
    const sapi = v.localMicrosoft >= 1;
    add({
      id: "environment.voices",
      title: "Speech-synthesis voices",
      value: `${v.count} voices${v.defaultVoice ? ` · default “${v.defaultVoice}”` : ""}`,
      detail: sapi && claims.mobile ? "Local Microsoft (Windows SAPI) voices are installed — the host OS is Windows." : "Voices come from the host OS text-to-speech engine.",
      status: sapi && claims.mobile ? "fail" : "info",
      evidence: sapi && claims.mobile ? { spoofed: 2.2, phone: -2.0, tablet: -2.0 } : sapi ? { desktop: 0.4 } : {},
    });
  }

  /* ---------------------------- Media devices ------------------------------ */
  const md = env.mediaDevicesPre;
  if (md) {
    const none = md.videoinput === 0;
    add({
      id: "environment.media",
      title: "Media hardware (before permission)",
      value: `${md.videoinput} camera · ${md.audioinput} mic · ${md.audiooutput} output`,
      detail: none && claims.mobile ? "No camera at all — every phone has at least one. Typical of the iOS Simulator and camera-less VMs." : "Device counts before any permission prompt.",
      status: none && claims.mobile ? "warn" : "info",
      evidence: none && claims.mobile ? { emulator: 1.5, spoofed: 0.8, phone: -1.5, tablet: -1.0 } : {},
    });
  }

  if (env.storageQuota) {
    add({
      id: "environment.storage",
      title: "Storage quota",
      value: `${(env.storageQuota / 1024 ** 3).toFixed(1)} GB`,
      detail: "Derived from free disk space (incognito windows report a small fixed quota).",
      status: "info",
    });
  }
  if (fp.visitorId) {
    add({
      id: "environment.fingerprint",
      title: "Device fingerprint",
      value: fp.visitorId.slice(0, 20),
      detail: "Hash of canvas, WebGL, audio, fonts, GPU, screen, cores, timezone, languages and CPU architecture.",
      status: "info",
    });
  }
}
