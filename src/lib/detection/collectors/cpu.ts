import type { CpuSignals } from "../types";
import { attempt } from "../util/safe";

type Arch = CpuSignals["nanArchJs"];

/**
 * IEEE-754 leaves the "default NaN" produced by invalid operations to the
 * hardware: x86 SSE produces 0xFFC00000 (sign bit set) while ARM produces
 * 0x7FC00000. Computing ∞−∞ at runtime therefore reveals the real CPU family
 * underneath any UA/platform spoofing — DevTools and anti-detect browsers on an
 * Intel/AMD PC cannot hide it, and neither can x86 Android emulators.
 */
function nanFromJs(): { arch: Arch; bits: string } {
  const f = new Float32Array(1);
  const u = new Uint8Array(f.buffer);
  const inputs = [Infinity, Number(String(Infinity))]; // opaque to constant folding
  f[0] = inputs[0];
  f[0] = f[0] - inputs[1];
  const bits = [...u].reverse().map((b) => b.toString(16).padStart(2, "0")).join("");
  return { arch: u[3] === 0xff ? "x86" : u[3] === 0x7f ? "arm" : "unknown", bits };
}

/** Same probe executed by the WebAssembly JIT (f32.sub + i32.reinterpret_f32). Hand-assembled module. */
const WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7d, 0x7d, 0x01, 0x7f, // type: (f32, f32) -> i32
  0x03, 0x02, 0x01, 0x00, // function section
  0x07, 0x05, 0x01, 0x01, 0x73, 0x00, 0x00, // export "s"
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x20, 0x00, 0x20, 0x01, 0x93, 0xbc, 0x0b, // body: local.get 0, local.get 1, f32.sub, i32.reinterpret_f32
]);

function nanFromWasm(): { arch: Arch; bits: string } {
  const mod = new WebAssembly.Module(WASM);
  const inst = new WebAssembly.Instance(mod);
  const s = inst.exports.s as (a: number, b: number) => number;
  const v = s(Infinity, Infinity) >>> 0;
  const bits = v.toString(16).padStart(8, "0");
  return { arch: v >>> 24 === 0xff ? "x86" : v >>> 24 === 0x7f ? "arm" : "unknown", bits };
}

/** Tiny deterministic workload — reported for context only (thermal state makes it noisy). */
function benchmark(): number {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 1; i < 300_000; i++) acc += Math.sqrt(i) * Math.sin(i);
  if (acc === 42) console.debug(acc);
  return Math.round((performance.now() - t0) * 100) / 100;
}

export function collectCpu(): CpuSignals {
  const js = attempt(nanFromJs, { arch: "unknown" as Arch, bits: "" });
  const wasm = attempt(nanFromWasm, { arch: "unknown" as Arch, bits: "" });
  return {
    nanArchJs: js.arch,
    nanBitsJs: js.bits,
    nanArchWasm: wasm.arch,
    nanBitsWasm: wasm.bits,
    benchmarkMs: attempt(benchmark, null),
  };
}
