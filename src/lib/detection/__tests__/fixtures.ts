/**
 * Realistic signal fixtures for engine tests. Values mirror what the
 * collectors produce on the named platforms; each fixture changes only what
 * that platform genuinely changes.
 */
import { analyzeFlash } from "../camera/flash";
import { frameGeometry, KEY_LANDMARKS, type Active3DSignals, type PoseDir } from "../camera/liveness3d";
import type {
  CameraCapture,
  CameraSignals,
  DeviceSignals,
  FrameMetric,
  InteractionSignals,
  MotionSample,
  NoiseMap,
  NoiseTile,
  MotionSignals,
  OrientationSample,
  SignalBundle,
} from "../types";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

function merge<T>(base: T, over: DeepPartial<T> | undefined): T {
  if (!over) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b) ? merge(b, v as never) : v;
  }
  return out as T;
}

/** Seeded PRNG so tests are deterministic. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
export function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const ANDROID_ONLY = { NDEFReader: true, ContactsManager: true, windowOrientation: true };
const DESKTOP_ONLY = {
  EyeDropper: true,
  showOpenFilePicker: true,
  hid: true,
  getScreenDetails: true,
  documentPictureInPicture: true,
  keyboardMap: true,
  queryLocalFonts: true,
  windowControlsOverlay: true,
};

export function baseDevice(): DeviceSignals {
  return {
    version: 1,
    collectedAt: 0,
    durationMs: 1500,
    navigator: {
      userAgent: "",
      appVersion: "",
      platform: "",
      vendor: "Google Inc.",
      language: "en-US",
      languages: ["en-US", "en"],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      cookieEnabled: true,
      doNotTrack: null,
      globalPrivacyControl: null,
      pdfViewerEnabled: true,
      webdriver: false,
      pluginsCount: 5,
      pluginNames: [],
      mimeTypesCount: 2,
      uaData: null,
      timezone: "America/Toronto",
      timezoneOffset: 240,
      locale: "en-US",
      jsHeapSizeLimit: null,
      isSecureContext: true,
      standalone: null,
      brave: false,
      engineFeatures: { blink: true, webkit: false, gecko: false, details: {} },
    },
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1040,
      colorDepth: 24,
      pixelDepth: 24,
      dpr: 1,
      innerWidth: 1920,
      innerHeight: 960,
      outerWidth: 1920,
      outerHeight: 1040,
      screenX: 0,
      screenY: 0,
      orientationType: "landscape-primary",
      orientationAngle: 0,
      windowOrientation: null,
      hasWindowOrientation: false,
      visualViewport: { width: 1920, height: 960, scale: 1 },
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      media: { pointerFine: true, anyPointerFine: true, hoverHover: true, anyHoverHover: true, portrait: false },
      refreshRate: 60,
    },
    touch: { maxTouchPoints: 0, ontouchstart: false, touchEvent: false, createTouchEvent: false, pointerEvent: true },
    webgl: {
      supported: true,
      unmaskedVendor: "Google Inc. (NVIDIA)",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      maxTextureSize: 16384,
      extensions: ["WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb", "EXT_texture_compression_bptc"],
      precision: { fragmentMedium: { rangeMin: 127, rangeMax: 127, precision: 23 } },
      mediumpProbeBits: 23,
    },
    webgpu: { supported: true, adapter: { vendor: "nvidia", architecture: "ampere", device: "", description: "", isFallbackAdapter: false, features: [], limits: {} } },
    cpu: { nanArchJs: "x86", nanBitsJs: "ffc00000", nanArchWasm: "x86", nanBitsWasm: "ffc00000", benchmarkMs: 3 },
    platformApis: { ...DESKTOP_ONLY, NDEFReader: false, ContactsManager: false, windowOrientation: false },
    integrity: {
      checks: [{ target: "Navigator.userAgent", ok: true, reasons: [], critical: true }],
      toStringNative: true,
      navigatorOwnKeys: [],
      screenOwnKeys: [],
      iframe: { ok: true, mismatches: [] },
      worker: { ok: true, mismatches: [] },
      canvasStable: true,
      canvasPixelExact: true,
      audioStable: true,
    },
    automation: {
      webdriver: false,
      headlessUA: false,
      headlessBrand: false,
      knownGlobals: [],
      documentMarkers: [],
      notificationInconsistent: false,
      outerDimensionsZero: false,
      chromeObject: true,
      chromeRuntime: false,
      languagesEmpty: false,
      cdpSerialization: false,
      stackMarkers: [],
      permissionsQueryTampered: false,
    },
    fingerprint: {
      canvasHash: "c",
      webglHash: "w",
      audioHash: "a",
      audio: { sampleRate: 48000, baseLatency: 0.01, outputLatency: 0, maxChannelCount: 2, state: "suspended" },
      fonts: ["Segoe UI", "Calibri", "Cambria", "Consolas", "Arial"],
      voices: { count: 3, names: ["Microsoft David - English (United States)"], localMicrosoft: 3, google: 0, apple: 0, defaultVoice: null },
      emojiHash: "e",
      mathHash: "m",
      visitorId: "v",
    },
    environment: {
      battery: { supported: true, level: 1, charging: true, chargingTime: 0, dischargingTime: null },
      connection: { supported: true, type: null, effectiveType: "4g", rtt: 50, downlink: 10, saveData: false },
      storageQuota: 100e9,
      permissions: {},
      mediaDevicesPre: { videoinput: 1, audioinput: 1, audiooutput: 1, labelsVisible: false },
      webview: { androidWebView: false, iosWebView: false, inApp: null },
      hevcDecode: true,
    },
    errors: {},
    timings: {},
  };
}

export const device = (over?: DeepPartial<DeviceSignals>) => merge(baseDevice(), over);

/* ------------------------------ Platforms ------------------------------ */

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
export const PIXEL_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
export const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export function realIPhone(): DeviceSignals {
  return device({
    navigator: {
      userAgent: IPHONE_UA,
      platform: "iPhone",
      vendor: "Apple Computer, Inc.",
      maxTouchPoints: 5,
      hardwareConcurrency: 6,
      deviceMemory: null,
      pdfViewerEnabled: true,
      pluginsCount: 5,
      uaData: null,
      engineFeatures: { blink: false, webkit: true, gecko: false, details: {} },
    },
    screen: {
      width: 393,
      height: 852,
      availWidth: 393,
      availHeight: 852,
      dpr: 3,
      innerWidth: 393,
      innerHeight: 659,
      outerWidth: 393,
      outerHeight: 852,
      orientationType: "portrait-primary",
      hasWindowOrientation: true,
      windowOrientation: 0,
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      media: { pointerCoarse: true, hoverNone: true, anyPointerFine: false, anyHoverHover: false, portrait: true, colorGamutP3: true, dynamicRangeHigh: true },
    },
    touch: { maxTouchPoints: 5, ontouchstart: true, touchEvent: true, createTouchEvent: true },
    webgl: {
      unmaskedVendor: "Apple Inc.",
      unmaskedRenderer: "Apple GPU",
      extensions: ["WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc", "WEBGL_compressed_texture_pvrtc"],
      precision: { fragmentMedium: { rangeMin: 15, rangeMax: 15, precision: 10 } },
      mediumpProbeBits: 10,
    },
    webgpu: { supported: true, adapter: { vendor: "apple", architecture: "common-3", device: "", description: "", isFallbackAdapter: false, features: [], limits: {} } },
    cpu: { nanArchJs: "arm", nanBitsJs: "7fc00000", nanArchWasm: "arm", nanBitsWasm: "7fc00000" },
    platformApis: {
      motionRequestPermission: true,
      orientationRequestPermission: true,
      webkitTouchCallout: true,
      ontouchstart: true,
      TouchEvent: true,
      windowOrientation: true,
      EyeDropper: false,
      showOpenFilePicker: false,
      hid: false,
      getScreenDetails: false,
      documentPictureInPicture: false,
      keyboardMap: false,
      queryLocalFonts: false,
      windowControlsOverlay: false,
    },
    automation: { chromeObject: false },
    hostOs: { systemUiFont: "Apple system font (SF)", appleSystemFont: true, flagEmojiAsLetters: false, subpixelText: false },
    timezone: { zone: "America/Toronto", intlOffset: 240, dateOffset: 240, consistent: true, numberLocale: "en-US", dateLocale: "en-US" },
    mediaCaps: { supported: true, decode: { "h264-1080p": { supported: true, smooth: true, powerEfficient: true } }, rtcVideoCodecs: ["H264", "VP8", "VP9", "H265"] },
    fingerprint: {
      fonts: ["Helvetica Neue", "Avenir", "Menlo", "PingFang SC", "Futura", "Arial"],
      voices: { count: 60, names: ["Samantha"], localMicrosoft: 0, google: 0, apple: 60, defaultVoice: "Samantha" },
    },
    environment: {
      battery: { supported: false },
      connection: { supported: false },
      mediaDevicesPre: { videoinput: 1, audioinput: 1, audiooutput: 0, labelsVisible: false },
    },
  });
}

