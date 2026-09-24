import type { Add, Ctx } from "../context";
import { fmt } from "../context";

export function touchRules(c: Ctx, add: Add) {
  const { d, claims } = c;
  const mtp = d.navigator.maxTouchPoints ?? 0;
  const media = d.screen.media;

  if (mtp === 0) {
    add({
      id: "touch.points",
      title: "Touch digitizer",
      value: "0 touch points",
      detail: claims.mobile ? "A “phone” without a touchscreen." : "No touchscreen — normal for desktops and laptops.",
      status: claims.mobile ? "fail" : "info",
      evidence: claims.mobile ? { spoofed: 2.2, automation: 0.8, phone: -2.5, tablet: -2.5 } : { desktop: 1.0, automation: 0.3, phone: -2.2, tablet: -2.0 },
    });
  } else if (mtp === 1) {
    add({
      id: "touch.points",
      title: "Touch digitizer",
      value: "1 touch point",
      detail: "Exactly one touch point is what DevTools / Playwright touch emulation reports; real multi-touch panels report 5 or 10.",
      status: "warn",
      evidence: { spoofed: 1.2, emulator: 0.6, automation: 0.4, phone: -0.8, tablet: -0.8 },
    });
  } else {
    add({
      id: "touch.points",
      title: "Touch digitizer",
      value: `${mtp} touch points`,
      detail: claims.macTouch ? "Macs never have touchscreens: a Mac UA with multi-touch is an iPad or an iPhone in desktop mode." : "Multi-touch panel.",
      status: "pass",
      evidence: claims.macTouch
        ? { tablet: 1.2, phone: 0.8, desktop: -1.5 }
        : claims.mobile
          ? { phone: 0.6, tablet: 0.6, spoofed: -0.3, desktop: -0.4 }
          : { tablet: 0.3, desktop: 0.1 },
    });
  }

  const finePointer = media.anyPointerFine || media.anyHoverHover;
  if (claims.mobile && finePointer) {
    add({
      id: "touch.pointer",
      title: "Pointer media features",
      value: `any-pointer:fine=${media.anyPointerFine} · any-hover=${media.anyHoverHover}`,
      detail: "A precise hovering pointer (mouse / trackpad) is attached to this “phone”.",
      status: "warn",
      evidence: { spoofed: 1.0, phone: -0.6, tablet: -0.3 },
    });
  } else if (media.pointerCoarse && media.hoverNone) {
    add({
      id: "touch.pointer",
      title: "Pointer media features",
      value: "pointer:coarse · hover:none",
      detail: "Primary input is a finger with no hover capability.",
      status: "pass",
      evidence: { phone: 0.4, tablet: 0.4, desktop: -0.6 },
    });
  }

  const ia = c.interaction;
  if (ia.taps || c.bundle.interaction?.clicks.length) {
    const sizeTxt = ia.maxContact !== null ? `max contact ${fmt(ia.maxContact, 1)} px` : "no contact geometry";
    const types = Object.entries(ia.pointerTypes).map(([k, v]) => `${k}×${v}`).join(", ") || "none";
    if (ia.verdict === "finger") {
      add({
        id: "touch.contact",
        title: "Tap physics",
        value: `${types} · ${sizeTxt}`,
        detail: "Taps carried a real fingertip contact patch reported by the touch controller.",
        status: "pass",
        evidence: { phone: 1.2, tablet: 1.2, spoofed: -1.8, desktop: -1.0, automation: -1.5, emulator: -0.6 },
      });
    } else if (ia.verdict === "point-contact") {
      add({
        id: "touch.contact",
        title: "Tap physics",
        value: `${types} · ${sizeTxt}`,
        detail: c.engine === "WebKit"
          ? "Touch events without a contact radius."
          : "Touches have a 1×1 px contact area — mouse clicks converted to touches by an emulator.",
        status: "warn",
        evidence: c.engine === "WebKit" ? { spoofed: 0.6, phone: -0.4 } : { spoofed: 1.6, emulator: 0.8, automation: 0.5, phone: -1.4, tablet: -1.2 },
      });
    } else if (ia.verdict === "mouse") {
      add({
        id: "touch.contact",
        title: "Tap physics",
        value: types,
        detail: claims.mobile ? "The Continue buttons were pressed with a mouse pointer." : "Mouse input.",
        status: claims.mobile ? "fail" : "info",
        evidence: claims.mobile ? { spoofed: 2.5, desktop: 0.5, phone: -2.2, tablet: -1.5 } : { desktop: 0.8, phone: -0.8, tablet: -0.5 },
      });
    } else if (ia.verdict === "scripted") {
      add({
        id: "touch.contact",
        title: "Tap physics",
        value: `${ia.programmaticClicks} programmatic click(s)`,
        detail: "Clicks arrived without a preceding pointer press — dispatched by script.",
        status: "fail",
        evidence: { automation: 3.0, phone: -1.5, tablet: -1.5 },
      });
    }
    if (ia.untrusted > 0) {
      add({
        id: "touch.untrusted",
        title: "Untrusted input events",
        value: `${ia.untrusted} synthetic event(s)`,
        detail: "event.isTrusted was false: the events were created by JavaScript, not by hardware.",
        status: "fail",
        evidence: { automation: 3.0 },
      });
    }
    if (ia.minHoldMs !== null && ia.minHoldMs < 15 && ia.trustedClicks > 0) {
      add({
        id: "touch.timing",
        title: "Tap timing",
        value: `${fmt(ia.minHoldMs, 0)} ms press`,
        detail: "Press-to-release faster than a human finger can manage.",
        status: "warn",
        evidence: { automation: 1.2 },
      });
    } else if (ia.medianHoldMs !== null) {
      add({ id: "touch.timing", title: "Tap timing", value: `${fmt(ia.medianHoldMs, 0)} ms median press`, detail: "Human-scale press duration.", status: "info" });
    }
  }
  if (claims.mobile && ia.hoverMouseMoves > 5) {
    add({
      id: "touch.hover",
      title: "Hovering cursor",
      value: `${ia.hoverMouseMoves} hover moves`,
      detail: "Mouse movement without a pressed button was observed — touchscreens cannot hover.",
      status: "warn",
      evidence: { spoofed: 1.5, phone: -1.2, tablet: -0.6 },
    });
  }
}
