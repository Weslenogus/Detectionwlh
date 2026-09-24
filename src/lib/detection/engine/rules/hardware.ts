import { IPAD_SCREENS, IPHONE_SCREENS, matchAppleScreen } from "../../knowledge/devices";
import type { Add, Ctx } from "../context";
import { fmt } from "../context";

export function hardwareRules(c: Ctx, add: Add) {
  const { d, claims } = c;
  const s = d.screen;
  const nav = d.navigator;

  /* ------------------------------ CPU (NaN) ------------------------------- */
  const cpu = d.cpu;
  if (c.cpuArch !== "unknown") {
    const x86 = c.cpuArch === "x86";
    const bits = `JS 0x${cpu.nanBitsJs || "?"} · WASM 0x${cpu.nanBitsWasm || "?"}`;
    if (x86 && claims.mobile) {
      add({
        id: "hardware.cpu",
        title: "CPU architecture (FPU default-NaN probe)",
        value: `x86 · ${bits}`,
        detail:
          "∞−∞ produced the x86 default NaN (sign bit set). Phones and tablets run ARM CPUs, which produce a positive NaN. This is a desktop/laptop CPU or an x86 emulator — no user-agent or DevTools setting can change FPU behaviour.",
        status: "fail",
        evidence: { spoofed: 2.5, emulator: 2.5, automation: 0.5, phone: -3.5, tablet: -3.0 },
      });
    } else if (x86) {
      add({
        id: "hardware.cpu",
        title: "CPU architecture (FPU default-NaN probe)",
        value: `x86 · ${bits}`,
        detail: "x86 floating-point unit (Intel/AMD): consistent with a desktop or laptop.",
        status: "info",
        evidence: { desktop: 0.6, automation: 0.2, phone: -1.5, tablet: -1.5 },
      });
    } else {
      add({
        id: "hardware.cpu",
        title: "CPU architecture (FPU default-NaN probe)",
        value: `ARM · ${bits}`,
        detail: "ARM floating-point unit: consistent with phone/tablet silicon (also Apple Silicon Macs and Snapdragon laptops).",
        status: "pass",
        evidence: { phone: 0.8, tablet: 0.8, emulator: -0.3, desktop: -0.4, spoofed: -0.5 },
      });
    }
  } else if (cpu.nanArchJs !== cpu.nanArchWasm && cpu.nanArchJs !== "unknown" && cpu.nanArchWasm !== "unknown") {
    add({
      id: "hardware.cpu",
      title: "CPU architecture (FPU default-NaN probe)",
      value: `JS ${cpu.nanArchJs} vs WASM ${cpu.nanArchWasm}`,
      detail: "JavaScript and WebAssembly disagree about the FPU — an instrumented or unusual engine.",
      status: "warn",
      evidence: { spoofed: 0.5 },
    });
  }

  /* ------------------------------- Screen --------------------------------- */
  const short = Math.min(s.width, s.height);
  const long = Math.max(s.width, s.height);
  const touch = (nav.maxTouchPoints ?? 0) > 0;
  const geom = `${s.width}×${s.height} CSS px @${fmt(s.dpr, 3)}x (${Math.round(s.width * s.dpr)}×${Math.round(s.height * s.dpr)} physical)`;
  if (short > 0 && short <= 480 && long <= 1000) {
    add({
      id: "hardware.screen",
      title: "Screen size class",
      value: geom,
      detail: "Phone-sized logical screen. Emulation presets copy these numbers too, so this alone proves little.",
      status: "pass",
      evidence: { phone: 1.0, spoofed: 0.4, emulator: 0.4, desktop: -1.5, tablet: -1.0, automation: -0.3 },
    });
  } else if (short >= 600 && short <= 1100 && touch) {
    add({
      id: "hardware.screen",
      title: "Screen size class",
      value: geom,
      detail: "Tablet-sized touch screen.",
      status: "info",
      evidence: { tablet: 1.0, phone: -0.8, desktop: -0.3 },
    });
  } else if (short >= 700 && long >= 1200 && !touch) {
    add({
      id: "hardware.screen",
      title: "Screen size class",
      value: geom,
      detail: "Desktop/laptop-sized display without touch.",
      status: "info",
      evidence: { desktop: 1.0, automation: 0.2, phone: -1.2, tablet: -0.5 },
    });
  } else {
    add({ id: "hardware.screen", title: "Screen size class", value: geom, detail: "Ambiguous size class.", status: "info" });
  }

  if (claims.mobile && s.dpr > 0 && s.dpr < 1.5) {
    add({
      id: "hardware.dpr",
      title: "Pixel density",
      value: `${fmt(s.dpr, 3)}x`,
      detail: "Modern phones render at ≥2× device-pixel ratio; ~1× is typical of desktop monitors or emulator windows.",
      status: "warn",
      evidence: { spoofed: 1.0, emulator: 0.5, phone: -0.8 },
    });
  }

  if (claims.ios || claims.macTouch) {
    const table = c.ua.os === "iPadOS" || claims.macTouch ? [...IPAD_SCREENS, ...IPHONE_SCREENS] : IPHONE_SCREENS;
    const m = matchAppleScreen(table, s.width, s.height, s.dpr);
    add({
      id: "hardware.apple-screen",
      title: "Apple display geometry",
      value: m ? m.models.join(" / ") : `no match for ${s.width}×${s.height}@${s.dpr}`,
      detail: m
        ? `Exact match with a shipping Apple panel (${m.cutout === "island" ? "Dynamic Island" : m.cutout === "notch" ? "notch" : "no cutout"}).`
        : "The geometry does not match any shipping iPhone/iPad (Display Zoom or Safari fingerprinting protection can also cause this).",
      status: m ? "pass" : "warn",
      evidence: m ? (IPAD_SCREENS.includes(m) ? { tablet: 0.6 } : { phone: 0.6, spoofed: 0.2 }) : { spoofed: 0.5, phone: -0.2 },
    });
  }

  if (claims.mobile && s.outerWidth > 0 && s.outerHeight > 0) {
    const limit = long * 1.25 + 16;
    const tooBig = s.outerWidth > limit || s.outerHeight > limit;
    add({
      id: "hardware.window",
      title: "Browser window vs screen",
      value: `outer ${s.outerWidth}×${s.outerHeight} vs screen ${s.width}×${s.height}`,
      detail: tooBig
        ? "The browser window is larger than the device's own screen — the emulated viewport lives inside a bigger desktop window (DevTools device mode / responsive design mode)."
        : "Window fits inside the screen, as on a real handset.",
      status: tooBig ? "fail" : "pass",
      evidence: tooBig ? { spoofed: 3.0, automation: 0.5, phone: -3.0, tablet: -2.5, emulator: -1.0 } : { phone: 0.2, tablet: 0.2 },
    });
  }

  const sa = s.safeArea;
  const maxInset = Math.max(sa.top, sa.bottom, sa.left, sa.right);
  if (maxInset >= 20) {
    add({
      id: "hardware.safe-area",
      title: "Display cutout / safe-area insets",
      value: `top ${sa.top} · right ${sa.right} · bottom ${sa.bottom} · left ${sa.left}`,
      detail: "The OS reports physical screen cutouts (notch, Dynamic Island, rounded corners, home indicator). Desktop emulators do not synthesise these.",
      status: "pass",
      evidence: { phone: 1.2, tablet: 0.2, spoofed: -0.6, desktop: -1.2, automation: -0.6 },
    });
  } else {
    add({
      id: "hardware.safe-area",
      title: "Display cutout / safe-area insets",
      value: "none",
      detail: "No safe-area insets (landscape, no cutout, or not a phone).",
      status: "info",
    });
  }

  if (nav.hardwareConcurrency != null) {
    const many = nav.hardwareConcurrency > 12;
    add({
      id: "hardware.cores",
      title: "Logical CPU cores",
      value: `${nav.hardwareConcurrency}${nav.deviceMemory ? ` · ${nav.deviceMemory} GB RAM (bucketed)` : ""}`,
      detail: many && claims.mobile ? "More cores than any shipping phone SoC — a workstation CPU." : "Recorded.",
      status: many && claims.mobile ? "warn" : "info",
      evidence: many && claims.mobile ? { spoofed: 1.2, emulator: 1.0, phone: -1.2, tablet: -1.0 } : {},
    });
  }

  const bat = d.environment.battery;
  if (bat.supported && typeof bat.level === "number") {
    const hasBattery = bat.level < 1 || bat.charging === false;
    const acOnly = bat.level === 1 && bat.charging === true && (bat.chargingTime ?? 0) === 0;
    add({
      id: "hardware.battery",
      title: "Battery",
      value: `${Math.round(bat.level * 100)}%${bat.charging ? " · charging" : ""}`,
      detail: hasBattery ? "A real battery is draining or charging." : acOnly ? "Reports a full battery on AC with zero charge time — typical of machines without a battery (desktops, VMs, emulators)." : "Recorded.",
      status: "info",
      evidence: hasBattery ? { phone: 0.2, tablet: 0.2, emulator: -0.3, automation: -0.2 } : acOnly ? { desktop: 0.3, emulator: 0.3, automation: 0.2, phone: -0.2 } : {},
    });
  }

  if (s.refreshRate) {
    add({
      id: "hardware.refresh",
      title: "Display refresh rate",
      value: `${s.refreshRate} Hz`,
      detail: "Measured from requestAnimationFrame cadence.",
      status: "info",
    });
  }
  const gamut = s.media.colorGamutP3 ? "Display-P3" : "sRGB";
  add({
    id: "hardware.display-color",
    title: "Display colour",
    value: `${gamut}${s.media.dynamicRangeHigh ? " · HDR" : ""} · ${s.colorDepth}-bit`,
    detail: "Wide-gamut HDR panels are standard on current flagship phones.",
    status: "info",
  });
}