export function realPixel(): DeviceSignals {
  return device({
    navigator: {
      userAgent: PIXEL_UA,
      platform: "Linux armv8l",
      maxTouchPoints: 5,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      pdfViewerEnabled: false,
      pluginsCount: 0,
      uaData: {
        brands: [{ brand: "Chromium", version: "141" }, { brand: "Google Chrome", version: "141" }],
        mobile: true,
        platform: "Android",
        high: { architecture: "", bitness: "", model: "Pixel 8", platformVersion: "15.0.0", formFactors: ["Mobile"] },
      },
    },
    screen: {
      width: 412,
      height: 915,
      availWidth: 412,
      availHeight: 915,
      dpr: 2.625,
      innerWidth: 412,
      innerHeight: 780,
      outerWidth: 412,
      outerHeight: 860,
      orientationType: "portrait-primary",
      hasWindowOrientation: true,
      windowOrientation: 0,
      safeArea: { top: 24, right: 0, bottom: 0, left: 0 },
      media: { pointerCoarse: true, hoverNone: true, anyPointerFine: false, anyHoverHover: false, portrait: true },
    },
    touch: { maxTouchPoints: 5, ontouchstart: true, touchEvent: true, createTouchEvent: true },
    webgl: {
      unmaskedVendor: "Google Inc. (ARM)",
      unmaskedRenderer: "ANGLE (ARM, Mali-G715, OpenGL ES 3.2)",
      extensions: ["WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc"],
      precision: { fragmentMedium: { rangeMin: 15, rangeMax: 15, precision: 10 } },
      mediumpProbeBits: 10,
    },
    webgpu: { supported: true, adapter: { vendor: "arm", architecture: "valhall", device: "", description: "", isFallbackAdapter: false, features: [], limits: {} } },
    cpu: { nanArchJs: "arm", nanBitsJs: "7fc00000", nanArchWasm: "arm", nanBitsWasm: "7fc00000" },
    platformApis: { ...ANDROID_ONLY, ...Object.fromEntries(Object.keys(DESKTOP_ONLY).map((k) => [k, false])), keyboardMap: true, showOpenFilePicker: true },
    hostOs: { systemUiFont: "Roboto", appleSystemFont: false, flagEmojiAsLetters: false, subpixelText: false },
    timezone: { zone: "America/Toronto", intlOffset: 240, dateOffset: 240, consistent: true, numberLocale: "en-US", dateLocale: "en-US" },
    mediaCaps: { supported: true, decode: { "h264-1080p": { supported: true, smooth: true, powerEfficient: true } }, rtcVideoCodecs: ["VP8", "VP9", "H264", "AV1"] },
    fingerprint: {
      fonts: ["Roboto", "Noto Color Emoji", "Cutive Mono", "Coming Soon", "Dancing Script"],
      voices: { count: 40, names: ["English United States"], localMicrosoft: 0, google: 0, apple: 0, defaultVoice: null },
    },
    environment: {
      battery: { supported: true, level: 0.73, charging: false, chargingTime: null, dischargingTime: 20000 },
      connection: { supported: true, type: "cellular", effectiveType: "4g", rtt: 100, downlink: 5, saveData: false },
      mediaDevicesPre: { videoinput: 1, audioinput: 1, audiooutput: 1, labelsVisible: false },
    },
  });
}

