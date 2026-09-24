import "server-only";
import { z } from "zod";

/**
 * Structural validation of the untrusted payload. It bounds sizes and pins the
 * types the engine relies on; deeper objects stay loose because the engine is
 * defensive (every rule is isolated) and new browser fields appear constantly.
 */
const str = (max = 512) => z.string().max(max);
const n = z.number();
const nn = n.nullable();
const loose = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

const precision = loose({ rangeMin: n, rangeMax: n, precision: n }).optional();

const navigatorSchema = loose({
  userAgent: str(1024),
  platform: str(128),
  vendor: str(128),
  language: str(64),
  languages: z.array(str(64)).max(32),
  hardwareConcurrency: nn,
  deviceMemory: nn,
  maxTouchPoints: n,
  pluginsCount: n,
  pdfViewerEnabled: z.boolean().nullable(),
  webdriver: z.boolean().nullable(),
  timezone: str(128),
  timezoneOffset: n,
  brave: z.boolean(),
  uaData: loose({
    brands: z.array(loose({ brand: str(128), version: str(64) })).max(16),
    mobile: z.boolean(),
    platform: str(64),
    high: loose({}).nullable(),
  }).nullable(),
  engineFeatures: loose({ blink: z.boolean(), webkit: z.boolean(), gecko: z.boolean() }),
});

const screenSchema = loose({
  width: n,
  height: n,
  dpr: n,
  outerWidth: n,
  outerHeight: n,
  innerWidth: n,
  innerHeight: n,
  safeArea: loose({ top: n, right: n, bottom: n, left: n }),
  media: z.record(str(64), z.boolean()),
  orientationType: str(64).nullable(),
});

const webglSchema = loose({
  supported: z.boolean(),
  renderer: str(512).optional(),
  unmaskedRenderer: str(512).optional(),
  extensions: z.array(str(128)).max(128).optional(),
  precision: loose({ fragmentMedium: precision }).optional(),
  mediumpProbeBits: nn.optional(),
});

const deviceSchema = loose({
  version: n,
  navigator: navigatorSchema,
  screen: screenSchema,
  touch: loose({ maxTouchPoints: n }),
  webgl: webglSchema,
  webgpu: loose({ supported: z.boolean() }),
  cpu: loose({ nanArchJs: z.enum(["x86", "arm", "unknown"]), nanArchWasm: z.enum(["x86", "arm", "unknown"]) }),
  platformApis: z.record(str(64), z.boolean()),
  integrity: loose({
    checks: z.array(loose({ target: str(128), ok: z.boolean(), reasons: z.array(str(256)).max(12), critical: z.boolean() })).max(80),
    iframe: loose({ ok: z.boolean(), mismatches: z.array(str(64)).max(20) }),
    worker: loose({ ok: z.boolean(), mismatches: z.array(str(64)).max(20) }),
  }),
  automation: loose({ knownGlobals: z.array(str(128)).max(64), documentMarkers: z.array(str(128)).max(64) }),
  fingerprint: loose({ fonts: z.array(str(64)).max(128) }),
  environment: loose({ battery: loose({ supported: z.boolean() }), connection: loose({ supported: z.boolean() }) }),
  hostOs: loose({ systemUiFont: str(64).nullable() }).optional(),
  timezone: loose({ zone: str(128), consistent: z.boolean().nullable() }).optional(),
  mediaCaps: loose({ supported: z.boolean(), rtcVideoCodecs: z.array(str(64)).max(32) }).optional(),
  webrtc: loose({ supported: z.boolean(), srflxIps: z.array(str(64)).max(8), candidateTypes: z.array(str(16)).max(8) }).optional(),
  privacy: loose({ incognito: z.boolean().nullable() }).optional(),
  botd: loose({ bot: z.boolean().nullable(), kind: str(64).nullable() }).optional(),
  fpjs: loose({ visitorId: str(64).nullable() }).optional(),
});

const numOrNull = z.number().nullable();
const motionSchema = loose({
  permission: str(32),
  motion: z.array(z.array(numOrNull).length(10)).max(1000),
  orientation: z.array(z.array(numOrNull).length(5)).max(1000),
  motionEvents: n,
  motionNullEvents: n,
  orientationEvents: n,
  orientationNullEvents: n,
  accelerometer: loose({ state: str(16), readings: z.array(z.array(n).length(4)).max(1000) }),
  gyroscope: loose({ state: str(16), readings: z.array(z.array(n).length(4)).max(1000) }),
}).nullable();

const interactionSchema = loose({
  pointers: z.array(loose({ type: str(32), pointerType: str(16), isTrusted: z.boolean() })).max(400),
  touches: z.array(loose({ type: str(32), isTrusted: z.boolean() })).max(400),
  clicks: z.array(loose({ isTrusted: z.boolean(), precededByPointerDown: z.boolean() })).max(400),
  counts: z.record(str(32), n),
  behavior: loose({ marks: z.record(str(64), n), hiddenCount: n, pastes: n }).optional(),
}).nullable();

const captureSchema = loose({
  label: str(256),
  trackConstructor: str(64),
  settings: z.record(str(64), z.unknown()),
  metrics: z.array(loose({ t: n, r: n, g: n, b: n })).max(240),
  timing: loose({ frames: n, captureMs: n }),
  // Only the timing of the flash schedule is used; colours and verdict are re-derived server-side.
  flash: loose({ schedule: z.array(loose({ start: n, end: n })).max(8) }).nullable().optional(),
}).nullable();

const keyFrame = z.array(n).max(256).nullable();
const active3dSchema = loose({
  status: z.enum(["completed", "timeout", "no-face", "unavailable", "error", "skipped"]),
  frameAspect: n.optional(),
  challenge: z.array(z.enum(["left", "right"])).max(4),
  achieved: z.array(z.enum(["left", "right"])).max(4),
  window: loose({ start: n, end: n }).nullable(),
  frames: n,
  track: z.array(loose({ t: n, nose: n, yaw: nn, faceW: n, faces: n })).max(200),
  samples: z.array(z.array(n).max(256)).max(48).optional(),
  keyFrames: loose({ frontal: keyFrame, left: keyFrame, right: keyFrame }),
  gyro: z.array(z.array(n).length(4)).max(320).optional(),
})
  .nullable()
  .optional();

const cameraSchema = loose({
  supported: z.boolean(),
  permission: str(32),
  devicesBefore: z.array(loose({ kind: str(32), label: str(256) })).max(48),
  devicesAfter: z.array(loose({ kind: str(32), label: str(256) })).max(48),
  getUserMediaNative: z.boolean(),
  enumerateDevicesNative: z.boolean(),
  front: captureSchema,
  rear: captureSchema,
  challengeSequence: z.array(z.enum(["red", "green", "blue", "white"])).max(8),
  active3d: active3dSchema,
}).nullable();

const locationSchema = loose({
  state: z.enum(["granted", "denied", "unavailable", "timeout", "error", "skipped"]),
  accuracy: nn.optional(),
  lat: nn.optional(),
  lon: nn.optional(),
}).nullable();

const clientSchema = loose({
  storageId: str(64).nullable(),
  runs: n,
  firstSeenAt: nn,
  sentAt: n,
}).nullable();

export const analyzeRequestSchema = z.object({
  sessionToken: str(4096),
  bundle: z.object({
    client: clientSchema.optional(),
    location: locationSchema.optional(),
    device: deviceSchema,
    motion: motionSchema,
    interaction: interactionSchema,
    camera: cameraSchema,
  }),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const MAX_BODY_BYTES = 1_500_000;
