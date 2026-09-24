/**
 * Second-generation rules: UA-reduction / GREASE consistency, host-OS text
 * stack, hardware media engines, BotD, network path & IP reputation, GNSS
 * location, behaviour and cross-session link analysis.
 */
import { haversineKm } from "../../util/geo";
import type { Add, Ctx } from "../context";
import { fmt, list } from "../context";

/* --------------------------------- identity -------------------------------- */

export function uaConsistencyRules(c: Ctx, add: Add) {
  const { ua, claims, d } = c;
  const nav = d.navigator;
  const chromeMajor = parseInt(nav.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "0", 10);
  const plainChrome = ua.browser === "Chrome" && !ua.webview && !ua.inApp;
  if (plainChrome && claims.android && chromeMajor >= 113) {
    const reduced = /Android 10; K\)/.test(nav.userAgent);
    add({
      id: "identity.ua-reduction",
      title: "User-Agent reduction",
      value: reduced ? "Android 10; K (reduced)" : `${ua.osVersion ?? "?"} · ${ua.model ?? "?"}`,
      detail: reduced
        ? "Matches the frozen UA every Chrome ≥ 113 on Android sends."
        : "Real Chrome ≥ 113 on Android always sends the frozen “Android 10; K”. A full OS version / model means the UA string was copied from a device list.",
      status: reduced ? "pass" : "fail",
      evidence: reduced ? {} : { spoofed: 1.5, phone: -1.2, tablet: -1.0 },
    });
  }
  const uad = nav.uaData;
  if (uad && uad.brands.length) {
    const grease = uad.brands.filter((b) => /not.?a.?brand/i.test(b.brand));
    add({
      id: "identity.grease",
      title: "Client Hints GREASE brand",
      value: grease.length ? grease.map((g) => `"${g.brand}";v=${g.version}`).join(", ") : "missing",
      detail: grease.length === 1
        ? "Chromium injects exactly one randomised “Not A Brand” entry."
        : "Chromium always adds exactly one GREASE brand; a hand-written brand list omits or duplicates it.",
      status: grease.length === 1 ? "pass" : "fail",
      evidence: grease.length === 1 ? {} : { spoofed: 1.0, automation: 0.3 },
    });
  }
}

/* -------------------------------- environment ------------------------------- */