/** Chrome on a Windows PC in DevTools device mode emulating a Pixel 7. */
export function devtoolsPixel(): DeviceSignals {
  return device({
    navigator: {
      userAgent: PIXEL_UA,
      platform: "Win32",
      maxTouchPoints: 1,
      uaData: { brands: [{ brand: "Chromium", version: "141" }], mobile: true, platform: "Android", high: { model: "Pixel 7", architecture: "", formFactors: ["Desktop"] } },
    },
    screen: {
      width: 412,
      height: 915,
      dpr: 2.625,
      innerWidth: 412,
      innerHeight: 915,
      outerWidth: 1536,
      outerHeight: 864,
      orientationType: "portrait-primary",
      media: { pointerCoarse: true, hoverNone: true, anyPointerFine: false, anyHoverHover: false, portrait: true },
    },
    touch: { maxTouchPoints: 1, ontouchstart: true, touchEvent: true },
    hostOs: { systemUiFont: "Segoe UI", appleSystemFont: false, flagEmojiAsLetters: true, subpixelText: true },
  });
}

export function androidEmulator(): DeviceSignals {
  return device({
    navigator: {
      userAgent: PIXEL_UA,
      platform: "Linux x86_64",
      maxTouchPoints: 5,
      pdfViewerEnabled: false,
      pluginsCount: 0,
      uaData: {
        brands: [{ brand: "Chromium", version: "141" }],
        mobile: true,
        platform: "Android",
        high: { architecture: "x86", bitness: "64", model: "sdk_gphone64_x86_64", formFactors: ["Mobile"] },
      },
    },
    screen: {
      width: 412,
      height: 915,
      dpr: 2.625,
      innerWidth: 412,
      innerHeight: 800,
      outerWidth: 412,
      outerHeight: 860,
      orientationType: "portrait-primary",
      hasWindowOrientation: true,
      media: { pointerCoarse: true, hoverNone: true, anyPointerFine: false, anyHoverHover: false, portrait: true },
    },
    touch: { maxTouchPoints: 5, ontouchstart: true, touchEvent: true },
    webgl: {
      unmaskedRenderer: "Android Emulator OpenGL ES Translator (ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11))",
      extensions: ["WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_etc"],
    },
    webgpu: { supported: false, adapter: null },
    platformApis: { ...ANDROID_ONLY, ...Object.fromEntries(Object.keys(DESKTOP_ONLY).map((k) => [k, false])) },
    fingerprint: { fonts: ["Roboto", "Noto Color Emoji", "Cutive Mono", "Coming Soon"], voices: { count: 1, names: [], localMicrosoft: 0, google: 0, apple: 0, defaultVoice: null } },
    environment: { connection: { supported: true, type: "wifi" } },
  });
}

