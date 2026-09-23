/**
 * Scoring engine.
 *
 * Every rule emits findings carrying log-likelihood contributions for six
 * competing hypotheses (phone, tablet, desktop, spoofed, emulator, automation).
 * Contributions are summed per category and clamped (signals within a category
 * are correlated, so one category cannot dominate), added to log-priors and
 * normalised with softmax — a naive-Bayes posterior with correlation damping.
 * A second, independent classifier does the same for the camera.
 */
import { errorMessage } from "../util/safe";
import { clamp, softmax } from "../util/stats";
import type {
  CameraClass,
  CategoryId,
  CategorySummary,
  Decision,
  DeviceClass,
  DeviceProfile,
  Finding,
  FindingStatus,
  Report,
  SignalBundle,
} from "../types";
import { CAMERA_CLASSES, DEVICE_CLASSES } from "../types";
import { buildContext, makeCollector, type Add, type Ctx } from "./context";
import { buildProfile, deviceName } from "./profile";
import { automationRules } from "./rules/automation";
import { cameraRules } from "./rules/camera";
import { environmentRules } from "./rules/environment";
import { graphicsRules } from "./rules/graphics";
import { hardwareRules } from "./rules/hardware";
import { identityRules } from "./rules/identity";
import { integrityRules } from "./rules/integrity";
import { platformRules } from "./rules/platform";
import { sensorRules } from "./rules/sensors";
import { serverRules } from "./rules/server";
import { touchRules } from "./rules/touch";

export const ENGINE_VERSION = 1;

export const CATEGORY_META: Record<CategoryId, { title: string; description: string }> = {
  identity: { title: "Identity claims", description: "User-Agent, Client Hints, platform and engine consistency" },
  hardware: { title: "Hardware", description: "CPU architecture, display geometry, cutouts, cores, battery" },
  graphics: { title: "Graphics pipeline", description: "GPU family, shader precision, texture formats, WebGPU" },
  sensors: { title: "Motion sensors", description: "Accelerometer noise, gravity, orientation physics" },
  touch: { title: "Touch & interaction", description: "Digitizer, pointer media, tap contact physics" },
  platform: { title: "Platform APIs", description: "APIs compiled only into Android, iOS or desktop builds" },
  integrity: { title: "Tamper resistance", description: "Native-code verification, iframe & worker cross-checks" },
  automation: { title: "Automation", description: "WebDriver, headless, CDP and stealth-plugin artefacts" },
  environment: { title: "Host environment", description: "Fonts, voices, network link, media hardware" },
  camera: { title: "Camera", description: "Provenance, hardware controls, pixel forensics, liveness" },
  server: { title: "Network layer", description: "HTTP headers vs JavaScript, IP geolocation" },
};

const RULES: [CategoryId, (c: Ctx, add: Add) => void][] = [
  ["identity", identityRules],
  ["hardware", hardwareRules],
  ["graphics", graphicsRules],
  ["sensors", sensorRules],
  ["touch", touchRules],
  ["platform", platformRules],
  ["integrity", integrityRules],
  ["automation", automationRules],
  ["environment", environmentRules],
  ["camera", cameraRules],
  ["server", serverRules],
];

const DEVICE_PRIOR: Record<DeviceClass, number> = {
  phone: 0.35,
  tablet: 0.1,
  desktop: 0.3,
  spoofed: 0.12,
  emulator: 0.06,
  automation: 0.07,
};
const CAMERA_PRIOR: Record<CameraClass, number> = { physical: 0.7, virtual: 0.1, injected: 0.07, synthetic: 0.13 };

/** Max |log-odds| any single category may contribute per hypothesis. */
const CATEGORY_CAP = 6;
const CAMERA_CAP = 9;

function sumEvidence<C extends string>(classes: C[], findings: Finding[], pick: (f: Finding) => Partial<Record<C, number>> | undefined, cap: number) {
  const out = Object.fromEntries(classes.map((k) => [k, 0])) as Record<C, number>;
  for (const f of findings) {
    const e = pick(f);
    if (!e) continue;
    for (const k of classes) out[k] += e[k] ?? 0;
  }
  for (const k of classes) out[k] = clamp(out[k], -cap, cap);
  return out;
}

