import type { PrecisionFormat, WebGLSignals, WebGPUSignals } from "../types";
import { hashBytes } from "../util/hash";
import { attempt, errorMessage, withTimeout } from "../util/safe";

type GL = WebGLRenderingContext;

const VS = "attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}";

/**
 * Measures how many mantissa bits a `mediump float` really has on this GPU by
 * repeatedly halving an epsilon until `x + eps == x`. Mobile GPUs execute
 * mediump as IEEE half (10 bits); desktop GPUs silently promote to fp32 (23).
 * Uniform inputs stop the shader compiler from constant-folding the loop.
 */
const FS_PRECISION = `precision mediump float;
uniform float one;
uniform float halfv;
void main(){
  float x = one;
  float y = one;
  float bits = 0.0;
  for (int i = 0; i < 30; i++) {
    y = y * halfv;
    if (x + y == x) break;
    bits += 1.0;
  }
  gl_FragColor = vec4(bits / 32.0, 0.0, 0.0, 1.0);
}`;

/** A small scene whose rasterisation / transcendental rounding differs across GPUs and drivers. */
const FS_SCENE = `precision highp float;
varying vec2 v;
void main(){
  float a = sin(v.x * 37.1) * cos(v.y * 23.7);
  float b = fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(v.x, a * 0.5 + 0.5, b, 1.0);
}`;