/** A Pixel with Chrome's "Desktop site" enabled: desktop UA, phone hardware. */
export function desktopModePixel(): DeviceSignals {
  const d = realPixel();
  d.navigator.userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  d.navigator.uaData = { ...d.navigator.uaData!, mobile: false };
  return d;
}

export function honestDesktop(): DeviceSignals {
  return device({ navigator: { userAgent: WIN_UA, platform: "Win32", uaData: { brands: [{ brand: "Chromium", version: "141" }], mobile: false, platform: "Windows", high: { platformVersion: "15.0.0" } } } });
}

/* -------------------------- Motion / interaction -------------------------- */

export function handheldMotion(seconds = 3, seed = 7, rounded = false): MotionSignals {
  const r = rng(seed);
  const motion: MotionSample[] = [];
  const orientation: OrientationSample[] = [];
  const q = (v: number) => (rounded ? Math.round(v * 10) / 10 : Math.round(v * 1e5) / 1e5);
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * 16.7;
    // Phone held upright-ish (beta ≈ 70°) with tremor.
    const beta = 70 + 2 * Math.sin(i / 23) + gauss(r) * 0.3;
    const gamma = -4 + 1.5 * Math.sin(i / 31) + gauss(r) * 0.3;
    const b = (beta * Math.PI) / 180;
    const g = (gamma * Math.PI) / 180;
    const G = 9.81;
    const gx = -G * Math.cos(b) * Math.sin(g) + gauss(r) * 0.03;
    const gy = G * Math.sin(b) + gauss(r) * 0.03;
    const gz = G * Math.cos(b) * Math.cos(g) + gauss(r) * 0.03;
    motion.push([Math.round(t), q(gauss(r) * 0.05), q(gauss(r) * 0.05), q(gauss(r) * 0.05), q(gx), q(gy), q(gz), q(gauss(r) * 2), q(gauss(r) * 2), q(gauss(r) * 2)]);
    orientation.push([Math.round(t), q(120 + gauss(r) * 0.2), q(beta), q(gamma), null]);
  }
  return {
    permission: "not-required",
    startedAt: 0,
    durationMs: seconds * 1000,
    motionEvents: motion.length,
    motionNullEvents: 0,
    motionInterval: 16,
    motion,
    orientationEvents: orientation.length,
    orientationNullEvents: 0,
    orientationAbsolute: false,
    orientation,
    absoluteOrientationEvents: 0,
    accelerometer: { state: "unsupported", readings: [] },
    gyroscope: { state: "unsupported", readings: [] },
  };
}