export function hostOsRules(c: Ctx, add: Add) {
  const { d, claims } = c;
  const h = d.hostOs;
  if (h) {
    const font = h.systemUiFont;
    const windows = font === "Segoe UI" || font === "Tahoma";
    const linux = font === "Ubuntu" || font === "Cantarell" || font === "DejaVu Sans" || font === "Liberation Sans";
    const apple = font === "Apple system font (SF)";
    const roboto = font === "Roboto" || font === "Google Sans";
    let status: "pass" | "fail" | "info" = "info";
    let evidence = {};
    let detail = "The font the platform uses for its own UI text.";
    if (claims.mobile && windows) {
      status = "fail";
      evidence = { spoofed: 2.5, phone: -2.2, tablet: -2.0 };
      detail = "system-ui is rendered with Segoe UI — the text stack of Windows, not of a phone.";
    } else if (claims.mobile && linux) {
      status = "fail";
      evidence = { spoofed: 1.5, automation: 0.6, phone: -1.5, tablet: -1.2 };
      detail = "system-ui resolves to a desktop-Linux font (servers, headless browsers, Linux emulator hosts).";
    } else if (claims.android && apple) {
      status = "fail";
      evidence = { spoofed: 1.5, phone: -1.2 };
      detail = "Apple's system font behind an Android user agent: a Mac is rendering the page.";
    } else if (claims.ios && roboto) {
      status = "fail";
      evidence = { spoofed: 1.5, phone: -1.2 };
      detail = "Android's Roboto behind an iOS user agent.";
    } else if ((claims.ios && apple) || (claims.android && roboto)) {
      status = "pass";
      evidence = { phone: 0.4, tablet: 0.4, spoofed: -0.4 };
      detail = "The system UI font matches the claimed platform.";
    }
    add({ id: "environment.system-ui", title: "Platform UI font (system-ui)", value: font ?? "unrecognised", detail, status, evidence });

    if (h.flagEmojiAsLetters !== null) {
      add({
        id: "environment.flag-emoji",
        title: "Flag emoji rendering",
        value: h.flagEmojiAsLetters ? "rendered as letters" : "rendered as a flag",
        detail: h.flagEmojiAsLetters
          ? "Regional-indicator flags fall back to letters — Windows and bare Linux do this; iOS and Android never do."
          : "Colour flag glyphs available, as on phones and Macs.",
        status: h.flagEmojiAsLetters && claims.mobile ? "fail" : "info",
        evidence: h.flagEmojiAsLetters && claims.mobile ? { spoofed: 1.5, automation: 0.3, phone: -1.2, tablet: -1.0 } : {},
      });
    }
    if (h.subpixelText) {
      add({
        id: "environment.subpixel",
        title: "Sub-pixel text antialiasing",
        value: "coloured fringes (LCD/ClearType)",
        detail: claims.mobile ? "LCD sub-pixel text rendering exists only on desktop platforms." : "Desktop LCD text rendering.",
        status: claims.mobile ? "fail" : "info",
        evidence: claims.mobile ? { spoofed: 1.2, phone: -1.0, tablet: -0.8 } : { desktop: 0.4 },
      });
    }
  }

  const tz = d.timezone;
  if (tz && tz.consistent !== null) {
    add({
      id: "environment.tz-consistency",
      title: "Timezone consistency",
      value: `${tz.zone} · Intl ${tz.intlOffset} min vs Date ${tz.dateOffset} min`,
      detail: tz.consistent
        ? "The IANA zone and the clock offset agree."
        : "The reported timezone name does not match the actual clock offset — a timezone-spoofing tool patched one API but not the other.",
      status: tz.consistent ? "pass" : "fail",
      evidence: tz.consistent ? {} : { spoofed: 1.5, automation: 0.4 },
    });
  }

  const p = d.privacy;
  if (p && p.incognito !== null) {
    add({
      id: "environment.incognito",
      title: "Private browsing",
      value: `${p.incognito ? "private / incognito" : "normal window"}${p.browser ? ` (${p.browser})` : ""}`,
      detail: p.incognito ? "The verification runs in a private window (no persistent storage) — a common risk signal, not a device signal." : "Regular browsing session.",
      status: p.incognito ? "warn" : "info",
    });
  }
  if (d.fpjs?.visitorId) {
    add({
      id: "environment.fpjs",
      title: "FingerprintJS visitor ID",
      value: `${d.fpjs.visitorId}${d.fpjs.confidence !== null ? ` · confidence ${fmt(d.fpjs.confidence, 2)}` : ""}`,
      detail: "Open-source FingerprintJS v3 browser identifier, used for velocity and identity-link analysis.",
      status: "info",
    });
  }
}

/* --------------------------------- hardware -------------------------------- */

export function mediaHardwareRules(c: Ctx, add: Add) {
  const { d, claims } = c;
  const mc = d.mediaCaps;
  const h264 = mc?.decode?.["h264-1080p"];
  if (h264 && h264.supported) {
    const hw = h264.powerEfficient;
    add({
      id: "hardware.video-decoder",
      title: "Hardware video decoder",
      value: `H.264 ${hw ? "hardware" : "software"}${mc?.decode?.["hevc-1080p"]?.powerEfficient ? " · HEVC hardware" : ""}${mc?.decode?.["av1-1080p"]?.powerEfficient ? " · AV1 hardware" : ""}`,
      detail: hw
        ? "Video is decoded by a dedicated media engine, as on every phone SoC."
        : "H.264 falls back to software decoding. Every phone decodes H.264 in silicon; headless browsers, CPU rasterisers and many emulators don't.",
      status: hw ? "pass" : claims.mobile ? "warn" : "info",
      evidence: hw ? { phone: 0.2, tablet: 0.2, automation: -0.3 } : claims.mobile ? { emulator: 1.2, automation: 0.6, spoofed: 0.6, phone: -1.0, tablet: -0.8 } : { automation: 0.4 },
    });
  }
  if (d.screen.isExtended) {
    add({
      id: "hardware.multi-monitor",
      title: "Multiple displays",
      value: "screen.isExtended = true",
      detail: "More than one monitor is attached — a desktop workstation.",
      status: claims.mobile ? "fail" : "info",
      evidence: claims.mobile ? { spoofed: 2.5, phone: -2.5, tablet: -2.0 } : { desktop: 1.5, phone: -1.5 },
    });
  }
}