function compile(gl: GL, vs: string, fs: string): WebGLProgram | null {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = mk(gl.VERTEX_SHADER, vs);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

function drawFullscreen(gl: GL, program: WebGLProgram) {
  gl.useProgram(program);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function mediumpProbe(gl: GL): number | null {
  const prog = compile(gl, VS, FS_PRECISION);
  if (!prog) return null;
  gl.useProgram(prog);
  gl.uniform1f(gl.getUniformLocation(prog, "one"), 1);
  gl.uniform1f(gl.getUniformLocation(prog, "halfv"), 0.5);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  drawFullscreen(gl, prog);
  const px = new Uint8Array(4);
  gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return Math.round((px[0] / 255) * 32);
}

function renderHash(gl: GL): string | null {
  const prog = compile(gl, VS, FS_SCENE);
  if (!prog) return null;
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawFullscreen(gl, prog);
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return hashBytes(px);
}

function precision(gl: GL, shader: number, type: number): PrecisionFormat | undefined {
  const p = gl.getShaderPrecisionFormat(shader, type);
  return p ? { rangeMin: p.rangeMin, rangeMax: p.rangeMax, precision: p.precision } : undefined;
}

export function collectWebGL(): WebGLSignals {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  let gl: GL | null = null;
  try {
    gl = (canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false }) ??
      canvas.getContext("experimental-webgl")) as GL | null;
  } catch (e) {
    return { supported: false, error: errorMessage(e) };
  }
  if (!gl) return { supported: false, error: "WebGL context unavailable" };

  const out: WebGLSignals = { supported: true };
  const g = gl;
  const p = <T>(k: number) => attempt(() => g.getParameter(k) as T, undefined as T | undefined);
  out.vendor = p<string>(g.VENDOR);
  out.renderer = p<string>(g.RENDERER);
  out.version = p<string>(g.VERSION);
  out.shadingLanguageVersion = p<string>(g.SHADING_LANGUAGE_VERSION);
  const dbg = attempt(() => g.getExtension("WEBGL_debug_renderer_info"), null);
  if (dbg) {
    out.unmaskedVendor = p<string>(dbg.UNMASKED_VENDOR_WEBGL);
    out.unmaskedRenderer = p<string>(dbg.UNMASKED_RENDERER_WEBGL);
  }
  out.maxTextureSize = p<number>(g.MAX_TEXTURE_SIZE);
  out.maxRenderbufferSize = p<number>(g.MAX_RENDERBUFFER_SIZE);
  out.maxViewportDims = attempt(() => Array.from(g.getParameter(g.MAX_VIEWPORT_DIMS) as Int32Array), undefined);
  out.maxCombinedTextureImageUnits = p<number>(g.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  out.maxVertexAttribs = p<number>(g.MAX_VERTEX_ATTRIBS);
  out.maxVaryingVectors = p<number>(g.MAX_VARYING_VECTORS);
  out.maxFragmentUniformVectors = p<number>(g.MAX_FRAGMENT_UNIFORM_VECTORS);
  out.maxVertexUniformVectors = p<number>(g.MAX_VERTEX_UNIFORM_VECTORS);
  out.aliasedLineWidthRange = attempt(() => Array.from(g.getParameter(g.ALIASED_LINE_WIDTH_RANGE) as Float32Array), undefined);
  out.aliasedPointSizeRange = attempt(() => Array.from(g.getParameter(g.ALIASED_POINT_SIZE_RANGE) as Float32Array), undefined);
  out.maxAnisotropy = attempt(() => {
    const ext = g.getExtension("EXT_texture_filter_anisotropic");
    return ext ? (g.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : null;
  }, null);
  out.extensions = attempt(() => g.getSupportedExtensions() ?? [], []);
  out.precision = attempt(
    () => ({
      vertexHigh: precision(g, g.VERTEX_SHADER, g.HIGH_FLOAT),
      vertexMedium: precision(g, g.VERTEX_SHADER, g.MEDIUM_FLOAT),
      fragmentHigh: precision(g, g.FRAGMENT_SHADER, g.HIGH_FLOAT),
      fragmentMedium: precision(g, g.FRAGMENT_SHADER, g.MEDIUM_FLOAT),
      fragmentLow: precision(g, g.FRAGMENT_SHADER, g.LOW_FLOAT),
    }),
    undefined,
  );
  out.mediumpProbeBits = attempt(() => mediumpProbe(g), null);
  out.renderHash = attempt(() => renderHash(g), null) ?? undefined;

  try {
    const c2 = document.createElement("canvas");
    const gl2 = c2.getContext("webgl2") as WebGL2RenderingContext | null;
    out.webgl2 = Boolean(gl2);
    out.maxSamples = gl2 ? (gl2.getParameter(gl2.MAX_SAMPLES) as number) : null;
    gl2?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    out.webgl2 = false;
  }
  attempt(() => g.getExtension("WEBGL_lose_context")?.loseContext(), undefined);
  return out;
}

const LIMIT_KEYS = [
  "maxTextureDimension2D",
  "maxBufferSize",
  "maxStorageBufferBindingSize",
  "maxComputeWorkgroupStorageSize",
  "maxComputeInvocationsPerWorkgroup",
  "maxColorAttachmentBytesPerSample",
];

export async function collectWebGPU(): Promise<WebGPUSignals> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return { supported: false };
  try {
    const adapter = (await withTimeout(gpu.requestAdapter(), 2500, "requestAdapter")) as Record<string, unknown> | null;
    if (!adapter) return { supported: true, adapter: null, error: "No adapter" };
    let info = adapter.info as Record<string, unknown> | undefined;
    if (!info && typeof adapter.requestAdapterInfo === "function") {
      info = (await (adapter.requestAdapterInfo as () => Promise<Record<string, unknown>>)()) ?? undefined;
    }
    const limits: Record<string, number> = {};
    const lim = adapter.limits as Record<string, number> | undefined;
    for (const k of LIMIT_KEYS) if (lim && typeof lim[k] === "number") limits[k] = lim[k];
    const fallback =
      typeof info?.isFallbackAdapter === "boolean"
        ? (info.isFallbackAdapter as boolean)
        : typeof adapter.isFallbackAdapter === "boolean"
          ? (adapter.isFallbackAdapter as boolean)
          : null;
    return {
      supported: true,
      adapter: {
        vendor: String(info?.vendor ?? ""),
        architecture: String(info?.architecture ?? ""),
        device: String(info?.device ?? ""),
        description: String(info?.description ?? ""),
        isFallbackAdapter: fallback,
        features: attempt(() => Array.from((adapter.features as Set<string>) ?? []).sort().slice(0, 40), []),
        limits,
      },
    };
  } catch (e) {
    return { supported: true, adapter: null, error: errorMessage(e) };
  }
}