export function nullMotion(): MotionSignals {
  return { ...handheldMotion(0), motion: [], orientation: [], motionEvents: 1, motionNullEvents: 1, orientationEvents: 1, orientationNullEvents: 1 };
}

export function staticMotion(value: [number, number, number], n = 120): MotionSignals {
  const m = handheldMotion(0);
  m.motion = Array.from({ length: n }, (_, i): MotionSample => [i * 16, 0, 0, 0, value[0], value[1], value[2], 0, 0, 0]);
  m.motionEvents = n;
  return m;
}

export function fingerTaps(): InteractionSignals {
  const p = (type: string, t: number, w: number) => ({ type, pointerType: "touch", isTrusted: true, width: w, height: w * 1.1, pressure: 0.5, tiltX: 0, tiltY: 0, t, x: 200, y: 700, buttons: 1, target: "continue-device" });
  return {
    pointers: [p("pointerdown", 1000, 22.4), p("pointerup", 1090, 22.4), p("pointerdown", 5000, 25.1), p("pointerup", 5110, 25.1)],
    touches: [],
    clicks: [
      { t: 1095, isTrusted: true, detail: 1, pointerType: "touch", target: "continue-device", precededByPointerDown: true, holdMs: 90 },
      { t: 5115, isTrusted: true, detail: 1, pointerType: "touch", target: "continue-camera", precededByPointerDown: true, holdMs: 110 },
    ],
    counts: { hoverMouseMoves: 0, pointerMoves: 4, touchStarts: 2, wheel: 0, keys: 0 },
  };
}

export function mouseClicks(): InteractionSignals {
  const p = (type: string, t: number) => ({ type, pointerType: "mouse", isTrusted: true, width: 1, height: 1, pressure: 0.5, tiltX: 0, tiltY: 0, t, x: 200, y: 700, buttons: 1, target: null });
  return {
    pointers: [p("pointerdown", 1000), p("pointerup", 1080)],
    touches: [],
    clicks: [{ t: 1085, isTrusted: true, detail: 1, pointerType: "mouse", target: "continue-device", precededByPointerDown: true, holdMs: 80 }],
    counts: { hoverMouseMoves: 40, pointerMoves: 60, touchStarts: 0, wheel: 0, keys: 0 },
  };
}

/* -------------------------------- Camera -------------------------------- */

function metricsFlashResponsive(): { metrics: FrameMetric[]; schedule: { color: "red" | "green" | "blue"; start: number; end: number }[] } {
  const seq = ["red", "blue", "green", "red"] as const;
  const schedule = seq.map((color, i) => ({ color, start: 1000 + i * 250, end: 1000 + (i + 1) * 250 }));
  const r = rng(3);
  const metrics: FrameMetric[] = [];
  for (let i = 0; i < 30; i++) {
    const t = 1000 + i * 33.3;
    const c = schedule.find((s) => t - 80 >= s.start && t - 80 < s.end)?.color;
    const base = 100;
    metrics.push({
      t,
      meanY: 110,
      stdY: 40,
      r: base + (c === "red" ? 14 : 0) + gauss(r),
      g: base + (c === "green" ? 14 : 0) + gauss(r),
      b: base + (c === "blue" ? 14 : 0) + gauss(r),
      diff: 1.5,
      zeroDiff: 0.3,
      temporalSigma: 1.2,
      spatialSigma: 2.1,
      clipped: 0.01,
    });
  }
  return { metrics, schedule };
}