const DEVICE_HEADLINE: Record<DeviceClass, string> = {
  phone: "Genuine physical smartphone",
  tablet: "Physical tablet",
  desktop: "Desktop or laptop browser",
  spoofed: "Desktop browser impersonating a phone",
  emulator: "Emulator or virtualised device",
  automation: "Automated / headless browser",
};

const CAMERA_HEADLINE: Record<CameraClass, string> = {
  physical: "Physical camera sensor",
  virtual: "Virtual camera software",
  injected: "Injected video stream",
  synthetic: "Synthetic / emulated camera feed",
};

function worstStatus(fs: Finding[]): FindingStatus {
  if (fs.some((f) => f.status === "fail")) return "fail";
  if (fs.some((f) => f.status === "warn")) return "warn";
  if (fs.some((f) => f.status === "pass")) return "pass";
  return "info";
}

export interface EvaluateOptions {
  source: "client" | "server";
  id?: string;
  now?: number;
}

export function evaluate(bundle: SignalBundle, opts: EvaluateOptions): Report {
  const ctx = buildContext(bundle);
  const findings: Finding[] = [];
  for (const [cat, rule] of RULES) {
    const add = makeCollector(cat, findings);
    try {
      rule(ctx, add);
    } catch (e) {
      add({ id: `${cat}.rule-error`, title: "Rule error", value: "skipped", detail: errorMessage(e), status: "info" });
    }
  }

  /* ----------------------------- Device posterior ----------------------------- */
  const logits = Object.fromEntries(DEVICE_CLASSES.map((k) => [k, Math.log(DEVICE_PRIOR[k])])) as Record<DeviceClass, number>;
  const categories: CategorySummary[] = [];
  for (const [cat] of RULES) {
    const fs = findings.filter((f) => f.category === cat);
    if (!fs.length) continue;
    const sums = sumEvidence(DEVICE_CLASSES, fs, (f) => f.evidence, CATEGORY_CAP);
    for (const k of DEVICE_CLASSES) logits[k] += sums[k];
    const hasEvidence = fs.some((f) => Object.values(f.evidence).some((v) => v));
    const local = softmax(sums);
    categories.push({
      id: cat,
      title: CATEGORY_META[cat].title,
      description: CATEGORY_META[cat].description,
      findings: [...fs].sort((a, b) => b.weight - a.weight),
      phoneLikelihood: hasEvidence ? local.phone : null,
      status: worstStatus(fs),
    });
  }
  const probabilities = softmax(logits);
  const deviceClass = DEVICE_CLASSES.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
  const deviceConfidence = probabilities[deviceClass];

  /* ----------------------------- Camera posterior ----------------------------- */
  const camTested = Boolean(bundle.camera?.front);
  let cameraClass: CameraClass | null = null;
  let camProbs: Record<CameraClass, number> | null = null;
  if (camTested) {
    const camFindings = findings.filter((f) => f.cameraEvidence);
    const camSums = sumEvidence(CAMERA_CLASSES, camFindings, (f) => f.cameraEvidence, CAMERA_CAP);
    const camLogits = Object.fromEntries(CAMERA_CLASSES.map((k) => [k, Math.log(CAMERA_PRIOR[k]) + camSums[k]])) as Record<CameraClass, number>;
    camProbs = softmax(camLogits);
    cameraClass = CAMERA_CLASSES.reduce((a, b) => (camProbs![b] > camProbs![a] ? b : a));
  }
  const camConf = cameraClass && camProbs ? camProbs[cameraClass] : null;
  const liveness = bundle.camera?.front?.flash?.verdict ?? null;
  const camPerm = bundle.camera?.permission;

  /* --------------------------------- Decision -------------------------------- */
  const pPhone = probabilities.phone;
  const isRealPhone = deviceClass === "phone" && pPhone >= 0.8;
  const cameraBad = camTested && cameraClass !== "physical" && (camConf ?? 0) >= 0.75;
  const hardFail = probabilities.automation >= 0.5 || probabilities.spoofed >= 0.6 || probabilities.emulator >= 0.6 || cameraBad;
  const camOk = camTested ? cameraClass === "physical" && (camConf ?? 0) >= 0.7 : !bundle.camera;
  let decision: Decision = "review";
  if (isRealPhone && pPhone >= 0.85 && camOk && !hardFail) decision = "approve";
  else if (hardFail || pPhone < 0.2) decision = "decline";

  const camFactor = camTested ? camProbs!.physical : bundle.camera ? 0.5 : 0.85;
  const riskScore = Math.round(clamp(100 * (1 - pPhone * camFactor), 0, 100));

  const flags = findings
    .filter((f) => f.status === "fail" && (f.weight >= 2 || (f.cameraEvidence && Object.values(f.cameraEvidence).some((v) => (v ?? 0) >= 2))))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map((f) => f.title + (f.value ? `: ${f.value}` : ""));

  const cameraHeadline = camTested
    ? `${CAMERA_HEADLINE[cameraClass!]}${cameraClass === "physical" && liveness === "responsive" ? " · live reflection confirmed" : ""}`
    : camPerm === "denied"
      ? "Camera access denied"
      : camPerm === "no-device"
        ? "No camera available"
        : bundle.camera
          ? "Camera test failed"
          : "Camera not tested yet";

  let profile: DeviceProfile;
  try {
    profile = buildProfile(ctx);
  } catch {
    profile = {
      os: ctx.ua.os,
      osVersion: ctx.ua.osVersion,
      browser: ctx.ua.browser,
      browserVersion: ctx.ua.browserVersion,
      engine: ctx.ua.engine,
      claimedFormFactor: ctx.ua.claimedForm,
      model: null,
      modelSource: null,
      vendor: null,
      gpu: null,
      gpuClass: ctx.gpu.class,
      cpuArch: ctx.cpuArch,
      cores: null,
      memoryGb: null,
      screen: "unknown",
      webview: null,
    };
  }
  const pct = (v: number) => `${Math.min(99.9, Math.round(v * 1000) / 10)}%`;
  const deviceLine = deviceName(profile);
  const genuine = deviceClass === "phone" || deviceClass === "tablet" || deviceClass === "desktop";
  const summary =
    `${DEVICE_HEADLINE[deviceClass]} (${pct(deviceConfidence)} posterior). ` +
    `${deviceLine ? `${genuine ? "Identified as" : "Presents itself as"} ${deviceLine}` : `Claims ${profile.os}`} running ${profile.browser}` +
    `${profile.gpu ? ` on ${profile.gpu}` : ""} (${profile.cpuArch}). ` +
    `Camera: ${cameraHeadline}.`;

  const stats = {
    findings: findings.length,
    pass: findings.filter((f) => f.status === "pass").length,
    warn: findings.filter((f) => f.status === "warn").length,
    fail: findings.filter((f) => f.status === "fail").length,
    info: findings.filter((f) => f.status === "info").length,
    signals: countSignals(bundle),
  };

  return {
    id: opts.id ?? `rep_${Math.random().toString(36).slice(2, 10)}`,
    version: ENGINE_VERSION,
    createdAt: opts.now ?? Date.now(),
    source: opts.source,
    decision,
    headline: DEVICE_HEADLINE[deviceClass],
    summary,
    deviceClass,
    deviceConfidence,
    probabilities,
    isRealPhone,
    riskScore,
    camera: {
      tested: camTested,
      cameraClass,
      confidence: camConf,
      probabilities: camProbs,
      headline: cameraHeadline,
      liveness,
    },
    profile,
    categories,
    flags,
    stats,
  };
}

/** Number of primitive values collected — shown in the report header. */
function countSignals(x: unknown, depth = 0): number {
  if (depth > 8 || x === null || x === undefined) return 0;
  if (Array.isArray(x)) return x.reduce((n: number, v) => n + countSignals(v, depth + 1), 0);
  if (typeof x === "object") return Object.values(x as Record<string, unknown>).reduce((n: number, v) => n + countSignals(v, depth + 1), 0);
  return 1;
}

export { DEVICE_HEADLINE, CAMERA_HEADLINE };
