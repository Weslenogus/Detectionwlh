import type { MediaDeviceRecord } from "../types";
import { hash128 } from "../util/hash";
import { attempt, withTimeout } from "../util/safe";

export const shortHash = (id: string) => (id ? hash128(id).slice(0, 12) : "");

/** Serialise capabilities into plain JSON (ranges, arrays, booleans). */
export function plainCaps(caps: unknown): Record<string, unknown> | null {
  if (!caps || typeof caps !== "object") return null;
  try {
    const out = JSON.parse(JSON.stringify(caps)) as Record<string, unknown>;
    if ("deviceId" in out) out.deviceId = shortHash(String(out.deviceId));
    if ("groupId" in out) out.groupId = shortHash(String(out.groupId));
    return out;
  } catch {
    return null;
  }
}

export async function listDevices(): Promise<MediaDeviceRecord[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const list = await withTimeout(navigator.mediaDevices.enumerateDevices(), 2000, "enumerateDevices").catch(() => [] as MediaDeviceInfo[]);
  return list.map((d) => {
    // Chromium exposes per-device capabilities (incl. facingMode) without opening the camera.
    const caps =
      d.kind === "videoinput" && typeof (d as InputDeviceInfo).getCapabilities === "function"
        ? attempt(() => (d as InputDeviceInfo).getCapabilities(), null)
        : null;
    const facing = caps && Array.isArray((caps as MediaTrackCapabilities).facingMode) ? ((caps as MediaTrackCapabilities).facingMode as string[]) : undefined;
    return {
      kind: d.kind,
      label: d.label,
      deviceId: shortHash(d.deviceId),
      groupId: shortHash(d.groupId),
      facingMode: facing,
      capabilities: plainCaps(caps),
    };
  });
}

/** Is `fn` still the browser's own implementation (not a hook installed by an injection kit)? */
export function isNativeMediaFn(name: "getUserMedia" | "enumerateDevices"): boolean {
  return attempt(() => {
    const md = navigator.mediaDevices as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(md, name)) return false;
    const fn = md[name] as (...a: unknown[]) => unknown;
    const protoFn = (MediaDevices.prototype as unknown as Record<string, unknown>)[name];
    if (fn !== protoFn) return false;
    return /\{\s*\[native code\]\s*\}$/.test(Function.prototype.toString.call(fn)) && !Object.prototype.hasOwnProperty.call(fn, "prototype");
  }, false);
}