export function physicalCamera(kind: "ios" | "android"): CameraSignals {
  const { metrics, schedule } = metricsFlashResponsive();
  const frontLabel = kind === "ios" ? "Front Camera" : "camera2 1, facing front";
  const rearLabel = kind === "ios" ? "Back Triple Camera" : "camera2 0, facing back";
  const front: CameraCapture = {
    facing: "front",
    label: frontLabel,
    deviceId: "dev-front",
    groupId: "grp",
    trackConstructor: "MediaStreamTrack",
    contentHint: "",
    settings: { deviceId: "dev-front", facingMode: "user", width: 720, height: 1280, frameRate: 30 },
    capabilities: { facingMode: ["user"], width: { max: 1920 }, height: { max: 1920 }, focusMode: ["continuous"], exposureMode: ["continuous"], whiteBalanceMode: ["continuous"], zoom: { min: 1, max: 4 } },
    photoCapabilities: kind === "android" ? { imageWidth: { max: 4000 }, fillLightMode: ["off"] } : null,
    videoWidth: 720,
    videoHeight: 1280,
    timing: { openMs: 400, firstFrameMs: 120, captureMs: 1000, frames: 30, fps: 30.1, intervalMean: 33.2, intervalStd: 2.4, intervalCv: 0.07, dropped: 0, rvfc: true },
    metrics,
    aggregate: {
      frames: 30,
      duplicateRatio: 0,
      temporalNoise: 1.2,
      zeroDiffRatio: 0.31,
      spatialNoise: 2.1,
      blockiness: 1.03,
      entropy: 7.1,
      meanLuma: 110,
      lumaStd: 40,
      dark: false,
      uniform: false,
      noiseIntensityCorr: 0.8,
      noiseByIntensity: [
        { intensity: 48, sigma: 0.8 },
        { intensity: 112, sigma: 1.2 },
        { intensity: 176, sigma: 1.6 },
      ],
    },
    flash: analyzeFlash(metrics, ["red", "blue", "green", "red"], schedule),
    face: { available: true, framesAnalyzed: 4, framesWithFace: 4, maxFaces: 1, meanScore: 0.93, boxes: [], movement: 0.02 },
    trackStats: null,
    videoFrame: null,
  };
  const rear: CameraCapture = {
    ...front,
    facing: "rear",
    label: rearLabel,
    deviceId: "dev-rear",
    settings: { deviceId: "dev-rear", facingMode: "environment" },
    capabilities: { ...front.capabilities, facingMode: ["environment"], torch: true },
    photoCapabilities: kind === "android" ? { imageWidth: { max: 4080 }, fillLightMode: ["auto", "off", "flash"] } : null,
    flash: null,
    face: null,
  };
  return {
    supported: true,
    permission: "granted",
    devicesBefore: [],
    devicesAfter: [
      { kind: "videoinput", label: frontLabel, deviceId: "dev-front", groupId: "g1", facingMode: ["user"] },
      { kind: "videoinput", label: rearLabel, deviceId: "dev-rear", groupId: "g2", facingMode: ["environment"] },
      { kind: "videoinput", label: kind === "ios" ? "Back Ultra Wide Camera" : "camera2 2, facing back", deviceId: "dev-uw", groupId: "g3", facingMode: ["environment"] },
    ],
    getUserMediaNative: true,
    enumerateDevicesNative: true,
    front,
    rear,
    challengeSequence: ["red", "blue", "green", "red"],
  };
}

export function obsCamera(): CameraSignals {
  const c = physicalCamera("android");
  const f = c.front!;
  f.label = "OBS Virtual Camera";
  f.capabilities = { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 }, aspectRatio: {}, resizeMode: ["none"] };
  f.videoWidth = 1920;
  f.videoHeight = 1080;
  f.aggregate = { ...f.aggregate!, duplicateRatio: 0.9, temporalNoise: 0, zeroDiffRatio: 1, noiseIntensityCorr: null, noiseByIntensity: [] };
  f.metrics = f.metrics.map((m) => ({ ...m, r: 100, g: 100, b: 100 }));
  c.devicesAfter = [{ kind: "videoinput", label: "OBS Virtual Camera", deviceId: "dev-front", groupId: "g" }];
  c.rear = null;
  c.rearError = "No second camera enumerated";
  return c;
}

