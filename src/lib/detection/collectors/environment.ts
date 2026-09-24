import { parseUA } from "../knowledge/ua";
import type { EnvironmentSignals } from "../types";
import { attempt, withTimeout } from "../util/safe";

async function battery(): Promise<EnvironmentSignals["battery"]> {
  const nav = navigator as unknown as { getBattery?: () => Promise<Record<string, unknown>> };
  if (typeof nav.getBattery !== "function") return { supported: false };
  try {
    const b = await withTimeout(nav.getBattery(), 1000, "getBattery");
    const fin = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    return {
      supported: true,
      level: typeof b.level === "number" ? b.level : undefined,
      charging: typeof b.charging === "boolean" ? b.charging : undefined,
      chargingTime: fin(b.chargingTime),
      dischargingTime: fin(b.dischargingTime),
    };
  } catch {
    return { supported: false };
  }
}

function connection(): EnvironmentSignals["connection"] {
  const c = (navigator as unknown as { connection?: Record<string, unknown> }).connection;
  if (!c) return { supported: false };
  return {
    supported: true,
    type: (c.type as string) ?? null,
    effectiveType: (c.effectiveType as string) ?? null,
    rtt: typeof c.rtt === "number" ? (c.rtt as number) : null,
    downlink: typeof c.downlink === "number" ? (c.downlink as number) : null,
    saveData: typeof c.saveData === "boolean" ? (c.saveData as boolean) : null,
  };
}

async function permissions(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!navigator.permissions?.query) return out;
  const names = ["camera", "microphone", "geolocation", "notifications", "accelerometer", "gyroscope", "magnetometer", "persistent-storage"];
  await Promise.all(
    names.map(async (name) => {
      try {
        const s = await withTimeout(navigator.permissions.query({ name: name as PermissionName }), 800);
        out[name] = s.state;
      } catch {
        out[name] = "unsupported";
      }
    }),
  );
  return out;
}

async function mediaDevicesPre(): Promise<EnvironmentSignals["mediaDevicesPre"]> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const list = await withTimeout(navigator.mediaDevices.enumerateDevices(), 1500, "enumerateDevices");
    return {
      videoinput: list.filter((d) => d.kind === "videoinput").length,
      audioinput: list.filter((d) => d.kind === "audioinput").length,
      audiooutput: list.filter((d) => d.kind === "audiooutput").length,
      labelsVisible: list.some((d) => d.label !== ""),
    };
  } catch {
    return null;
  }
}

function hevc(): boolean | null {
  return attempt(() => {
    const ms = (window as unknown as { MediaSource?: typeof MediaSource }).MediaSource;
    if (ms?.isTypeSupported) return ms.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"');
    const v = document.createElement("video");
    return v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "";
  }, null);
}

export async function collectEnvironment(): Promise<EnvironmentSignals> {
  const ua = parseUA(navigator.userAgent);
  const [bat, perms, media, quota] = await Promise.all([
    battery(),
    permissions(),
    mediaDevicesPre(),
    navigator.storage?.estimate
      ? withTimeout(navigator.storage.estimate(), 1000)
          .then((e) => e.quota ?? null)
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    battery: bat,
    connection: connection(),
    storageQuota: quota,
    permissions: perms,
    mediaDevicesPre: media,
    webview: {
      androidWebView: ua.webview === "android-webview",
      iosWebView: ua.webview === "ios-wkwebview",
      inApp: ua.inApp,
    },
    hevcDecode: hevc(),
  };
}
