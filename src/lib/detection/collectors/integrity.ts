import type { CrossRealmSignals, IntegrityCheck, IntegritySignals } from "../types";
import { attempt, errorMessage, withTimeout } from "../util/safe";

type AnyFn = (...args: unknown[]) => unknown;
type AnyRecord = Record<string, unknown>;

const NATIVE_RE = /^function\s+(?:get\s+|set\s+)?([\w$]*)\s*\(\s*\)\s*\{\s*\[native code\]\s*\}$/;

interface Target {
  label: string;
  proto: () => object | undefined;
  prop: string;
  kind: "getter" | "method";
  critical: boolean;
  instance?: () => object | undefined;
}

const w = () => window as unknown as AnyRecord;
const proto = (name: string) => () => (w()[name] as { prototype?: object } | undefined)?.prototype;

/** API surface that spoofing tools, stealth plugins and camera-injection kits typically patch. */
const TARGETS: Target[] = [
  ...["userAgent", "platform", "maxTouchPoints", "hardwareConcurrency", "vendor", "webdriver", "languages", "appVersion"].map(
    (p): Target => ({ label: `Navigator.${p}`, proto: proto("Navigator"), prop: p, kind: "getter", critical: true, instance: () => navigator }),
  ),
  { label: "Navigator.deviceMemory", proto: proto("Navigator"), prop: "deviceMemory", kind: "getter", critical: true, instance: () => navigator },
  { label: "Navigator.userAgentData", proto: proto("Navigator"), prop: "userAgentData", kind: "getter", critical: true, instance: () => navigator },
  { label: "NavigatorUAData.getHighEntropyValues", proto: proto("NavigatorUAData"), prop: "getHighEntropyValues", kind: "method", critical: true },
  ...["width", "height", "availWidth", "availHeight", "colorDepth"].map(
    (p): Target => ({ label: `Screen.${p}`, proto: proto("Screen"), prop: p, kind: "getter", critical: true, instance: () => screen }),
  ),
  { label: "WebGLRenderingContext.getParameter", proto: proto("WebGLRenderingContext"), prop: "getParameter", kind: "method", critical: true },
  { label: "WebGLRenderingContext.getExtension", proto: proto("WebGLRenderingContext"), prop: "getExtension", kind: "method", critical: false },
  { label: "WebGLRenderingContext.getShaderPrecisionFormat", proto: proto("WebGLRenderingContext"), prop: "getShaderPrecisionFormat", kind: "method", critical: true },
  { label: "WebGL2RenderingContext.getParameter", proto: proto("WebGL2RenderingContext"), prop: "getParameter", kind: "method", critical: true },
  { label: "HTMLCanvasElement.toDataURL", proto: proto("HTMLCanvasElement"), prop: "toDataURL", kind: "method", critical: false },
  { label: "HTMLCanvasElement.getContext", proto: proto("HTMLCanvasElement"), prop: "getContext", kind: "method", critical: false },
  { label: "CanvasRenderingContext2D.getImageData", proto: proto("CanvasRenderingContext2D"), prop: "getImageData", kind: "method", critical: false },
  { label: "CanvasRenderingContext2D.measureText", proto: proto("CanvasRenderingContext2D"), prop: "measureText", kind: "method", critical: false },
  { label: "AudioBuffer.getChannelData", proto: proto("AudioBuffer"), prop: "getChannelData", kind: "method", critical: false },
  { label: "MediaDevices.getUserMedia", proto: proto("MediaDevices"), prop: "getUserMedia", kind: "method", critical: true },
  { label: "MediaDevices.enumerateDevices", proto: proto("MediaDevices"), prop: "enumerateDevices", kind: "method", critical: true },
  { label: "MediaStreamTrack.getSettings", proto: proto("MediaStreamTrack"), prop: "getSettings", kind: "method", critical: true },
  { label: "MediaStreamTrack.getCapabilities", proto: proto("MediaStreamTrack"), prop: "getCapabilities", kind: "method", critical: true },
  { label: "MediaStreamTrack.label", proto: proto("MediaStreamTrack"), prop: "label", kind: "getter", critical: true },
  { label: "Permissions.query", proto: proto("Permissions"), prop: "query", kind: "method", critical: true },
  { label: "Date.getTimezoneOffset", proto: () => Date.prototype, prop: "getTimezoneOffset", kind: "method", critical: false },
  { label: "Intl.DateTimeFormat.resolvedOptions", proto: () => Intl.DateTimeFormat.prototype, prop: "resolvedOptions", kind: "method", critical: false },
  { label: "Element.getBoundingClientRect", proto: proto("Element"), prop: "getBoundingClientRect", kind: "method", critical: false },
];

