// Renders fake-camera clips from one portrait photo, for the camera attack e2e scenarios:
//
//   flat.mjpeg      the whole photo as a flat card, tilted ±35° (print / screen presentation attack)
//   mesh-rl.mjpeg   the portrait's 478-point face mesh, with MediaPipe's own depth estimate,
//                   turning right then left (a genuinely 3D face surface)
//   id-still.mjpeg  OBS scene as a still image: the face plus a doctored ID card (a SPECIMEN
//                   test card carrying an altered copy of the face)
//   id-relay.mjpeg  OBS relaying a live webcam: the turning 3D face with per-frame sensor-like
//                   noise, and the same ID card pasted in as a static overlay
//
//   node e2e/face-clips.mjs path/to/portrait.jpg [outDir=test-results/face-clips]
//   FACE_CLIPS=test-results/face-clips npm run test:e2e
//
// Any front-facing portrait works; the face is located and cropped automatically.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const [portrait, outDir = "test-results/face-clips"] = process.argv.slice(2);
if (!portrait) {
  console.error("usage: node e2e/face-clips.mjs <portrait.jpg> [outDir]");
  process.exit(2);
}
const repo = resolve(".");
mkdirSync(outDir, { recursive: true });

const files = {
  "/vision_bundle.mjs": [join(repo, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"), "text/javascript"],
  "/model.task": [join(repo, "public/models/face_landmarker.task"), "application/octet-stream"],
  "/portrait": [resolve(portrait), "image/jpeg"],
};

// Runs in the page: MediaPipe landmarks + canvas texture-mapped rendering.
const html = `<!doctype html><canvas id=c width=640 height=480></canvas><script type=module>
import { FilesetResolver, FaceLandmarker } from "/vision_bundle.mjs";
window.gen = async (mode) => {
  const fileset = await FilesetResolver.forVisionTasks("/wasm");
  const lmk = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "/model.task", delegate: "CPU" }, runningMode: "IMAGE", numFaces: 1 });
  const img = new Image(); img.src = "/portrait"; await img.decode();
  const W = 640, H = 480;
  // Crop so the face spans about a third of the frame width.
  const full = document.createElement("canvas"); full.width = img.naturalWidth; full.height = img.naturalHeight;
  full.getContext("2d").drawImage(img, 0, 0);
  const f0 = lmk.detect(full).faceLandmarks[0];
  if (!f0) throw new Error("no face found in the portrait");
  const fw = Math.abs(f0[454].x - f0[234].x) * full.width;
  const fcx = ((f0[454].x + f0[234].x) / 2) * full.width, fcy = f0[168].y * full.height;
  const cw = Math.min(full.width, fw * 3), ch = Math.min(full.height, (cw * H) / W);
  const sx = Math.max(0, Math.min(full.width - cw, fcx - cw / 2)), sy = Math.max(0, Math.min(full.height - ch, fcy - ch * 0.45));
  const src = document.createElement("canvas"); src.width = W; src.height = H;
  src.getContext("2d").drawImage(full, sx, sy, cw, ch, 0, 0, W, H);
  const lm = lmk.detect(src).faceLandmarks[0];
  if (!lm) throw new Error("no face after cropping");
  const faceW = Math.abs(lm[454].x - lm[234].x) * W;

  // SPECIMEN test card (obviously not a real document) carrying an altered copy of the face.
  const CARD = { x: 16, y: 288, w: 288, h: 176 }; // on the 16-px JPEG MCU grid, so it stays bit-exact
  const card = document.createElement("canvas"); card.width = CARD.w; card.height = CARD.h;
  {
    const k = card.getContext("2d");
    const grad = k.createLinearGradient(0, 0, CARD.w, CARD.h);
    grad.addColorStop(0, "#dfe8ef"); grad.addColorStop(1, "#c9d8cf");
    k.fillStyle = grad; k.fillRect(0, 0, CARD.w, CARD.h);
    k.strokeStyle = "rgba(60,100,140,0.25)"; k.lineWidth = 0.6;
    for (let j = 0; j < 14; j++) { k.beginPath(); for (let x = 0; x <= CARD.w; x += 3) k.lineTo(x, 20 + j * 11 + 4 * Math.sin(x / 9 + j)); k.stroke(); }
    k.fillStyle = "#23405c"; k.fillRect(0, 0, CARD.w, 22);
    k.fillStyle = "#fff"; k.font = "bold 11px sans-serif"; k.fillText("SPECIMEN - TEST IDENTITY CARD", 8, 15);
    // Face photo, "modified": hue-shifted and stretched.
    const fx = Math.min(...lm.map((p) => p.x)) * W, fy = Math.min(...lm.map((p) => p.y)) * H;
    const fw2 = (Math.max(...lm.map((p) => p.x)) - Math.min(...lm.map((p) => p.x))) * W, fh2 = (Math.max(...lm.map((p) => p.y)) - Math.min(...lm.map((p) => p.y))) * H;
    k.filter = "hue-rotate(25deg) saturate(1.3)";
    k.drawImage(src, fx - fw2 * 0.25, fy - fh2 * 0.3, fw2 * 1.5, fh2 * 1.55, 10, 30, 84, 108);
    k.filter = "none";
    k.fillStyle = "#1b2a38"; k.font = "10px sans-serif";
    [["SURNAME", "SAMPLE"], ["GIVEN NAMES", "TEST PERSON"], ["DOCUMENT NO", "X00000000"], ["", "NOT A VALID DOCUMENT"]].forEach(([a, b], i) => {
      k.fillStyle = "#56708a"; k.fillText(a, 104, 42 + i * 22); k.fillStyle = "#1b2a38"; k.fillText(b, 104, 53 + i * 22);
    });
    k.font = "10px monospace"; k.fillStyle = "#1b2a38";
    k.fillText("IDXXXX00000000<<<<<<<<<<<<<<<<", 8, 152); k.fillText("SAMPLE<<TEST<PERSON<<<<<<<<<<<<", 8, 166);
  }
  // Sensor-like noise: a table of Gaussian samples read at a random offset per frame.
  const NOISE = new Float32Array(1 << 20);
  for (let i = 0; i < NOISE.length; i += 2) {
    const u = Math.random() || 1e-9, v = Math.random(), m = Math.sqrt(-2 * Math.log(u));
    NOISE[i] = m * Math.cos(2 * Math.PI * v); NOISE[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  const addNoise = (c2, sigma) => {
    const im = c2.getImageData(0, 0, W, H), d = im.data;
    let o = (Math.random() * NOISE.length) | 0;
    for (let i = 0; i < d.length; i += 4) {
      const px = (i >> 2) % W, py = ((i >> 2) / W) | 0;
      if (px >= CARD.x && px < CARD.x + CARD.w && py >= CARD.y && py < CARD.y + CARD.h) continue;
      const nY = NOISE[o++ & (NOISE.length - 1)] * sigma;
      for (let ch = 0; ch < 3; ch++) d[i + ch] += nY + NOISE[o++ & (NOISE.length - 1)] * sigma * 0.5;
    }
    c2.putImageData(im, 0, 0);
  };
  if (mode === "id-still") {
    const ctx = document.getElementById("c").getContext("2d");
    ctx.drawImage(src, 0, 0);
    ctx.drawImage(card, CARD.x, CARD.y);
    const still = document.getElementById("c").toDataURL("image/jpeg", 0.92);
    return Array.from({ length: 60 }, () => still);
  }

  let verts, triangles, bg, cx, cz;
  if (mode === "mesh-rl" || mode === "id-relay") {
    // Triangles = 3-cliques of the tesselation graph; z is MediaPipe's depth (image-width units).
    const adj = new Map();
    for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_TESSELATION) {
      if (!adj.has(start)) adj.set(start, new Set());
      if (!adj.has(end)) adj.set(end, new Set());
      adj.get(start).add(end); adj.get(end).add(start);
    }
    triangles = [];
    for (const [a, na] of adj) for (const b of na) if (b > a) for (const c of adj.get(b)) if (c > b && na.has(c)) triangles.push([a, b, c]);
    verts = lm.map((p) => ({ u: p.x * W, v: p.y * H, x: p.x * W, y: p.y * H, z: p.z * W }));
    bg = "#6b3a34";
    cx = ((lm[234].x + lm[454].x) / 2) * W;
    cz = faceW * 0.55; // the head turns about a point behind the face
  } else {
    // Flat card: a grid over the whole picture, z = 0.
    verts = []; triangles = [];
    const nx = 16, ny = 12;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) verts.push({ u: (i / nx) * W, v: (j / ny) * H, x: (i / nx) * W, y: (j / ny) * H, z: 0 });
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i;
      triangles.push([k, k + 1, k + nx + 2], [k, k + nx + 2, k + nx + 1]);
    }
    bg = "#2b2b2b"; cx = W / 2; cz = 0;
  }
  // Yaw keyframes [s, deg]; + turns the face towards the subject's left.
  const keys = mode === "mesh-rl" || mode === "id-relay"
    ? [[0, 0], [3.5, 0], [4.5, -35], [5, -35], [6.5, 35], [7, 35], [8, 0], [12, 0]]
    : [[0, 0], [2, 0], [3, 35], [3.5, 35], [5, -35], [5.5, -35], [7, 35], [7.5, 35], [8.5, 0], [9.5, 0]];
  const yawAt = (t) => {
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
      const [t0, a0] = keys[i - 1], [t1, a1] = keys[i];
      const s = (t - t0) / (t1 - t0 || 1);
      return a0 + (a1 - a0) * (0.5 - 0.5 * Math.cos(Math.PI * s));
    }
    return 0;
  };
  const ctx = document.getElementById("c").getContext("2d", { willReadFrequently: true });
  const f = 900, D = 900, cy = H / 2, fps = 30, frames = [];
  for (let n = 0; n < keys[keys.length - 1][0] * fps; n++) {
    const a = ((yawAt(n / fps) + Math.sin(n * 0.7) * 0.4) * Math.PI) / 180;
    const P = verts.map((p) => {
      const x = p.x - cx, z = p.z - cz;
      const xr = x * Math.cos(a) - z * Math.sin(a);
      const zr = x * Math.sin(a) + z * Math.cos(a) + cz;
      const s = f / (D + zr);
      return { x: W / 2 + xr * s + (cx - W / 2) * (f / D), y: cy + (p.y - cy) * s, z: zr, u: p.u, v: p.v };
    });
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const order = triangles.map((t) => [t, (P[t[0]].z + P[t[1]].z + P[t[2]].z) / 3]).sort((p, q) => q[1] - p[1]);
    for (const [[i0, i1, i2]] of order) {
      const p0 = P[i0], p1 = P[i1], p2 = P[i2];
      const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
      const srcArea = (p1.u - p0.u) * (p2.v - p0.v) - (p2.u - p0.u) * (p1.v - p0.v);
      if (mode !== "flat" && Math.sign(area) !== Math.sign(srcArea)) continue; // back face
      // Affine map source triangle → destination triangle; grow the clip by ~0.6 px to hide seams.
      const mx = (p0.x + p1.x + p2.x) / 3, my = (p0.y + p1.y + p2.y) / 3;
      const g = (p) => { const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy) || 1; return [p.x + (dx / d) * 0.6, p.y + (dy / d) * 0.6]; };
      const den = p0.u * (p2.v - p1.v) - p1.u * p2.v + p2.u * p1.v + (p1.u - p2.u) * p0.v;
      if (Math.abs(den) < 1e-6) continue;
      const m11 = -(p0.v * (p2.x - p1.x) - p1.v * p2.x + p2.v * p1.x + (p1.v - p2.v) * p0.x) / den;
      const m12 = (p1.v * p2.y + p0.v * (p1.y - p2.y) - p2.v * p1.y + (p2.v - p1.v) * p0.y) / den;
      const m21 = (p0.u * (p2.x - p1.x) - p1.u * p2.x + p2.u * p1.x + (p1.u - p2.u) * p0.x) / den;
      const m22 = -(p1.u * p2.y + p0.u * (p1.y - p2.y) - p2.u * p1.y + (p2.u - p1.u) * p0.y) / den;
      const dx = (p0.u * (p2.v * p1.x - p1.v * p2.x) + p0.v * (p1.u * p2.x - p2.u * p1.x) + (p2.u * p1.v - p1.u * p2.v) * p0.x) / den;
      const dy = (p0.u * (p2.v * p1.y - p1.v * p2.y) + p0.v * (p1.u * p2.y - p2.u * p1.y) + (p2.u * p1.v - p1.u * p2.v) * p0.y) / den;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(...g(p0)); ctx.lineTo(...g(p1)); ctx.lineTo(...g(p2)); ctx.closePath(); ctx.clip();
      ctx.setTransform(m11, m12, m21, m22, dx, dy);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    if (mode === "id-relay") {
      addNoise(ctx, 2.5);
      ctx.drawImage(card, CARD.x, CARD.y);
    }
    frames.push(document.getElementById("c").toDataURL("image/jpeg", mode === "id-relay" ? 0.95 : 0.9));
  }
  return frames;
};
window.ready = true;
</script>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage();
await page.route("http://clips.local/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/") return route.fulfill({ body: html, contentType: "text/html; charset=utf-8" });
  if (path.startsWith("/wasm/")) {
    return route.fulfill({ body: readFileSync(join(repo, "public/mediapipe", path)), contentType: path.endsWith(".wasm") ? "application/wasm" : "text/javascript" });
  }
  const f = files[path];
  return f ? route.fulfill({ body: readFileSync(f[0]), contentType: f[1] }) : route.fulfill({ status: 404, body: "" });
});
await page.goto("http://clips.local/");
await page.waitForFunction(() => window.ready);
for (const mode of ["flat", "mesh-rl", "id-still", "id-relay"]) {
  const frames = await page.evaluate((m) => window.gen(m), mode);
  // Chromium's fake capture reads concatenated JPEGs (.mjpeg) at 30 fps.
  writeFileSync(join(outDir, `${mode}.mjpeg`), Buffer.concat(frames.map((d) => Buffer.from(d.split(",")[1], "base64"))));
  console.log(`${mode}.mjpeg: ${frames.length} frames`);
}
await browser.close();
