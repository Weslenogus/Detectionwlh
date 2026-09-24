// End-to-end attack scenarios: drives Chromium through the full flow
// (scan → Continue → 1 s camera test → Continue → report) and asserts that
// none of these non-phone setups is approved as a real phone.
//
//   npm run test:e2e                 # starts `next dev` on a free port
//   BASE_URL=https://... npm run test:e2e
//   CHROMIUM_PATH=/path/to/chrome npm run test:e2e
//   FACE_CLIPS=test-results/face-clips npm run test:e2e   # + 3D head-turn scenarios (see e2e/face-clips.mjs)
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });

const FAKE_CAMERA = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
const FACE_CLIPS = process.env.FACE_CLIPS;
const clip = (name) => [...FAKE_CAMERA, `--use-file-for-fake-video-capture=${join(FACE_CLIPS ?? "", name)}`];

const hideWebdriver = () => {
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
};

const SCENARIOS = [
  {
    name: "headless-desktop",
    about: "Stock headless Chromium with the fake camera",
    args: FAKE_CAMERA,
    context: { viewport: { width: 1280, height: 800 } },
    expect: { notDecision: "approve", notClass: "phone", cameraNot: "physical" },
  },
  {
    name: "devtools-pixel7",
    about: "Desktop Chromium emulating a Pixel 7 (UA, viewport, DPR, touch) — what DevTools device mode does",
    args: FAKE_CAMERA,
    // DevTools/Playwright location overrides report an impossible 0 m accuracy.
    context: { ...devices["Pixel 7"], geolocation: { latitude: 43.65, longitude: -79.38 } },
    grant: ["geolocation"],
    expect: { notDecision: "approve", notClass: "phone" },
  },
  {
    name: "stealth-iphone",
    about: "iPhone emulation with the automation flag hidden and the headless UA token removed",
    args: [...FAKE_CAMERA, "--disable-blink-features=AutomationControlled"],
    context: { ...devices["iPhone 15 Pro"] },
    init: hideWebdriver,
    expect: { notDecision: "approve", notClass: "phone", flagsInclude: /Native API integrity|engine|vendor|Desktop-only|CPU/i },
  },
  {
    name: "injected-canvas-stream",
    about: "Android emulation + getUserMedia hooked to return a canvas.captureStream() (camera injection kit)",
    args: ["--disable-blink-features=AutomationControlled"],
    context: { ...devices["Galaxy S9+"] },
    init: () => {
      const orig = MediaDevices.prototype.getUserMedia;
      MediaDevices.prototype.getUserMedia = async function (c) {
        if (!c?.video) return orig.call(this, c);
        const cv = document.createElement("canvas");
        cv.width = 640;
        cv.height = 480;
        const ctx = cv.getContext("2d");
        let i = 0;
        setInterval(() => {
          ctx.fillStyle = `hsl(${(i++ * 7) % 360},60%,50%)`;
          ctx.fillRect(0, 0, 640, 480);
        }, 33);
        return cv.captureStream(30);
      };
    },
    expect: { notDecision: "approve", notClass: "phone", cameraNot: "physical" },
  },
  // 3D head-turn liveness, fed with clips rendered by e2e/face-clips.mjs.
  ...(FACE_CLIPS
    ? [
        {
          name: "photo-tilt",
          about: "A portrait photo tilted ±35° in front of the camera (print / screen presentation attack)",
          args: clip("flat.mjpeg"),
          context: { ...devices["Pixel 7"] },
          expect: { notDecision: "approve", depth: "flat" },
        },
        {
          name: "obs-still-id",
          about: "OBS Virtual Camera renamed \"camera2 1, facing front\" + Pixel 7 emulation (webdriver hidden): still image of a face and a doctored ID card",
          args: [...clip("id-still.mjpeg"), "--disable-blink-features=AutomationControlled"],
          context: { ...devices["Pixel 7"] },
          init: hideWebdriver,
          renameCamera: "camera2 1, facing front",
          expect: {
            notDecision: "approve",
            cameraNot: "physical",
            findings: { "camera.label-driver": "fail", "camera.noise-map": /^frozen/ },
          },
        },
        {
          name: "obs-relay-id",
          about: "Renamed OBS camera relaying a live 3D face (with sensor noise) and a doctored ID card pasted into the scene",
          args: [...clip("id-relay.mjpeg"), "--disable-blink-features=AutomationControlled"],
          context: { ...devices["Pixel 7"] },
          init: hideWebdriver,
          renameCamera: "camera2 1, facing front",
          expect: {
            notDecision: "approve",
            cameraNot: "physical",
            findings: { "camera.label-driver": "fail", "camera.noise-map": /^composited/, "camera.second-face": "fail" },
          },
        },
        {
          name: "face-mesh-3d",
          about: "A textured 3D face mesh turning right then left: must read as 3D geometry, never flat",
          args: clip("mesh-rl.mjpeg"),
          context: { ...devices["Pixel 7"] },
          expect: { notDecision: "approve", depthNot: "flat", minDepthSlope: 0.08 },
        },
      ]
    : []),
];

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(url, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${url}`);
}

async function runScenario(browserPath, base, sc) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: sc.args });
  const context = await browser.newContext({ ...sc.context, permissions: ["camera", ...(sc.grant ?? [])] });
  if (sc.init) await context.addInitScript(sc.init);
  const page = await context.newPage();
  if (sc.renameCamera) {
    // OS-level rename (OBS / v4l2loopback card_label): the label is just a string the driver
    // reports, so rewriting it in the submitted signals is exactly what the server would receive.
    await page.route("**/api/analyze", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const cam = body.bundle?.camera;
      const old = cam?.front?.label;
      if (old) {
        const swap = (v) => (typeof v === "string" && v === old ? sc.renameCamera : Array.isArray(v) ? v.map(swap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
        body.bundle = swap(body.bundle);
      }
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
  const logs = [];
  page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const tap = async (sel) => {
    const el = page.locator(sel);
    await el.waitFor({ state: "visible", timeout: 60_000 });
    if (sc.context.hasTouch) await el.tap();
    else await el.click();
  };
  await tap('[data-track="continue-device"]');
  await page.screenshot({ path: join(OUT, `${sc.name}-1-camera.png`) }).catch(() => undefined);
  const analyze = page.waitForResponse((r) => r.url().includes("/api/analyze"), { timeout: 90_000 });
  await tap('[data-track="continue-camera"]');
  const res = await analyze;
  const body = await res.json();
  await page.getByText("Probability this is a real phone").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(OUT, `${sc.name}-2-report.png`), fullPage: true });
  await browser.close();
  return { body, ms: Date.now() - t0, logs };
}

function check(sc, report) {
  const errs = [];
  const e = sc.expect;
  if (!report) return ["no report returned"];
  if (e.notDecision && report.decision === e.notDecision) errs.push(`decision must not be ${e.notDecision}`);
  if (e.notClass && report.deviceClass === e.notClass) errs.push(`device class must not be ${e.notClass}`);
  if (e.cameraNot && report.camera.cameraClass === e.cameraNot) errs.push(`camera class must not be ${e.cameraNot}`);
  if (e.flagsInclude && !report.flags.some((f) => e.flagsInclude.test(f))) errs.push(`flags should include ${e.flagsInclude}`);
  const all = report.categories.flatMap((c) => c.findings);
  for (const [id, want] of Object.entries(e.findings ?? {})) {
    const f = all.find((x) => x.id === id);
    const ok = f && (want instanceof RegExp ? want.test(f.value) : f.status === want);
    if (!ok) errs.push(`${id} should be ${want}, got ${f ? `${f.status}: ${f.value}` : "missing"}`);
  }
  const depth = report.camera.depth;
  if (e.depth && depth?.verdict !== e.depth) errs.push(`3D verdict should be ${e.depth}, got ${depth?.verdict}`);
  if (e.depthNot && depth?.verdict === e.depthNot) errs.push(`3D verdict must not be ${e.depthNot}`);
  if (e.minDepthSlope && !((depth?.depthSlope ?? 0) >= e.minDepthSlope)) errs.push(`depth slope should be ≥ ${e.minDepthSlope}, got ${depth?.depthSlope}`);
  if (!report.signature?.token) errs.push("report is not server-signed");
  return errs;
}

const browserPath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
let base = process.env.BASE_URL;
let server = null;
if (!base) {
  const port = await freePort();
  base = `http://localhost:${port}`;
  // Own process group so the whole Next.js tree can be torn down afterwards.
  server = spawn(join("node_modules", ".bin", "next"), ["dev", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", DETECTION_SECRET: process.env.DETECTION_SECRET ?? randomBytes(32).toString("hex") },
  });
  server.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  server.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  await waitFor(base);
}