function makeIsNative(toString: AnyFn) {
  return (fn: unknown, expectedName?: string): { native: boolean; why?: string } => {
    if (typeof fn !== "function") return { native: false, why: "not a function" };
    let src: string;
    try {
      src = toString.call(fn) as string;
    } catch (e) {
      return { native: false, why: `toString threw (${errorMessage(e)})` };
    }
    const m = src.match(NATIVE_RE);
    if (!m) return { native: false, why: "source is not [native code]" };
    // V8 prints proxies as "function () { [native code] }" — the name disappears.
    if (expectedName && m[1] !== expectedName) return { native: false, why: `name mismatch (“${m[1] || "anonymous"}”) — likely a Proxy` };
    return { native: true };
  };
}

function checkTarget(t: Target, isNative: ReturnType<typeof makeIsNative>, cleanIsNative: ReturnType<typeof makeIsNative> | null): IntegrityCheck | null {
  const p = attempt(t.proto, undefined);
  if (!p) return null;
  const desc = attempt(() => Object.getOwnPropertyDescriptor(p, t.prop), undefined);
  const reasons: string[] = [];
  const inst = t.instance ? attempt(t.instance, undefined) : undefined;
  if (inst && attempt(() => Object.prototype.hasOwnProperty.call(inst, t.prop), false)) {
    reasons.push("overridden on the instance (Object.defineProperty)");
  }
  if (!desc) {
    // Property genuinely absent on this engine (e.g. deviceMemory on Safari) is fine.
    if (reasons.length) return { target: t.label, ok: false, reasons, critical: t.critical };
    return null;
  }
  const fn = t.kind === "getter" ? desc.get : desc.value;
  if (t.kind === "getter" && !desc.get) reasons.push("accessor replaced by a data property");
  if (typeof fn === "function") {
    const expected = t.kind === "getter" ? t.prop : t.prop;
    const r = isNative(fn, expected);
    if (!r.native) reasons.push(r.why ?? "not native");
    if (cleanIsNative) {
      const rc = cleanIsNative(fn, expected);
      if (r.native && !rc.native) reasons.push("Function.prototype.toString is lying (clean realm disagrees)");
    }
    if (attempt(() => Object.prototype.hasOwnProperty.call(fn, "prototype"), false)) reasons.push("has a .prototype (regular function)");
    const ownKeys = attempt(() => Object.getOwnPropertyNames(fn).sort().join(","), "");
    if (ownKeys && ownKeys !== "length,name") reasons.push(`unexpected own keys: ${ownKeys}`);
    if (t.kind === "getter") {
      // A native getter invoked on a foreign receiver must throw "Illegal invocation".
      let threw = false;
      try {
        (fn as AnyFn).call(Object.create(p));
      } catch (e) {
        threw = e instanceof TypeError || (e as Error)?.name === "TypeError";
      }
      if (!threw) reasons.push("getter accepts a foreign receiver");
    } else {
      let threw = false;
      try {
        new (fn as unknown as new () => unknown)();
      } catch {
        threw = true;
      }
      if (!threw) reasons.push("method is constructible");
    }
  }
  return { target: t.label, ok: reasons.length === 0, reasons: reasons.slice(0, 8).map((r) => r.slice(0, 200)), critical: t.critical };
}

/* --------------------------- Cross-realm probes --------------------------- */

