/**
 * Open-source detection libraries, used as independent second opinions:
 *  - detectIncognito  (MIT) — private-browsing detection per engine
 *  - BotD             (MIT) — FingerprintJS' open-source bot detector
 *  - FingerprintJS v3 (MIT) — the last MIT release of the visitor-ID library
 * Telemetry ("monitoring") pings to FingerprintJS are disabled.
 */
import type { BotdSignals, FpjsSignals, PrivacySignals } from "../types";
import { errorMessage, withTimeout } from "../util/safe";

export async function collectPrivacy(): Promise<PrivacySignals> {
  try {
    const { detectIncognito } = await import("detectincognitojs");
    const r = await withTimeout(detectIncognito(), 2500, "detectIncognito");
    return { incognito: r.isPrivate, browser: r.browserName };
  } catch (e) {
    return { incognito: null, browser: null, error: errorMessage(e) };
  }
}

export async function collectBotd(): Promise<BotdSignals> {
  try {
    const { load } = await import("@fingerprintjs/botd");
    const detector = await withTimeout(load({ monitoring: false }), 2500, "BotD load");
    await withTimeout(detector.collect(), 2500, "BotD collect").catch(() => undefined);
    const r = detector.detect();
    return { bot: r.bot, kind: r.bot ? String(r.botKind) : null };
  } catch (e) {
    return { bot: null, kind: null, error: errorMessage(e) };
  }
}

export async function collectFpjs(): Promise<FpjsSignals> {
  try {
    const FingerprintJS = (await import("@fingerprintjs/fingerprintjs")).default;
    const agent = await withTimeout(FingerprintJS.load({ monitoring: false }), 3000, "FingerprintJS load");
    const r = await withTimeout(agent.get(), 3000, "FingerprintJS get");
    return { visitorId: r.visitorId, confidence: r.confidence?.score ?? null };
  } catch (e) {
    return { visitorId: null, confidence: null, error: errorMessage(e) };
  }
}
