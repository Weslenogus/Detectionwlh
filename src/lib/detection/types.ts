/**
 * Shared type definitions for every signal the detector collects and for the
 * report the scoring engine produces. Everything in here is plain JSON so the
 * same payload can be scored in the browser (preliminary verdict) and again on
 * the server (authoritative, signed verdict).
 */

/* ------------------------------------------------------------------------ */
/* Classification targets                                                    */
/* ------------------------------------------------------------------------ */

/** Hypotheses the device classifier weighs against each other. */
export type DeviceClass =
  | "phone" // physical smartphone
  | "tablet" // physical tablet (iPad, Android tablet)
  | "desktop" // honest desktop / laptop browser
  | "spoofed" // desktop pretending to be mobile (DevTools, UA spoofing, anti-detect)
  | "emulator" // Android emulator, iOS simulator, Android VM (BlueStacks, Genymotion...)
  | "automation"; // headless / scripted browser

export const DEVICE_CLASSES: DeviceClass[] = [
  "phone",
  "tablet",
  "desktop",
  "spoofed",
  "emulator",
  "automation",
];

/** Hypotheses the camera classifier weighs against each other. */
export type CameraClass =
  | "physical" // real image sensor
  | "virtual" // OS-level virtual camera (OBS, ManyCam, DroidCam...)
  | "injected" // JS-level stream replacement (canvas/video captureStream, hooked getUserMedia)
  | "synthetic"; // generated feed (emulator scene, Chromium fake device, test pattern)

export const CAMERA_CLASSES: CameraClass[] = ["physical", "virtual", "injected", "synthetic"];

/** Log-likelihood contributions keyed by hypothesis. Positive favours the class. */
export type Evidence<C extends string> = Partial<Record<C, number>>;

/* ------------------------------------------------------------------------ */
/* Raw signals                                                               */
/* ------------------------------------------------------------------------ */

export interface UADataSignals {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
  high: {
    architecture?: string;
    bitness?: string;
    model?: string;
    platformVersion?: string;
    uaFullVersion?: string;
    fullVersionList?: { brand: string; version: string }[];
    formFactors?: string[];
    wow64?: boolean;
  } | null;
  highError?: string;
}

export interface NavigatorSignals {
  userAgent: string;
  appVersion: string;
  platform: string;
  vendor: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxTouchPoints: number;
  cookieEnabled: boolean;
  doNotTrack: string | null;
  globalPrivacyControl: boolean | null;
  pdfViewerEnabled: boolean | null;
  webdriver: boolean | null;
  pluginsCount: number;
  pluginNames: string[];
  mimeTypesCount: number;
  uaData: UADataSignals | null;
  timezone: string;
  timezoneOffset: number;
  locale: string;
  jsHeapSizeLimit: number | null;
  isSecureContext: boolean;
  standalone: boolean | null;
  brave: boolean;
  /** Which engine the runtime *behaves* like, independent of what the UA claims. */
  engineFeatures: {
    blink: boolean;
    webkit: boolean;
    gecko: boolean;
    details: Record<string, boolean>;
  };
}

export interface ScreenSignals {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  dpr: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  orientationType: string | null;
  orientationAngle: number | null;
  windowOrientation: number | null;
  hasWindowOrientation: boolean;
  visualViewport: { width: number; height: number; scale: number } | null;
  safeArea: { top: number; right: number; bottom: number; left: number };
  media: Record<string, boolean>;
  refreshRate: number | null;
}

export interface TouchSignals {
  maxTouchPoints: number;
  ontouchstart: boolean;
  touchEvent: boolean;
  createTouchEvent: boolean;
  pointerEvent: boolean;
}

export interface PrecisionFormat {
  rangeMin: number;
  rangeMax: number;
  precision: number;
}