function iframeProbe(main: { ua: string; platform: string; mtp: number; hc: number; sw: number }): {
  realm: CrossRealmSignals;
  win: Window | null;
  cleanup: () => void;
} {
  const mismatches: string[] = [];
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;";
  document.body.appendChild(iframe);
  const cleanup = () => iframe.remove();
  const win = iframe.contentWindow;
  if (!win) return { realm: { ok: false, error: "no contentWindow", mismatches }, win: null, cleanup };
  try {
    const n = win.navigator;
    const realm: CrossRealmSignals = {
      ok: true,
      userAgent: n.userAgent,
      platform: n.platform,
      hardwareConcurrency: n.hardwareConcurrency ?? null,
      maxTouchPoints: n.maxTouchPoints ?? null,
      languages: [...(n.languages ?? [])],
      webdriver: typeof n.webdriver === "boolean" ? n.webdriver : null,
      screenWidth: win.screen?.width ?? null,
      mismatches,
    };
    if (realm.userAgent !== main.ua) mismatches.push("userAgent");
    if (realm.platform !== main.platform) mismatches.push("platform");
    if (realm.maxTouchPoints !== main.mtp) mismatches.push("maxTouchPoints");
    if (realm.hardwareConcurrency !== main.hc) mismatches.push("hardwareConcurrency");
    if (realm.screenWidth !== main.sw) mismatches.push("screen.width");
    return { realm, win, cleanup };
  } catch (e) {
    return { realm: { ok: false, error: errorMessage(e), mismatches }, win: null, cleanup };
  }
}

const WORKER_SRC = `
self.onmessage = async () => {
  const out = { ok: true };
  try {
    const n = self.navigator;
    out.userAgent = n.userAgent;
    out.platform = n.platform;
    out.hardwareConcurrency = n.hardwareConcurrency ?? null;
    out.deviceMemory = typeof n.deviceMemory === 'number' ? n.deviceMemory : null;
    out.languages = [...(n.languages || [])];
    out.webdriver = typeof n.webdriver === 'boolean' ? n.webdriver : null;
    try { out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    const ud = n.userAgentData;
    if (ud) {
      out.uaMobile = ud.mobile; out.uaPlatform = ud.platform;
      try { const h = await ud.getHighEntropyValues(['model', 'architecture']); out.uaModel = h.model ?? null; out.uaArchitecture = h.architecture ?? null; } catch (e) {}
    }
    try {
      const c = new OffscreenCanvas(1, 1);
      const gl = c.getContext('webgl');
      if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); out.gpuRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
    } catch (e) {}
    const f = new Float32Array(1); const u = new Uint8Array(f.buffer); const inf = [Infinity, Number('Infinity')];
    f[0] = inf[0]; f[0] = f[0] - inf[1];
    out.nanArch = u[3] === 255 ? 'x86' : u[3] === 127 ? 'arm' : 'unknown';
  } catch (e) { out.ok = false; out.error = String(e); }
  self.postMessage(out);
};`;

interface MainIdentity {
  ua: string;
  platform: string;
  hc: number | null;
  dm: number | null;
  tz: string;
  uaMobile: boolean | null;
  gpu: string | null;
  nan: string;
}

/** Compare what another JavaScript realm reports with the page's own view. */
export function compareRealm(data: CrossRealmSignals, main: MainIdentity): string[] {
  const mismatches: string[] = [];
  if (data.userAgent !== undefined && data.userAgent !== main.ua) mismatches.push("userAgent");
  if (data.platform !== undefined && data.platform !== main.platform) mismatches.push("platform");
  if (main.hc != null && data.hardwareConcurrency != null && data.hardwareConcurrency !== main.hc) mismatches.push("hardwareConcurrency");
  if (main.dm != null && data.deviceMemory != null && data.deviceMemory !== main.dm) mismatches.push("deviceMemory");
  if (data.timezone && main.tz && data.timezone !== main.tz) mismatches.push("timezone");
  if (main.uaMobile != null && data.uaMobile != null && data.uaMobile !== main.uaMobile) mismatches.push("userAgentData.mobile");
  if (main.gpu && data.gpuRenderer && data.gpuRenderer !== main.gpu) mismatches.push("WebGL renderer");
  if (data.nanArch && main.nan !== "unknown" && data.nanArch !== "unknown" && data.nanArch !== main.nan) mismatches.push("CPU architecture");
  return mismatches;
}