/* -------------------------------- automation ------------------------------- */

export function botdRules(c: Ctx, add: Add) {
  const b = c.d.botd;
  if (!b || b.bot === null) return;
  add({
    id: "automation.botd",
    title: "BotD (open-source bot detector)",
    value: b.bot ? `bot: ${b.kind}` : "no bot detected",
    detail: b.bot ? "FingerprintJS BotD independently classified this browser as automated." : "Independent second opinion from FingerprintJS BotD.",
    status: b.bot ? "fail" : "pass",
    evidence: b.bot ? { automation: 3.0, phone: -1.0, tablet: -1.0 } : { automation: -0.3 },
  });
}

/* --------------------------------- network --------------------------------- */

const sameFamily = (a: string, b: string) => a.includes(":") === b.includes(":");

export function networkRules(c: Ctx, add: Add) {
  const { d, claims } = c;
  const server = c.bundle.server;
  const w = d.webrtc;
  if (w?.supported) {
    const ip = server?.ip ?? null;
    const comparable = ip && !server?.privateIp ? w.srflxIps.filter((x) => sameFamily(x, ip)) : [];
    if (comparable.length && ip) {
      const match = comparable.includes(ip);
      add({
        id: "network.webrtc-path",
        title: "UDP vs HTTP exit address",
        value: `STUN ${comparable[0]} vs HTTP ${ip}`,
        detail: match
          ? "WebRTC and HTTP leave through the same public address."
          : "Browser traffic and UDP traffic exit from different public addresses — an HTTP/SOCKS proxy, split-tunnel VPN or residential-proxy app is in the path.",
        status: match ? "pass" : "warn",
        evidence: match ? { spoofed: -0.3 } : { spoofed: 0.8, automation: 0.4 },
      });
    } else {
      add({
        id: "network.webrtc-path",
        title: "WebRTC network path",
        value: w.srflxIps.length ? `STUN public ${w.srflxIps.join(", ")}` : `no STUN reply (${w.candidateTypes.join(", ") || "no candidates"})`,
        detail: w.srflxIps.length ? "Public UDP address recorded (compared with the HTTP address on the server)." : "UDP to STUN is blocked or WebRTC is restricted (corporate networks, Tor, some privacy settings).",
        status: "info",
      });
    }
  }

  const ipi = server?.ipIntel;
  if (ipi) {
    const k = ipi.source === "heuristic" ? 0.5 : 1;
    const scale = (e: Record<string, number>) => Object.fromEntries(Object.entries(e).map(([key, v]) => [key, v * k]));
    const label = [ipi.asn, ipi.org, ipi.country].filter(Boolean).join(" · ") || "unknown network";
    if (ipi.isTor) {
      add({ id: "network.tor", title: "Tor exit node", value: label, detail: "The request comes from a Tor exit relay.", status: "fail", evidence: { spoofed: 1.0, automation: 1.0 } });
    }
    if (ipi.isDatacenter) {
      add({
        id: "network.datacenter",
        title: "Hosting / datacenter IP",
        value: label,
        detail: "The address belongs to a hosting provider — cloud phones, emulator farms, bots and many VPN exits live here; consumer phones don't.",
        status: "fail",
        evidence: scale({ automation: 1.8, emulator: 1.0, spoofed: 0.8, phone: -1.2, tablet: -1.0 }),
      });
    }
    if (ipi.isVpn || ipi.isProxy) {
      add({
        id: "network.vpn",
        title: "VPN / proxy",
        value: [ipi.isVpn && "VPN", ipi.isProxy && "proxy"].filter(Boolean).join(" + ") + ` · ${label}`,
        detail: "The connection is anonymised through a VPN or proxy service.",
        status: "warn",
        evidence: scale({ spoofed: 0.6, automation: 0.3 }),
      });
    }
    if (ipi.isAbuser) {
      add({ id: "network.abuser", title: "IP reputation", value: label, detail: "The address has recent abuse reports.", status: "warn", evidence: { automation: 0.5 } });
    }
    if (ipi.isMobile) {
      add({
        id: "network.carrier",
        title: "Mobile carrier network",
        value: label,
        detail: `The request arrives over a cellular carrier${ipi.source === "heuristic" ? " (inferred from the network name)" : ""}.`,
        status: "pass",
        evidence: scale({ phone: 1.0, tablet: 0.3, desktop: -0.8, spoofed: -0.8, emulator: -0.6 }),
      });
    }
    if (!ipi.isTor && !ipi.isDatacenter && !ipi.isVpn && !ipi.isProxy && !ipi.isMobile) {
      add({ id: "network.ip", title: "IP network", value: label, detail: ipi.error ? `Lookup degraded: ${ipi.error}` : "Residential / business network.", status: "info" });
    }
    if (ipi.timezone && d.navigator.timezone && ipi.timezone !== d.navigator.timezone) {
      add({
        id: "network.ip-timezone",
        title: "IP timezone vs device timezone",
        value: `${ipi.timezone} vs ${d.navigator.timezone}`,
        detail: "The IP's region is in a different timezone than the device clock (VPN, proxy, travel or a spoofed timezone).",
        status: "warn",
        evidence: { spoofed: 0.5, automation: 0.2 },
      });
    }
  }

  const loc = c.bundle.location;
  if (loc && loc.state === "granted" && typeof loc.accuracy === "number") {
    const gnss = loc.accuracy <= 100 && loc.altitude !== null && loc.altitude !== undefined;
    const impossible = loc.accuracy === 0;
    add({
      id: "network.location",
      title: "Device location fix",
      value: `±${fmt(loc.accuracy, 0)} m${loc.altitude != null ? ` · altitude ${fmt(loc.altitude, 0)} m` : ""}${loc.speed != null ? ` · ${fmt(loc.speed, 1)} m/s` : ""}`,
      detail: impossible
        ? "A 0 m accuracy is impossible for a real receiver — the position was injected (automation / DevTools override)."
        : gnss
          ? "Metre-level fix with altitude: a satellite (GNSS) receiver, as built into phones."
          : loc.accuracy > 1000
            ? "Coarse fix from IP / Wi-Fi databases, typical of desktops."
            : "Network-assisted fix without altitude.",
      status: impossible ? "fail" : gnss ? "pass" : "info",
      evidence: impossible ? { spoofed: 1.5, automation: 1.0 } : gnss ? { phone: 1.0, tablet: 0.4, desktop: -0.8, spoofed: -1.0 } : loc.accuracy > 1000 ? { desktop: 0.3, phone: -0.2 } : {},
    });
    const ipLat = ipi?.lat ?? server?.geo?.lat ?? null;
    const ipLon = ipi?.lon ?? server?.geo?.lon ?? null;
    if (typeof loc.lat === "number" && typeof loc.lon === "number" && typeof ipLat === "number" && typeof ipLon === "number" && loc.accuracy < 5000) {
      const km = haversineKm(loc.lat, loc.lon, ipLat, ipLon);
      const far = km > 1000;
      add({
        id: "network.location-vs-ip",
        title: "Device location vs IP location",
        value: `${Math.round(km).toLocaleString()} km apart`,
        detail: far ? "The device is far from where its IP address is registered: VPN/proxy, or a spoofed GPS position." : "The device location is consistent with the IP's region.",
        status: far ? "warn" : "pass",
        evidence: far ? { spoofed: 0.8, automation: 0.3 } : { spoofed: -0.2 },
      });
    }
  } else if (loc && loc.state !== "skipped") {
    add({ id: "network.location", title: "Device location fix", value: loc.state, detail: loc.error ?? "No position available.", status: "info" });
  }
  void claims;
}