export interface WebGLSignals {
  supported: boolean;
  error?: string;
  vendor?: string;
  renderer?: string;
  unmaskedVendor?: string;
  unmaskedRenderer?: string;
  version?: string;
  shadingLanguageVersion?: string;
  maxTextureSize?: number;
  maxRenderbufferSize?: number;
  maxViewportDims?: number[];
  maxCombinedTextureImageUnits?: number;
  maxVertexAttribs?: number;
  maxVaryingVectors?: number;
  maxFragmentUniformVectors?: number;
  maxVertexUniformVectors?: number;
  aliasedLineWidthRange?: number[];
  aliasedPointSizeRange?: number[];
  maxAnisotropy?: number | null;
  extensions?: string[];
  precision?: {
    vertexHigh?: PrecisionFormat;
    vertexMedium?: PrecisionFormat;
    fragmentHigh?: PrecisionFormat;
    fragmentMedium?: PrecisionFormat;
    fragmentLow?: PrecisionFormat;
  };
  /** Mantissa bits measured by actually running a mediump shader on the GPU. */
  mediumpProbeBits?: number | null;
  renderHash?: string;
  webgl2?: boolean;
  maxSamples?: number | null;
}

export interface WebGPUSignals {
  supported: boolean;
  error?: string;
  adapter?: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    isFallbackAdapter: boolean | null;
    features: string[];
    limits: Record<string, number>;
  } | null;
}

export interface CpuSignals {
  /** Sign/payload of the default NaN produced by the FPU: x86 sets the sign bit, ARM doesn't. */
  nanArchJs: "x86" | "arm" | "unknown";
  nanBitsJs: string;
  nanArchWasm: "x86" | "arm" | "unknown";
  nanBitsWasm: string;
  benchmarkMs: number | null;
}

export interface IntegrityCheck {
  target: string;
  ok: boolean;
  reasons: string[];
  critical: boolean;
}

export interface CrossRealmSignals {
  ok: boolean;
  error?: string;
  userAgent?: string;
  platform?: string;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  maxTouchPoints?: number | null;
  languages?: string[];
  timezone?: string;
  webdriver?: boolean | null;
  uaMobile?: boolean | null;
  uaPlatform?: string | null;
  uaModel?: string | null;
  uaArchitecture?: string | null;
  gpuRenderer?: string | null;
  nanArch?: "x86" | "arm" | "unknown";
  screenWidth?: number | null;
  mismatches: string[];
}

export interface IntegritySignals {
  checks: IntegrityCheck[];
  toStringNative: boolean;
  navigatorOwnKeys: string[];
  screenOwnKeys: string[];
  iframe: CrossRealmSignals;
  worker: CrossRealmSignals;
  canvasStable: boolean | null;
  canvasPixelExact: boolean | null;
  audioStable: boolean | null;
}

export interface AutomationSignals {
  webdriver: boolean | null;
  headlessUA: boolean;
  headlessBrand: boolean;
  knownGlobals: string[];
  documentMarkers: string[];
  notificationInconsistent: boolean | null;
  outerDimensionsZero: boolean;
  chromeObject: boolean;
  chromeRuntime: boolean;
  languagesEmpty: boolean;
  cdpSerialization: boolean | null;
  stackMarkers: string[];
  permissionsQueryTampered: boolean;
}

export interface FingerprintSignals {
  canvasHash: string | null;
  webglHash: string | null;
  audioHash: string | null;
  audio: {
    sampleRate: number | null;
    baseLatency: number | null;
    outputLatency: number | null;
    maxChannelCount: number | null;
    state: string | null;
  };
  fonts: string[];
  voices: {
    count: number;
    names: string[];
    localMicrosoft: number;
    google: number;
    apple: number;
    defaultVoice: string | null;
  };
  emojiHash: string | null;
  mathHash: string | null;
  visitorId: string | null;
}

export interface EnvironmentSignals {
  battery: {
    supported: boolean;
    level?: number;
    charging?: boolean;
    chargingTime?: number | null;
    dischargingTime?: number | null;
  };
  connection: {
    supported: boolean;
    type?: string | null;
    effectiveType?: string | null;
    rtt?: number | null;
    downlink?: number | null;
    saveData?: boolean | null;
  };
  storageQuota: number | null;
  permissions: Record<string, string>;
  mediaDevicesPre: { videoinput: number; audioinput: number; audiooutput: number; labelsVisible: boolean } | null;
  webview: { androidWebView: boolean; iosWebView: boolean; inApp: string | null };
  hevcDecode: boolean | null;
}

/** Platform-exclusive API presence map (name → exposed?). */
export type PlatformApiSignals = Record<string, boolean>;

/* ---------------------------- Motion sensors ---------------------------- */