async function workerProbe(main: MainIdentity): Promise<CrossRealmSignals> {
  let url: string | null = null;
  let worker: Worker | null = null;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    worker = new Worker(url);
    const wk = worker;
    const data = await withTimeout(
      new Promise<CrossRealmSignals>((resolve, reject) => {
        wk.onmessage = (e) => resolve(e.data as CrossRealmSignals);
        wk.onerror = (e) => reject(new Error(e.message || "worker error"));
        wk.postMessage(null);
      }),
      3000,
      "worker probe",
    );
    return { ...data, ok: data.ok !== false, mismatches: compareRealm(data, main) };
  } catch (e) {
    return { ok: false, error: errorMessage(e), mismatches: [] };
  } finally {
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
  }
}

const SANDBOX_SRC = `<!doctype html><script>(async()=>{const o={ok:true};try{const n=navigator;o.userAgent=n.userAgent;o.platform=n.platform;o.hardwareConcurrency=n.hardwareConcurrency??null;o.deviceMemory=typeof n.deviceMemory==='number'?n.deviceMemory:null;o.maxTouchPoints=n.maxTouchPoints??null;o.languages=[...(n.languages||[])];o.webdriver=typeof n.webdriver==='boolean'?n.webdriver:null;o.screenWidth=screen.width;try{o.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){}if(n.userAgentData){o.uaMobile=n.userAgentData.mobile;o.uaPlatform=n.userAgentData.platform}try{const gl=document.createElement('canvas').getContext('webgl');const x=gl&&gl.getExtension('WEBGL_debug_renderer_info');o.gpuRenderer=gl?(x?gl.getParameter(x.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null}catch(e){}const f=new Float32Array(1),u=new Uint8Array(f.buffer),i=[Infinity,Number('Infinity')];f[0]=i[0];f[0]=f[0]-i[1];o.nanArch=u[3]===255?'x86':u[3]===127?'arm':'unknown'}catch(e){o.ok=false;o.error=String(e)}parent.postMessage({__realmProbe:'sandbox',o},'*')})()<\/script>`;

/** Opaque-origin sandboxed iframe: many spoofing extensions don't inject into these. */
function sandboxProbe(main: MainIdentity): Promise<CrossRealmSignals> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;";
    let done = false;
    const finish = (r: CrossRealmSignals) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      iframe.remove();
      resolve(r);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || (e.data as { __realmProbe?: string })?.__realmProbe !== "sandbox") return;
      const data = (e.data as { o: CrossRealmSignals }).o;
      finish({ ...data, ok: data.ok !== false, mismatches: compareRealm(data, main) });
    };
    window.addEventListener("message", onMsg);
    iframe.srcdoc = SANDBOX_SRC;
    document.body.appendChild(iframe);
    setTimeout(() => finish({ ok: false, error: "sandbox probe timed out", mismatches: [] }), 2500);
  });
}

function waitActivated(reg: ServiceWorkerRegistration, ms: number): Promise<ServiceWorker> {
  return new Promise((resolve, reject) => {
    if (reg.active) return resolve(reg.active);
    const sw = reg.installing ?? reg.waiting;
    sw?.addEventListener("statechange", () => {
      if (sw.state === "activated") resolve(sw);
    });
    setTimeout(() => (reg.active ? resolve(reg.active) : reject(new Error("service worker activation timed out"))), ms);
  });
}

/** Service-worker realm: a separate global with its own navigator. */
async function serviceWorkerProbe(main: MainIdentity): Promise<CrossRealmSignals> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return { ok: false, error: "service workers unavailable", mismatches: [] };
  let reg: ServiceWorkerRegistration | null = null;
  try {
    reg = await withTimeout(navigator.serviceWorker.register("/probe-sw.js", { scope: "/probe-sw/" }), 3000, "service worker register");
    const sw = await waitActivated(reg, 3000);
    const data = await withTimeout(
      new Promise<CrossRealmSignals>((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data as CrossRealmSignals);
        sw.postMessage(null, [ch.port2]);
      }),
      2500,
      "service worker reply",
    );
    return { ...data, ok: data.ok !== false, mismatches: compareRealm(data, main) };
  } catch (e) {
    return { ok: false, error: errorMessage(e), mismatches: [] };
  } finally {
    void reg?.unregister().catch(() => undefined);
  }
}

