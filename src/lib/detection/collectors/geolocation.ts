import type { LocationSignals } from "../types";
import { errorMessage } from "../util/safe";

const r2 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * One high-accuracy position fix. Phones answer from a GNSS receiver (metre-level
 * accuracy, altitude, often speed/heading); desktops answer from Wi-Fi/IP
 * databases (tens to thousands of metres, no altitude). DevTools/automation
 * overrides return suspiciously round values. Coordinates are rounded to ~1 km
 * and only used to compare against the IP's geolocation.
 * Must be started from a user gesture for the prompt to be shown reliably.
 */
export function requestLocation(timeoutMs = 9000): Promise<LocationSignals> {
  const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geo) return Promise.resolve({ state: "unavailable" });
  const t0 = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: LocationSignals) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, latencyMs: Math.round(performance.now() - t0) });
    };
    try {
      geo.getCurrentPosition(
        (p) =>
          done({
            state: "granted",
            accuracy: r2(p.coords.accuracy),
            altitude: r2(p.coords.altitude),
            altitudeAccuracy: r2(p.coords.altitudeAccuracy),
            heading: r2(p.coords.heading),
            speed: r2(p.coords.speed),
            lat: r2(p.coords.latitude),
            lon: r2(p.coords.longitude),
            fixAgeMs: Math.max(0, Math.round(Date.now() - p.timestamp)),
          }),
        (e) => done({ state: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "error", error: e.message }),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
    } catch (e) {
      done({ state: "error", error: errorMessage(e) });
    }
    setTimeout(() => done({ state: "timeout" }), timeoutMs + 1500);
  });
}