/** [t, ax, ay, az, gx, gy, gz, rAlpha, rBeta, rGamma] — accel w/o gravity, accel incl. gravity, rotation rate. */
export type MotionSample = [number, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
/** [t, alpha, beta, gamma, compassHeading] */
export type OrientationSample = [number, number | null, number | null, number | null, number | null];
/** [t, x, y, z] */
export type Vec3Sample = [number, number, number, number];

export interface GenericSensorSignals {
  state: "ok" | "error" | "unsupported" | "denied" | "timeout";
  error?: string;
  readings: Vec3Sample[];
}

export interface MotionSignals {
  permission: "granted" | "denied" | "not-required" | "unavailable" | "error" | "pending";
  permissionError?: string;
  startedAt: number;
  durationMs: number;
  motionEvents: number;
  motionNullEvents: number;
  motionInterval: number | null;
  motion: MotionSample[];
  orientationEvents: number;
  orientationNullEvents: number;
  orientationAbsolute: boolean | null;
  orientation: OrientationSample[];
  absoluteOrientationEvents: number;
  accelerometer: GenericSensorSignals;
  gyroscope: GenericSensorSignals;
}

/* ---------------------------- Interaction ------------------------------ */

export interface PointerRecord {
  type: string;
  pointerType: string;
  isTrusted: boolean;
  width: number;
  height: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  t: number;
  x: number;
  y: number;
  buttons: number;
  target: string | null;
}

export interface TouchRecord {
  type: string;
  isTrusted: boolean;
  radiusX: number | null;
  radiusY: number | null;
  force: number | null;
  rotationAngle: number | null;
  touchType: string | null;
  t: number;
  touches: number;
}

export interface ClickRecord {
  t: number;
  isTrusted: boolean;
  detail: number;
  pointerType: string | null;
  target: string | null;
  precededByPointerDown: boolean;
  holdMs: number | null;
}

export interface InteractionSignals {
  pointers: PointerRecord[];
  touches: TouchRecord[];
  clicks: ClickRecord[];
  counts: {
    hoverMouseMoves: number;
    pointerMoves: number;
    touchStarts: number;
    wheel: number;
    keys: number;
  };
}

/* ------------------------------- Camera -------------------------------- */

export interface MediaDeviceRecord {
  kind: string;
  label: string;
  deviceId: string; // hashed
  groupId: string; // hashed
  facingMode?: string[];
  capabilities?: Record<string, unknown> | null;
}

export interface FrameMetric {
  t: number;
  meanY: number;
  stdY: number;
  r: number;
  g: number;
  b: number;
  /** Mean abs difference vs previous frame (G channel, unclipped pixels). */
  diff: number | null;
  zeroDiff: number | null;
  temporalSigma: number | null;
  spatialSigma: number;
  clipped: number;
}

export interface FrameAggregate {
  frames: number;
  duplicateRatio: number;
  temporalNoise: number | null;
  zeroDiffRatio: number | null;
  spatialNoise: number;
  blockiness: number;
  entropy: number;
  meanLuma: number;
  lumaStd: number;
  dark: boolean;
  uniform: boolean;
  noiseIntensityCorr: number | null;
  noiseByIntensity: { intensity: number; sigma: number }[];
}

export interface FlashSegment {
  color: FlashColor;
  start: number;
  end: number;
}

export type FlashColor = "red" | "green" | "blue" | "white";

export interface FlashResponse {
  sequence: FlashColor[];
  schedule: FlashSegment[];
  correlation: number | null;
  lagMs: number | null;
  amplitude: number | null;
  perChannel: Record<string, number>;
  verdict: "responsive" | "weak" | "none" | "inconclusive";
}

export interface FaceSignals {
  available: boolean;
  error?: string;
  framesAnalyzed: number;
  framesWithFace: number;
  maxFaces: number;
  meanScore: number | null;
  boxes: { frame: number; x: number; y: number; w: number; h: number; score: number }[];
  movement: number | null;
}

export interface CameraCapture {
  facing: "front" | "rear";
  label: string;
  deviceId: string;
  groupId: string;
  trackConstructor: string;
  contentHint: string;
  settings: Record<string, unknown>;
  capabilities: Record<string, unknown> | null;
  photoCapabilities: Record<string, unknown> | null;
  photoError?: string;
  videoWidth: number;
  videoHeight: number;
  timing: {
    openMs: number;
    firstFrameMs: number | null;
    captureMs: number;
    frames: number;
    fps: number | null;
    intervalMean: number | null;
    intervalStd: number | null;
    intervalCv: number | null;
    dropped: number;
    rvfc: boolean;
  };
  metrics: FrameMetric[];
  aggregate: FrameAggregate | null;
  flash: FlashResponse | null;
  face: FaceSignals | null;
  trackStats: Record<string, number> | null;
  videoFrame: { format: string | null; colorSpace: Record<string, unknown> | null } | null;
}

export interface CameraSignals {
  supported: boolean;
  permission: "granted" | "denied" | "error" | "no-device" | "unsupported" | "skipped";
  error?: string;
  errorName?: string;
  devicesBefore: MediaDeviceRecord[];
  devicesAfter: MediaDeviceRecord[];
  getUserMediaNative: boolean;
  enumerateDevicesNative: boolean;
  front: CameraCapture | null;
  rear: CameraCapture | null;
  rearError?: string;
  challengeSequence: FlashColor[];
}

/* ---------------------------- Full payload ----------------------------- */

export interface DeviceSignals {
  version: number;
  collectedAt: number;
  durationMs: number;
  navigator: NavigatorSignals;
  screen: ScreenSignals;
  touch: TouchSignals;
  webgl: WebGLSignals;
  webgpu: WebGPUSignals;
  cpu: CpuSignals;
  platformApis: PlatformApiSignals;
  integrity: IntegritySignals;
  automation: AutomationSignals;
  fingerprint: FingerprintSignals;
  environment: EnvironmentSignals;
  errors: Record<string, string>;
  timings: Record<string, number>;
}

export interface ServerSignals {
  ip: string | null;
  ipVersion: 4 | 6 | null;
  privateIp: boolean;
  headers: Record<string, string>;
  headerOrder: string[];
  geo: { country?: string; region?: string; city?: string; timezone?: string } | null;
  tls: { ja4?: string; ja3?: string } | null;
  receivedAt: number;
}

export interface SignalBundle {
  device: DeviceSignals;
  motion: MotionSignals | null;
  interaction: InteractionSignals | null;
  camera: CameraSignals | null;
  server?: ServerSignals | null;
}

/* ------------------------------- Report -------------------------------- */

export type FindingStatus = "pass" | "warn" | "fail" | "info";

export type CategoryId =
  | "identity"
  | "hardware"
  | "graphics"
  | "sensors"
  | "touch"
  | "platform"
  | "integrity"
  | "automation"
  | "environment"
  | "camera"
  | "server";

export interface Finding {
  id: string;
  category: CategoryId;
  title: string;
  detail: string;
  status: FindingStatus;
  value?: string;
  evidence: Evidence<DeviceClass>;
  cameraEvidence?: Evidence<CameraClass>;
  /** Max absolute log-likelihood this finding moved (for sorting / UI emphasis). */
  weight: number;
}

export interface CategorySummary {
  id: CategoryId;
  title: string;
  description: string;
  findings: Finding[];
  /** P(phone) using only this category's evidence and uniform priors. */
  phoneLikelihood: number | null;
  status: FindingStatus;
}

export interface DeviceProfile {
  os: string;
  osVersion: string | null;
  browser: string;
  browserVersion: string | null;
  engine: string;
  claimedFormFactor: string;
  model: string | null;
  modelSource: string | null;
  vendor: string | null;
  gpu: string | null;
  gpuClass: string;
  cpuArch: string;
  cores: number | null;
  memoryGb: number | null;
  screen: string;
  webview: string | null;
}

export type Decision = "approve" | "review" | "decline";

export interface Report {
  id: string;
  version: number;
  createdAt: number;
  source: "client" | "server";
  decision: Decision;
  headline: string;
  summary: string;
  deviceClass: DeviceClass;
  deviceConfidence: number;
  probabilities: Record<DeviceClass, number>;
  isRealPhone: boolean;
  riskScore: number;
  camera: {
    tested: boolean;
    cameraClass: CameraClass | null;
    confidence: number | null;
    probabilities: Record<CameraClass, number> | null;
    headline: string;
    liveness: FlashResponse["verdict"] | null;
  };
  profile: DeviceProfile;
  categories: CategorySummary[];
  flags: string[];
  stats: { findings: number; pass: number; warn: number; fail: number; info: number; signals: number };
  signature?: { alg: string; token: string; keyId: string; expiresAt: number };
}