/* ----------------------- Anti-fingerprinting noise ----------------------- */

function canvasStability(): { stable: boolean | null; pixelExact: boolean | null } {
  try {
    const draw = () => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 30;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(10, 1, 60, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("stability⚡", 2, 12);
      return c.toDataURL();
    };
    const a = draw();
    const b = draw();
    const c = document.createElement("canvas");
    c.width = c.height = 4;
    const ctx = c.getContext("2d");
    let exact: boolean | null = null;
    if (ctx) {
      ctx.fillStyle = "rgb(10,20,30)";
      ctx.fillRect(0, 0, 4, 4);
      const d = ctx.getImageData(0, 0, 4, 4).data;
      exact = true;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== 10 || d[i + 1] !== 20 || d[i + 2] !== 30 || d[i + 3] !== 255) exact = false;
    }
    return { stable: a && b ? a === b : null, pixelExact: exact };
  } catch {
    return { stable: null, pixelExact: null };
  }
}

export interface IntegrityContext {
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  timezone: string;
  uaMobile: boolean | null;
  gpuRenderer: string | null;
  nanArch: string;
  audioStable: boolean | null;
}

export async function collectIntegrity(ctx: IntegrityContext): Promise<IntegritySignals> {
  const mainToString = Function.prototype.toString as unknown as AnyFn;
  const toStringNative = attempt(() => NATIVE_RE.test(mainToString.call(mainToString) as string), false);
  const frame = iframeProbe({
    ua: navigator.userAgent,
    platform: navigator.platform,
    mtp: navigator.maxTouchPoints,
    hc: navigator.hardwareConcurrency,
    sw: screen.width,
  });
  let cleanToString: AnyFn | null = null;
  try {
    cleanToString = (frame.win as unknown as { Function: FunctionConstructor } | null)?.Function.prototype.toString as unknown as AnyFn | null;
  } catch {
    cleanToString = null;
  }
  const isNative = makeIsNative(mainToString);
  const cleanIsNative = cleanToString ? makeIsNative(cleanToString) : null;
  const checks: IntegrityCheck[] = [];
  for (const t of TARGETS) {
    const r = attempt(() => checkTarget(t, isNative, cleanIsNative), null);
    if (r) checks.push(r);
  }
  if (cleanIsNative && toStringNative && !cleanIsNative(mainToString, "toString").native) {
    checks.push({ target: "Function.prototype.toString", ok: false, reasons: ["patched (clean realm disagrees)"], critical: true });
  } else if (!toStringNative) {
    checks.push({ target: "Function.prototype.toString", ok: false, reasons: ["not native"], critical: true });
  }
  frame.cleanup();

  const main: MainIdentity = {
    ua: navigator.userAgent,
    platform: navigator.platform,
    hc: ctx.hardwareConcurrency,
    dm: ctx.deviceMemory,
    tz: ctx.timezone,
    uaMobile: ctx.uaMobile,
    gpu: ctx.gpuRenderer,
    nan: ctx.nanArch,
  };
  const [worker, sandbox, serviceWorker] = await Promise.all([workerProbe(main), sandboxProbe(main), serviceWorkerProbe(main)]);
  const cs = canvasStability();
  return {
    checks,
    toStringNative,
    navigatorOwnKeys: attempt(() => Reflect.ownKeys(navigator).map(String), []),
    screenOwnKeys: attempt(() => Reflect.ownKeys(screen).map(String), []),
    iframe: frame.realm,
    worker,
    sandbox,
    serviceWorker,
    canvasStable: cs.stable,
    canvasPixelExact: cs.pixelExact,
    audioStable: ctx.audioStable,
  };
}
