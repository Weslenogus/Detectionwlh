// Copies the MediaPipe Tasks Vision WebAssembly runtime into /public so the
// face detector is self-hosted (no third-party CDN at runtime).
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = join(root, "public/mediapipe/wasm");
const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

if (!existsSync(src)) {
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision not installed; face detection will be unavailable.");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
let copied = 0;
for (const f of files) {
  const from = join(src, f);
  const to = join(dest, f);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  copied++;
}
console.log(`[copy-mediapipe] ${copied ? `copied ${copied} file(s)` : "up to date"} → public/mediapipe/wasm`);
