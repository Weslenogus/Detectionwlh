import { collectAutomation } from "./collectors/automation";
import { collectCpu } from "./collectors/cpu";
import { collectEnvironment } from "./collectors/environment";
import { collectFingerprint } from "./collectors/fingerprint";
import { collectWebGL, collectWebGPU } from "./collectors/gpu";
import { collectIntegrity } from "./collectors/integrity";
import { collectNavigator } from "./collectors/navigator";
import { collectPlatformApis } from "./collectors/platform";
import { collectScreen, collectTouch } from "./collectors/screen";
import { collectHostOs } from "./collectors/host-os";
import { collectMediaCaps } from "./collectors/media-caps";
import { collectBotd, collectFpjs, collectPrivacy } from "./collectors/third-party";
import { collectTimezone } from "./collectors/timezone";
import { collectWebRtc } from "./collectors/webrtc";
import type {
  AutomationSignals,
  BotdSignals,
  FpjsSignals,
  HostOsSignals,
  PrivacySignals,
  TimezoneSignals,
  CpuSignals,
  DeviceSignals,
  EnvironmentSignals,
  FingerprintSignals,
  IntegritySignals,
  NavigatorSignals,
  ScreenSignals,
  WebGLSignals,
  WebGPUSignals,
} from "./types";
import { hash128 } from "./util/hash";
import { errorMessage, sleep } from "./util/safe";

export const SIGNALS_VERSION = 1;

export type ScanStepId =
  | "identity"
  | "display"
  | "cpu"
  | "gpu"
  | "webgpu"
  | "platform"
  | "fingerprint"
  | "media"
  | "environment"
  | "network"
  | "automation"
  | "privacy"
  | "integrity"
  | "sensors";

export const SCAN_STEPS: { id: ScanStepId; label: string; hint: string }[] = [
  { id: "identity", label: "User agent & client hints", hint: "Parses UA string and high-entropy UA-CH values" },
  { id: "display", label: "Display geometry & touch digitizer", hint: "Screen, DPR, safe-area insets, pointer media queries" },
  { id: "cpu", label: "CPU architecture probe", hint: "Hardware default-NaN bits via JS and WebAssembly" },
  { id: "gpu", label: "GPU pipeline & shader precision", hint: "Renderer, extensions, measured mediump mantissa bits" },
  { id: "webgpu", label: "WebGPU adapter", hint: "Adapter vendor / architecture cross-check" },
  { id: "platform", label: "Platform-exclusive APIs", hint: "APIs compiled only into Android, iOS or desktop builds" },
  { id: "fingerprint", label: "Host OS text stack & fingerprints", hint: "system-ui font, emoji, fonts, voices, audio, canvas" },
  { id: "media", label: "Hardware media engines", hint: "H.264/HEVC/VP9/AV1 decoders, WebRTC codecs" },
  { id: "environment", label: "Power, clock & media devices", hint: "Battery, connection, timezone consistency, cameras" },
  { id: "network", label: "Network path (WebRTC STUN)", hint: "Public UDP address vs HTTP address" },
  { id: "automation", label: "Automation & bot detection", hint: "WebDriver, CDP, injected globals, BotD" },
  { id: "privacy", label: "Private mode & device ID", hint: "Incognito detection, FingerprintJS visitor ID" },
  { id: "integrity", label: "Tamper & cross-realm verification", hint: "Native code, iframe, sandbox, worker, service worker" },
  { id: "sensors", label: "Motion sensors", hint: "Accelerometer / gyroscope noise and gravity" },
];

export type StepStatus = "pending" | "running" | "done" | "error";
export type ProgressFn = (id: ScanStepId, status: StepStatus, detail?: string) => void;

const EMPTY_NAV = (): NavigatorSignals => ({
  userAgent: navigator.userAgent,
  appVersion: "",
  platform: "",
  vendor: "",
  language: "",
  languages: [],
  hardwareConcurrency: null,
  deviceMemory: null,
  maxTouchPoints: 0,
  cookieEnabled: false,
  doNotTrack: null,
  globalPrivacyControl: null,
  pdfViewerEnabled: null,
  webdriver: null,
  pluginsCount: 0,
  pluginNames: [],
  mimeTypesCount: 0,
  uaData: null,
  timezone: "",
  timezoneOffset: 0,
  locale: "",
  jsHeapSizeLimit: null,
  isSecureContext: false,
  standalone: null,
  brave: false,
  engineFeatures: { blink: false, webkit: false, gecko: false, details: {} },
});

const EMPTY_SCREEN = (): ScreenSignals => ({
  width: 0,
  height: 0,
  availWidth: 0,
  availHeight: 0,
  colorDepth: 0,
  pixelDepth: 0,
  dpr: 1,
  innerWidth: 0,
  innerHeight: 0,
  outerWidth: 0,
  outerHeight: 0,
  screenX: 0,
  screenY: 0,
  orientationType: null,
  orientationAngle: null,
  windowOrientation: null,
  hasWindowOrientation: false,
  visualViewport: null,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  media: {},
  refreshRate: null,
});