/* --------------------------------- behavior -------------------------------- */

export function behaviorRules(c: Ctx, add: Add) {
  const it = c.bundle.interaction;
  const b = it?.behavior;
  if (b) {
    const reactions: string[] = [];
    let fastest: number | null = null;
    for (const [mark, target] of [
      ["continue-device-shown", "continue-device"],
      ["continue-camera-shown", "continue-camera"],
    ] as const) {
      const shown = b.marks[mark];
      const click = it.clicks.find((x) => x.target === target && x.isTrusted && (shown === undefined || x.t >= shown));
      if (shown !== undefined && click) {
        const dt = click.t - shown;
        reactions.push(`${target.replace("continue-", "")} ${Math.round(dt)} ms`);
        fastest = fastest === null ? dt : Math.min(fastest, dt);
      }
    }
    if (fastest !== null) {
      const superhuman = fastest < 250;
      add({
        id: "behavior.reaction",
        title: "Reaction time",
        value: reactions.join(" · "),
        detail: superhuman
          ? "A Continue button was pressed faster than a human can see and react to it (< 250 ms)."
          : "Time between each Continue button appearing and being pressed.",
        status: superhuman ? "warn" : "info",
        evidence: superhuman ? { automation: 1.2 } : {},
      });
    }
    if (b.hiddenDuringCamera) {
      add({
        id: "behavior.camera-switch",
        title: "Left the page during camera capture",
        value: "visibility changed while recording",
        detail: "The page was hidden while the camera was recording — switching to another app (for example a virtual-camera controller).",
        status: "warn",
        evidence: { spoofed: 0.4, automation: 0.2 },
      });
    }
    add({
      id: "behavior.session",
      title: "Session behaviour",
      value: `${Math.round(b.pageAgeMs / 1000)} s on page · hidden ${b.hiddenCount}× (${Math.round(b.hiddenMs / 1000)} s) · focus lost ${b.blurCount}× · pastes ${b.pastes}${b.navigationType ? ` · ${b.navigationType}` : ""}`,
      detail: "Completion time, tab switching, focus loss, clipboard use and navigation type — Persona-style behavioural risk context.",
      status: "info",
    });
    const keyboardClicks = it.clicks.filter((x) => x.isTrusted && !x.precededByPointerDown).length;
    if (keyboardClicks) {
      add({
        id: "behavior.assistive",
        title: "Keyboard / assistive activation",
        value: `${keyboardClicks} click(s) without a pointer`,
        detail: "Buttons were activated by keyboard, VoiceOver/TalkBack or Switch Control. Not penalised.",
        status: "info",
      });
    }
  }

  const v = c.bundle.server?.velocity;
  if (v) {
    if (v.identitiesOnDevice >= 2) {
      add({
        id: "behavior.identity-switch",
        title: "Identity switching on one device",
        value: `${v.identitiesOnDevice} different user agents from the same browser storage (24 h)`,
        detail: "The same browser profile has presented itself as different devices — what anti-detect and UA-switching tools do.",
        status: "fail",
        evidence: { spoofed: 1.8, phone: -1.0 },
      });
    }
    if (v.identitiesOnFingerprint >= 3) {
      add({
        id: "behavior.fingerprint-switch",
        title: "Identity switching on one fingerprint",
        value: `${v.identitiesOnFingerprint} user agents on the same visitor ID (24 h)`,
        detail: "One hardware/browser fingerprint keeps changing its claimed identity.",
        status: "warn",
        evidence: { spoofed: 1.0 },
      });
    }
    const busy = v.sessionsFromIp > 8 || v.sessionsFromFingerprint > 5;
    add({
      id: "behavior.velocity",
      title: "Verification velocity",
      value: `${v.sessionsFromIp} from this IP · ${v.sessionsFromFingerprint} from this fingerprint (last ${v.windowMinutes} min)`,
      detail: busy ? "Unusually many verification attempts in a short window — scripted retries or a farm." : "Normal attempt rate.",
      status: busy ? "warn" : "info",
      evidence: busy ? { automation: 1.0 } : {},
    });
  }
  const runs = c.bundle.client?.runs;
  if (typeof runs === "number" && runs > 1) {
    add({ id: "behavior.repeat", title: "Repeat verifications", value: `${runs} runs from this browser`, detail: "Counted in this browser's local storage.", status: "info" });
  }
  void list;
}