let failed = 0;
const only = process.argv[2]?.split(",");
try {
  for (const sc of SCENARIOS.filter((s) => !only || only.includes(s.name))) {
    process.stdout.write(`\n▶ ${sc.name} — ${sc.about}\n`);
    try {
      const { body, ms, logs } = await runScenario(browserPath, base, sc);
      const r = body.report;
      writeFileSync(join(OUT, `${sc.name}.json`), JSON.stringify(body, null, 2));
      const probs = Object.entries(r.probabilities)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`)
        .join(" · ");
      console.log(`  decision=${r.decision} class=${r.deviceClass} risk=${r.riskScore} (${ms} ms)`);
      console.log(`  ${probs}`);
      console.log(`  camera=${r.camera.cameraClass} ${r.camera.confidence ? (r.camera.confidence * 100).toFixed(1) + "%" : ""} liveness=${r.camera.liveness}`);
      const d = r.camera.depth;
      if (d) console.log(`  3D=${d.verdict} reached=${d.reached.join("→") || "—"} parallax=${d.parallax} slope=${d.depthSlope} tilt=${d.tilt}${d.secondFace ? ` second-face=${JSON.stringify(d.secondFace)}` : ""}`);
      for (const f of r.categories.flatMap((c) => c.findings).filter((f) => /^camera\.(label|label-driver|noise-map|second-face|depth)$/.test(f.id)))
        console.log(`  · ${f.id} [${f.status}] ${f.value}`);
      for (const f of r.flags) console.log(`  ⚑ ${f}`);
      if (logs.length) console.log(`  console errors: ${logs.slice(0, 3).join(" | ")}`);
      const errs = check(sc, r);
      if (errs.length) {
        failed++;
        console.log(`  ✗ ${errs.join("; ")}`);
      } else console.log("  ✓ expectations met");
    } catch (e) {
      failed++;
      console.log(`  ✗ ${e.stack ?? e}`);
    }
  }
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}
process.exit(failed ? 1 : 0);