const EMPTY_CPU = (): CpuSignals => ({ nanArchJs: "unknown", nanBitsJs: "", nanArchWasm: "unknown", nanBitsWasm: "", benchmarkMs: null });

const EMPTY_FP = (): FingerprintSignals & { audioStable: boolean | null } => ({
  canvasHash: null,
  webglHash: null,
  audioHash: null,
  audio: { sampleRate: null, baseLatency: null, outputLatency: null, maxChannelCount: null, state: null },
  fonts: [],
  voices: { count: 0, names: [], localMicrosoft: 0, google: 0, apple: 0, defaultVoice: null },
  emojiHash: null,
  mathHash: null,
  visitorId: null,
  audioStable: null,
});

const EMPTY_ENV = (): EnvironmentSignals => ({
  battery: { supported: false },
  connection: { supported: false },
  storageQuota: null,
  permissions: {},
  mediaDevicesPre: null,
  webview: { androidWebView: false, iosWebView: false, inApp: null },
  hevcDecode: null,
});

const EMPTY_AUTOMATION = (): AutomationSignals => ({
  webdriver: null,
  headlessUA: false,
  headlessBrand: false,
  knownGlobals: [],
  documentMarkers: [],
  notificationInconsistent: null,
  outerDimensionsZero: false,
  chromeObject: false,
  chromeRuntime: false,
  languagesEmpty: false,
  cdpSerialization: null,
  stackMarkers: [],
  permissionsQueryTampered: false,
});

const EMPTY_INTEGRITY = (): IntegritySignals => ({
  checks: [],
  toStringNative: true,
  navigatorOwnKeys: [],
  screenOwnKeys: [],
  iframe: { ok: false, mismatches: [] },
  worker: { ok: false, mismatches: [] },
  canvasStable: null,
  canvasPixelExact: null,
  audioStable: null,
});

export interface ScanOptions {
  onProgress?: ProgressFn;
  /** Resolves once motion sensors have had enough time to report (sampler runs in the background). */
  waitForSensors?: () => Promise<string | void>;
}