/** Noise-map tile statistics: "sensor" = live everywhere, "composite" = detailed regions frozen, "static" = still image. */
export function noiseMapFixture(kind: "sensor" | "composite" | "static"): NoiseMap {
  const r = rng(9);
  const tiles: NoiseTile[] = Array.from({ length: 24 }, (_, i) => {
    const pasted = kind === "static" || (kind === "composite" && [18, 19, 20].includes(i)); // bottom-left ID card
    const zero = pasted ? 1 : 0.25 + r() * 0.2;
    return { c: i % 6, r: Math.floor(i / 6), state: pasted ? "static" : "live", zero, sigma: pasted ? 0 : 1.2, luma: 90 + Math.round(r() * 80), texture: pasted ? 22 : 12 };
  });
  return { cols: 6, rows: 4, size: 24, pairs: 28, duplicatePairs: kind === "static" ? 0 : 1, live: 0, static: 0, staticTextured: 0, verdict: "sensor", tiles };
}

/**
 * OBS Virtual Camera renamed to an Android lens name ("camera2 1, facing front"), as an attacker
 * does with OBS / v4l2loopback card_label. "still": the scene is a photo of an ID card next to a
 * face; "relay": OBS relays the attacker's real webcam (real sensor noise, reflects the screen
 * flash, a real 3D head) with a doctored ID card pasted into the scene.
 */
export function obsRenamedAsPhone(kind: "still" | "relay"): CameraSignals {
  const c = physicalCamera("android");
  const f = c.front!;
  f.label = "camera2 1, facing front";
  f.settings = { deviceId: "dev-front", width: 1280, height: 720, frameRate: 30, aspectRatio: 1.7777, resizeMode: "none" };
  f.capabilities = { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 60 }, aspectRatio: {}, resizeMode: ["none", "crop-and-scale"] };
  f.photoCapabilities = null;
  f.videoWidth = 1280;
  f.videoHeight = 720;
  f.timing = { ...f.timing, intervalStd: 0.3, intervalCv: 0.009 };
  c.devicesAfter = [{ kind: "videoinput", label: "camera2 1, facing front", deviceId: "dev-front", groupId: "g" }];
  c.rear = null;
  c.rearError = "No second camera enumerated";
  f.face = { ...f.face!, maxFaces: 2 };
  if (kind === "still") {
    f.aggregate = { ...f.aggregate!, duplicateRatio: 1, temporalNoise: 0, zeroDiffRatio: 1, noiseIntensityCorr: null, noiseByIntensity: [] };
    f.metrics = f.metrics.map((m) => ({ ...m, r: 100, g: 100, b: 100, diff: 0, zeroDiff: 1, temporalSigma: 0 }));
    f.flash = analyzeFlash(f.metrics, ["red", "blue", "green", "red"], f.flash!.schedule);
    f.noiseMap = noiseMapFixture("static");
    c.active3d = { ...headTurn("flat"), others: [] };
  } else {
    f.noiseMap = noiseMapFixture("composite");
    const turn = headTurn("live", ["left", "right"]);
    // The pasted ID-card face: a third of the size, pixel-frozen, never turns.
    turn.others = turn.track.map((t) => [t.t, 0.2, 0.75, 0.1, 0.012]);
    c.active3d = turn;
  }
  return c;
}

export function bundle(device: DeviceSignals, extra: Partial<SignalBundle> = {}): SignalBundle {
  return { device, motion: null, interaction: null, camera: null, ...extra };
}

/* ------------------------------ 3D head turn ------------------------------ */

type P3 = { x: number; y: number; z: number };

/** MediaPipe FaceMesh face-oval landmark ids. */
const FACE_OVAL = new Set([10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]);

/**
 * Synthetic head in face-width units (+z towards the camera): anatomical anchors
 * for the landmarks the geometry uses, the rest scattered over a curved face
 * surface. flat = the same face printed on a card.
 */
