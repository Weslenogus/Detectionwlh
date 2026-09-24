// Service-worker realm probe. Registered under the empty /probe-sw/ scope so it
// never controls any page; it only answers one message with what *this* realm
// sees, then the page unregisters it. Spoofing scripts rarely reach here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", async (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  const out = { ok: true };
  try {
    const n = self.navigator;
    out.userAgent = n.userAgent;
    out.platform = n.platform;
    out.hardwareConcurrency = typeof n.hardwareConcurrency === "number" ? n.hardwareConcurrency : null;
    out.deviceMemory = typeof n.deviceMemory === "number" ? n.deviceMemory : null;
    out.languages = Array.from(n.languages || []);
    out.webdriver = typeof n.webdriver === "boolean" ? n.webdriver : null;
    try {
      out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {}
    const ud = n.userAgentData;
    if (ud) {
      out.uaMobile = ud.mobile;
      out.uaPlatform = ud.platform;
      try {
        const h = await ud.getHighEntropyValues(["model", "architecture"]);
        out.uaModel = h.model ?? null;
        out.uaArchitecture = h.architecture ?? null;
      } catch {}
    }
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        const gl = new OffscreenCanvas(1, 1).getContext("webgl");
        if (gl) {
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          out.gpuRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        }
      }
    } catch {}
    const f = new Float32Array(1);
    const u = new Uint8Array(f.buffer);
    const inf = [Infinity, Number("Infinity")];
    f[0] = inf[0];
    f[0] = f[0] - inf[1];
    out.nanArch = u[3] === 255 ? "x86" : u[3] === 127 ? "arm" : "unknown";
  } catch (e) {
    out.ok = false;
    out.error = String(e);
  }
  port.postMessage(out);
});