export async function runDeviceScan(opts: ScanOptions = {}): Promise<DeviceSignals> {
  const t0 = performance.now();
  const errors: Record<string, string> = {};
  const timings: Record<string, number> = {};
  const progress = opts.onProgress ?? (() => undefined);

  async function step<T>(id: ScanStepId, fn: () => T | Promise<T>, fallback: () => T, detail?: (v: T) => string | undefined): Promise<T> {
    progress(id, "running");
    const s = performance.now();
    // Yield so the UI can paint the "running" state between heavy probes.
    await sleep(16);
    try {
      const v = await fn();
      timings[id] = Math.round(performance.now() - s);
      progress(id, "done", detail?.(v));
      return v;
    } catch (e) {
      errors[id] = errorMessage(e);
      timings[id] = Math.round(performance.now() - s);
      progress(id, "error", errors[id]);
      return fallback();
    }
  }

  // Slow, network-bound probes run in the background while the rest executes.
  const webrtcP = collectWebRtc();
  const fpjsP = collectFpjs();

  const nav = await step("identity", collectNavigator, EMPTY_NAV, (n) =>
    n.uaData?.high?.model ? `${n.uaData.platform} · ${n.uaData.high.model}` : n.platform,
  );
  const { screen: scr, touch } = await step(
    "display",
    async () => ({ screen: await collectScreen(), touch: collectTouch() }),
    () => ({ screen: EMPTY_SCREEN(), touch: { maxTouchPoints: 0, ontouchstart: false, touchEvent: false, createTouchEvent: false, pointerEvent: false } }),
    (v) => `${v.screen.width}×${v.screen.height} @${Math.round(v.screen.dpr * 100) / 100}x · ${v.touch.maxTouchPoints} touch points`,
  );
  const cpu = await step("cpu", collectCpu, EMPTY_CPU, (c) => `${c.nanArchJs.toUpperCase()} (0x${c.nanBitsJs || "?"})`);
  const webgl = await step<WebGLSignals>("gpu", collectWebGL, () => ({ supported: false }), (g) => g.unmaskedRenderer ?? g.renderer ?? "unavailable");
  const webgpu = await step<WebGPUSignals>("webgpu", collectWebGPU, () => ({ supported: false }), (g) =>
    g.adapter ? `${g.adapter.vendor || "unknown"} · ${g.adapter.architecture || "?"}` : g.supported ? "no adapter" : "not supported",
  );
  const platformApis = await step("platform", collectPlatformApis, () => ({}), (p) => `${Object.values(p).filter(Boolean).length} APIs exposed`);
  const { fp, hostOs } = await step(
    "fingerprint",
    async () => ({ fp: await collectFingerprint(), hostOs: collectHostOs() as HostOsSignals | undefined }),
    () => ({ fp: EMPTY_FP(), hostOs: undefined }),
    (v) => `system-ui → ${v.hostOs?.systemUiFont ?? "unknown"} · ${v.fp.fonts.length} fonts · ${v.fp.voices.count} voices`,
  );
  const mediaCaps = await step("media", collectMediaCaps, () => undefined, (m) => {
    const h = m?.decode["h264-1080p"];
    return h ? `H.264 ${h.powerEfficient ? "hardware" : "software"} · ${m?.rtcVideoCodecs.length ?? 0} RTC codecs` : "not exposed";
  });
  const { env, timezone } = await step(
    "environment",
    async () => ({ env: await collectEnvironment(), timezone: collectTimezone() as TimezoneSignals | undefined }),
    () => ({ env: EMPTY_ENV(), timezone: undefined }),
    (v) =>
      [v.env.connection.type ?? v.env.connection.effectiveType, v.env.mediaDevicesPre ? `${v.env.mediaDevicesPre.videoinput} camera(s)` : null, v.timezone?.zone]
        .filter(Boolean)
        .join(" · "),
  );
  const webrtc = await step("network", () => webrtcP, () => undefined, (w) =>
    w?.srflxIps.length ? `public UDP ${w.srflxIps[0]}` : w?.supported ? `no STUN reply (${w.candidateTypes.join(", ") || "blocked"})` : "WebRTC unavailable",
  );
  const { automation, botd } = await step(
    "automation",
    async () => ({ automation: await collectAutomation(), botd: (await collectBotd()) as BotdSignals | undefined }),
    () => ({ automation: EMPTY_AUTOMATION(), botd: undefined }),
    (v) =>
      v.automation.webdriver ? "webdriver flag set" : v.botd?.bot ? `BotD: ${v.botd.kind}` : v.automation.knownGlobals.length ? `${v.automation.knownGlobals.length} markers` : "clean",
  );
  const { privacy, fpjs } = await step(
    "privacy",
    async () => ({ privacy: (await collectPrivacy()) as PrivacySignals | undefined, fpjs: (await fpjsP) as FpjsSignals | undefined }),
    () => ({ privacy: undefined, fpjs: undefined }),
    (v) => `${v.privacy?.incognito ? "private window" : v.privacy?.incognito === false ? "normal window" : "mode unknown"} · ID ${v.fpjs?.visitorId?.slice(0, 8) ?? "n/a"}`,
  );
  const integrity = await step(
    "integrity",
    () =>
      collectIntegrity({
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        timezone: nav.timezone,
        uaMobile: nav.uaData?.mobile ?? null,
        gpuRenderer: webgl.unmaskedRenderer ?? null,
        nanArch: cpu.nanArchJs,
        audioStable: fp.audioStable,
      }),
    EMPTY_INTEGRITY,
    (i) => {
      const realms = [i.iframe, i.worker, i.sandbox, i.serviceWorker].filter((r) => r?.ok).length;
      const bad =
        i.checks.filter((c) => !c.ok).length +
        [i.iframe, i.worker, i.sandbox, i.serviceWorker].reduce((n, r) => n + (r?.mismatches.length ?? 0), 0);
      return bad ? `${bad} anomalies` : `${i.checks.length} APIs native · ${realms} realms agree`;
    },
  );
  await step(
    "sensors",
    async () => (opts.waitForSensors ? await opts.waitForSensors() : undefined),
    () => undefined,
    (d) => (typeof d === "string" ? d : undefined),
  );

  const { audioStable: _audioStable, ...fingerprint } = fp;
  void _audioStable;
  fingerprint.webglHash = webgl.renderHash ?? null;
  fingerprint.visitorId = hash128(
    JSON.stringify([
      fingerprint.canvasHash,
      fingerprint.webglHash,
      fingerprint.audioHash,
      fingerprint.fonts,
      webgl.unmaskedRenderer,
      scr.width,
      scr.height,
      scr.dpr,
      nav.hardwareConcurrency,
      nav.timezone,
      nav.languages,
      nav.platform,
      cpu.nanArchJs,
    ]),
  );

  return {
    version: SIGNALS_VERSION,
    collectedAt: Date.now(),
    durationMs: Math.round(performance.now() - t0),
    navigator: nav,
    screen: scr,
    touch,
    webgl,
    webgpu,
    cpu,
    platformApis,
    integrity,
    automation,
    fingerprint,
    environment: env,
    hostOs,
    timezone,
    mediaCaps,
    webrtc,
    privacy,
    botd,
    fpjs,
    errors,
    timings,
  };
}