export function syntheticHead(flat: boolean, seed = 1): P3[] {
  const r = rng(seed);
  const anchors: Record<number, P3> = {
    1: { x: 0, y: 0.05, z: 0.45 }, // nose tip
    2: { x: 0, y: 0.15, z: 0.35 }, // nose base
    10: { x: 0, y: -0.55, z: 0.2 }, // forehead top
    152: { x: 0, y: 0.6, z: 0.2 }, // chin
    234: { x: -0.5, y: 0, z: -0.05 }, // contour, subject's right
    454: { x: 0.5, y: 0, z: -0.05 }, // contour, subject's left
  };
  return KEY_LANDMARKS.map((id) => {
    let p = anchors[id];
    if (!p && FACE_OVAL.has(id)) {
      // Face outline: the sides sit far behind the nose, forehead and chin less so.
      const th = r() * 2 * Math.PI;
      p = { x: 0.5 * Math.cos(th), y: 0.6 * Math.sin(th), z: -0.05 + 0.25 * Math.abs(Math.sin(th)) };
    }
    if (!p) {
      const x = (r() - 0.5) * 0.7;
      const y = (r() - 0.5) * 0.9;
      p = { x, y, z: 0.35 * Math.sqrt(Math.max(0, 1 - (x / 0.45) ** 2)) };
    }
    return flat ? { ...p, z: 0 } : p;
  });
}

/** Rotate about the vertical axis (+yaw = towards the user's left) and project with a pinhole camera 3 face-widths away. */
export function headView(pts: P3[], yawDeg: number) {
  const a = (yawDeg * Math.PI) / 180;
  return pts.map((p) => {
    const x = p.x * Math.cos(a) + p.z * Math.sin(a);
    const z = -p.x * Math.sin(a) + p.z * Math.cos(a);
    const d = 3 - z;
    return { x: 0.5 + (0.35 * x) / d, y: 0.5 + (0.35 * p.y) / d };
  });
}

export const flattenPts = (pts: { x: number; y: number }[]) => pts.flatMap((p) => [p.x, p.y]);

/**
 * Recorded head-turn challenge. "live": a real head turning in the given order;
 * "flat": a photo tilted back and forth; "still": a photo held still (or a user who never turned).
 */
export function headTurn(kind: "live" | "flat" | "still", order: PoseDir[] = ["left", "right"], opts: { phoneRotationDeg?: number } = {}): Active3DSignals {
  const h = syntheticHead(kind === "flat", 3);
  const sign = order[0] === "left" ? 1 : -1;
  // Yaw (live) or card tilt (flat) per frame, degrees.
  const angles =
    kind === "live"
      ? [0, 6, 16, 24, 9, -9, -22, -6].map((v) => v * sign)
      : kind === "flat"
        ? [0, 0, 10, 20, 32, 20, 0, -10, -25, -32, 0, 0]
        : [0, 1, -1, 2, 0, 1, -2, 1];
  const start = 10_000;
  const views = angles.map((deg) => headView(h, deg));
  const geo = views.map((v) => frameGeometry(v)!);
  const rot = opts.phoneRotationDeg ?? 3;
  // Gyroscope at 60 Hz: the phone swings `rot` degrees about its vertical axis and back.
  const gyro = Array.from({ length: 150 }, (_, i) => {
    const t = start + i * 16.7;
    const rate = (rot * Math.PI * Math.cos((2 * Math.PI * i) / 150)) / 2.5; // ∫ over one period → ±rot/2 excursion
    return [t, 0, 0, Math.round(rate * 10000) / 10000];
  });
  const extreme = (pick: (a: number, b: number) => boolean) => views[angles.reduce((best, a, i) => (pick(a, angles[best]) ? i : best), 0)];
  return {
    status: kind === "live" ? "completed" : "timeout",
    frameAspect: 1,
    challenge: order,
    achieved: kind === "live" ? [...order] : [],
    window: { start, end: start + 2500 },
    frames: 75,
    track: geo.map((g, i) => ({ t: start + i * 300, nose: Math.round(g.nose * 10000) / 10000, yaw: angles[i], faceW: g.width, faceH: g.height, faces: 1 })),
    keyFrames: { frontal: flattenPts(views[0]), left: flattenPts(extreme((a, b) => a > b)), right: flattenPts(extreme((a, b) => a < b)) },
    samples: views.map(flattenPts),
    gyro,
  };
}
