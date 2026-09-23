import { analyzeInteraction, type InteractionAnalysis } from "../interaction/analysis";
import { classifyGpu, classifyWebGpuVendor, type GpuClass, type GpuInfo } from "../knowledge/gpu";
import { isMobileOS, parseUA, type Engine, type ParsedUA } from "../knowledge/ua";
import { analyzeMotion, type MotionAnalysis } from "../sensors/analysis";
import type { CameraClass, CategoryId, DeviceClass, DeviceSignals, Evidence, Finding, FindingStatus, SignalBundle } from "../types";

export interface Claims {
  mobile: boolean;
  phone: boolean;
  tablet: boolean;
  desktop: boolean;
  /** "Macintosh" UA on a touch device: iPadOS default, or an iPhone in desktop-site mode. */
  macTouch: boolean;
  ios: boolean;
  android: boolean;
}

export interface Ctx {
  bundle: SignalBundle;
  d: DeviceSignals;
  ua: ParsedUA;
  claims: Claims;
  engine: Engine;
  gpu: GpuInfo;
  webgpuClass: GpuClass | null;
  cpuArch: "x86" | "arm" | "unknown";
  motion: MotionAnalysis;
  interaction: InteractionAnalysis;
}

function safely<T>(fn: () => T, fallback: () => T): T {
  try {
    return fn();
  } catch {
    return fallback();
  }
}

export function detectEngine(d: DeviceSignals): Engine {
  const e = d.navigator.engineFeatures;
  if (e?.blink) return "Blink";
  if (e?.gecko) return "Gecko";
  if (e?.webkit) return "WebKit";
  return "Unknown";
}

export function buildContext(bundle: SignalBundle): Ctx {
  const d = bundle.device;
  const ua = parseUA(d.navigator?.userAgent ?? "");
  const macTouch = ua.os === "macOS" && (d.navigator?.maxTouchPoints ?? 0) > 1;
  const uaMobile = d.navigator?.uaData?.mobile === true;
  const mobile = isMobileOS(ua.os) || ua.mobileToken || uaMobile;
  const claims: Claims = {
    mobile,
    phone: mobile && ua.claimedForm !== "tablet",
    tablet: ua.claimedForm === "tablet",
    desktop: !mobile,
    macTouch,
    ios: ua.os === "iOS" || ua.os === "iPadOS",
    android: ua.os === "Android" || ua.os === "HarmonyOS",
  };
  const js = d.cpu?.nanArchJs ?? "unknown";
  const wasm = d.cpu?.nanArchWasm ?? "unknown";
  const cpuArch = js !== "unknown" && (wasm === "unknown" || wasm === js) ? js : wasm !== "unknown" && js === "unknown" ? wasm : "unknown";
  const adapter = d.webgpu?.adapter;
  return {
    bundle,
    d,
    ua,
    claims,
    engine: detectEngine(d),
    gpu: classifyGpu(d.webgl?.unmaskedRenderer ?? d.webgl?.renderer, d.webgl?.unmaskedVendor),
    webgpuClass: adapter && (adapter.vendor || adapter.architecture) ? classifyWebGpuVendor(adapter.vendor, adapter.architecture) : null,
    cpuArch,
    motion: safely(() => analyzeMotion(bundle.motion), () => analyzeMotion(null)),
    interaction: safely(() => analyzeInteraction(bundle.interaction), () => analyzeInteraction(null)),
  };
}

export interface FindingInput {
  id: string;
  title: string;
  detail: string;
  status: FindingStatus;
  value?: string;
  evidence?: Evidence<DeviceClass>;
  cameraEvidence?: Evidence<CameraClass>;
}

export type Add = (f: FindingInput) => void;

export function makeCollector(category: CategoryId, sink: Finding[]): Add {
  return (f) => {
    const evidence = f.evidence ?? {};
    const cam = f.cameraEvidence;
    const weight = Math.max(0, ...Object.values(evidence).map((v) => Math.abs(v ?? 0)), ...(cam ? Object.values(cam).map((v) => Math.abs(v ?? 0)) : []));
    sink.push({ ...f, category, evidence, cameraEvidence: cam, weight: Math.round(weight * 100) / 100 });
  };
}

export const fmt = (v: number | null | undefined, digits = 2) =>
  typeof v === "number" && Number.isFinite(v) ? (Math.round(v * 10 ** digits) / 10 ** digits).toString() : "n/a";

export const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max}` : xs.join(", "));
