import type { Add, Ctx } from "../context";
import { list } from "../context";

const IDENTITY_MISMATCH = new Set(["userAgent", "platform", "userAgentData.mobile", "hardwareConcurrency", "CPU architecture", "maxTouchPoints", "screen.width"]);

export function integrityRules(c: Ctx, add: Add) {
  const i = c.d.integrity;
  if (!i) return;
  const failed = (i.checks ?? []).filter((x) => !x.ok);
  const critical = failed.filter((x) => x.critical);
  const soft = failed.filter((x) => !x.critical);
  const privacyBrowser = c.engine !== "Blink" || c.d.navigator.brave;

  if (critical.length) {
    add({
      id: "integrity.native",
      title: "Native API integrity",
      value: `${critical.length} patched: ${list(critical.map((x) => x.target), 3)}`,
      detail: `Identity-bearing browser APIs were replaced by JavaScript. ${critical
        .slice(0, 3)
        .map((x) => `${x.target} — ${x.reasons[0]}`)
        .join("; ")}.`,
      status: "fail",
      evidence: { spoofed: 3.0, automation: 1.0, phone: -2.5, tablet: -2.5, emulator: -0.5, desktop: -1.0 },
    });
  } else {
    add({
      id: "integrity.native",
      title: "Native API integrity",
      value: `${(i.checks ?? []).length} APIs verified`,
      detail: "Getters and methods that spoofing kits patch are still native code (verified with a clean iframe realm, receiver checks and constructor checks).",
      status: "pass",
      evidence: { spoofed: -0.8, automation: -0.3 },
    });
  }
  if (soft.length) {
    add({
      id: "integrity.fp-patches",
      title: "Fingerprinting APIs patched",
      value: list(soft.map((x) => x.target), 3),
      detail: "Canvas/audio/timezone APIs were wrapped — a privacy extension or an anti-detect browser profile.",
      status: "warn",
      evidence: { spoofed: 0.6 },
    });
  }
  if ((i.navigatorOwnKeys ?? []).length || (i.screenOwnKeys ?? []).length) {
    add({
      id: "integrity.own-keys",
      title: "Instance-level overrides",
      value: list([...(i.navigatorOwnKeys ?? []).map((k) => `navigator.${k}`), ...(i.screenOwnKeys ?? []).map((k) => `screen.${k}`)]),
      detail: "Properties were defined directly on navigator/screen, shadowing the real prototype getters.",
      status: "fail",
      evidence: { spoofed: 2.0, phone: -1.5 },
    });
  }

  if (i.iframe?.ok) {
    const mm = i.iframe.mismatches ?? [];
    add({
      id: "integrity.iframe",
      title: "Cross-realm re-read (iframe)",
      value: mm.length ? `mismatch: ${list(mm)}` : "consistent",
      detail: mm.length ? "A fresh iframe sees different identity values than the page — spoofing applied to the top frame only." : "A fresh browsing context reports the same identity.",
      status: mm.length ? "fail" : "pass",
      evidence: mm.length ? { spoofed: 3.0, phone: -2.0, tablet: -2.0 } : { spoofed: -0.3 },
    });
  }
  if (i.worker?.ok) {
    const mm = i.worker.mismatches ?? [];
    const identity = mm.filter((m) => IDENTITY_MISMATCH.has(m));
    add({
      id: "integrity.worker",
      title: "Cross-realm re-read (Web Worker)",
      value: mm.length ? `mismatch: ${list(mm)}` : "consistent",
      detail: identity.length
        ? "A Web Worker — which spoofing scripts rarely reach — reports a different device identity."
        : mm.length
          ? "Minor worker-side differences (GPU/timezone/memory)."
          : "The worker thread independently confirms UA, platform, cores, GPU and CPU architecture.",
      status: identity.length ? "fail" : mm.length ? "warn" : "pass",
      evidence: identity.length ? { spoofed: 3.0, phone: -2.5, tablet: -2.0 } : mm.length ? { spoofed: 1.0 } : { phone: 0.2, tablet: 0.2, spoofed: -0.5 },
    });
  } else if (i.worker && !i.worker.ok) {
    add({ id: "integrity.worker", title: "Cross-realm re-read (Web Worker)", value: "unavailable", detail: i.worker.error ?? "Worker could not start.", status: "info" });
  }

  const canvasNoise = i.canvasStable === false || i.canvasPixelExact === false;
  if (canvasNoise || i.audioStable === false) {
    const what = [canvasNoise && "canvas", i.audioStable === false && "audio"].filter(Boolean).join(" + ");
    add({
      id: "integrity.noise",
      title: "Rendering randomisation",
      value: `${what} output varies between identical renders`,
      detail: privacyBrowser
        ? "Built-in anti-fingerprinting (Safari Advanced Fingerprinting Protection, Brave farbling, Firefox RFP). Expected and not penalised."
        : "Chromium does not randomise renders by default: an anti-detect browser or fingerprint-spoofing extension is injecting noise.",
      status: privacyBrowser ? "info" : "warn",
      evidence: privacyBrowser ? {} : { spoofed: 1.2, phone: -0.5 },
    });
  }
}
