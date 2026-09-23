import type { Add, Ctx } from "../context";

export function graphicsRules(c: Ctx, add: Add) {
  const { d, claims, gpu } = c;
  const gl = d.webgl;
  if (!gl?.supported) {
    add({
      id: "graphics.webgl",
      title: "WebGL",
      value: "unavailable",
      detail: gl?.error ?? "No WebGL context — blocked, headless without GPU, or heavily hardened browser.",
      status: "warn",
      evidence: { automation: 0.8, spoofed: 0.3, phone: -0.5 },
    });
    return;
  }

  const renderer = gl.unmaskedRenderer ?? gl.renderer ?? "";
  const byClass: Record<string, () => void> = {
    emulator: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: renderer,
        detail: "The renderer is the Android Emulator's OpenGL ES translator — a virtual GPU.",
        status: "fail",
        evidence: { emulator: 5.0, phone: -3.0, tablet: -3.0 },
      }),
    software: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: renderer,
        detail: "Software rasteriser (SwiftShader / llvmpipe): no physical GPU — headless browsers, CI machines, VMs and emulators.",
        status: "fail",
        evidence: { automation: 2.5, emulator: 2.0, spoofed: 0.5, phone: -3.0, tablet: -3.0, desktop: -1.0 },
      }),
    virtual: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: renderer,
        detail: "Virtual-machine display adapter.",
        status: "fail",
        evidence: { emulator: 2.5, automation: 1.0, desktop: 0.3, phone: -3.0, tablet: -3.0 },
      }),
    mobile: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: gpu.label,
        detail: `Mobile GPU family (${gpu.family}). Anti-detect browsers can fake this string, so it is cross-checked with shader precision, texture formats and WebGPU below.`,
        status: "pass",
        evidence: { phone: 1.6, tablet: 1.6, emulator: -0.8, spoofed: -2.2, desktop: -2.2, automation: -1.5 },
      }),
    apple: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: renderer,
        detail: "Safari masks every Apple GPU as “Apple GPU” (iPhone, iPad and Mac alike).",
        status: "info",
        evidence: claims.mobile ? { phone: 0.4, tablet: 0.4, spoofed: -0.6, desktop: 0.2 } : { desktop: 0.3, tablet: 0.3 },
      }),
    desktop: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: gpu.label,
        detail: claims.mobile
          ? `Desktop GPU (${gpu.family}) behind a mobile user agent — the page is rendered by a PC.`
          : `Desktop GPU (${gpu.family}).`,
        status: claims.mobile ? "fail" : "info",
        evidence: claims.mobile ? { spoofed: 2.5, emulator: 1.2, phone: -3.0, tablet: -2.5 } : { desktop: 0.8, phone: -1.2, tablet: -0.8 },
      }),
    unknown: () =>
      add({
        id: "graphics.gpu",
        title: "GPU renderer",
        value: renderer || "masked",
        detail: "Renderer string is unknown or masked by the browser.",
        status: "info",
      }),
  };
  (byClass[gpu.class] ?? byClass.unknown)();

  /* ------------------------- Shader precision ------------------------------ */
  const fm = gl.precision?.fragmentMedium;
  const probe = gl.mediumpProbeBits ?? null;
  const realGpu = gpu.class !== "software" && gpu.class !== "emulator" && gpu.class !== "virtual";
  if (fm && !realGpu) {
    add({
      id: "graphics.mediump",
      title: "Fragment mediump precision",
      value: `${fm.precision}-bit mantissa${probe !== null ? ` · measured ${probe} bits` : ""}`,
      detail: "Not meaningful on a software/virtual rasteriser.",
      status: "info",
    });
  } else if (fm) {
    const half = fm.precision <= 11;
    const probeTxt = probe !== null ? ` · measured ${probe} bits` : "";
    if (half) {
      add({
        id: "graphics.mediump",
        title: "Fragment mediump precision",
        value: `${fm.precision}-bit mantissa (±2^${fm.rangeMax})${probeTxt}`,
        detail: "The GPU executes mediump as IEEE half-float — a power-saving trait of mobile GPUs. Desktop GPUs promote mediump to 32-bit.",
        status: "pass",
        evidence: { phone: 1.0, tablet: 1.0, desktop: -0.8, spoofed: -1.2, automation: -1.0, emulator: -0.5 },
      });
      if (probe !== null && probe >= 20) {
        add({
          id: "graphics.mediump-probe",
          title: "Measured vs reported precision",
          value: `reported ${fm.precision} bits, executed ${probe} bits`,
          detail: "The shader actually ran at full precision despite reporting half precision. Some drivers do this, but so do spoofed getShaderPrecisionFormat() values.",
          status: "warn",
          evidence: { spoofed: 0.6 },
        });
      }
    } else if (gpu.class === "mobile" && claims.android) {
      add({
        id: "graphics.mediump",
        title: "Fragment mediump precision",
        value: `${fm.precision}-bit mantissa${probeTxt}`,
        detail: "A mobile GPU is claimed but mediump runs at desktop fp32 precision — consistent with a desktop GPU wearing a mobile renderer string.",
        status: "warn",
        evidence: { spoofed: 1.5, emulator: 1.5, phone: -1.2, tablet: -1.0 },
      });
    } else {
      add({
        id: "graphics.mediump",
        title: "Fragment mediump precision",
        value: `${fm.precision}-bit mantissa${probeTxt}`,
        detail: probe !== null && probe <= 11 ? "Reported full precision but the shader measured half precision." : "Full-precision mediump.",
        status: "info",
        evidence: probe !== null && probe <= 11 ? { phone: 0.6, tablet: 0.6 } : claims.mobile ? { phone: -0.2 } : {},
      });
    }
  }

  /* ------------------------ Texture compression --------------------------- */
  const ext = gl.extensions ?? [];
  if (ext.length) {
    const astc = ext.some((e) => /astc/i.test(e));
    const s3tc = ext.some((e) => /s3tc/i.test(e) && !/srgb/i.test(e));
    const etc = ext.some((e) => /compressed_texture_etc(?!1)/i.test(e));
    const summary = [astc && "ASTC", etc && "ETC2", s3tc && "S3TC/BCn"].filter(Boolean).join(" + ") || "none";
    if (astc && !s3tc) {
      add({
        id: "graphics.texture",
        title: "Hardware texture compression",
        value: summary,
        detail: "ASTC without desktop BCn/S3TC formats: the signature of a mobile GPU.",
        status: "pass",
        evidence: { phone: 1.0, tablet: 1.0, desktop: -0.8, spoofed: -1.0, automation: -0.4 },
      });
    } else if (s3tc && !astc) {
      add({
        id: "graphics.texture",
        title: "Hardware texture compression",
        value: summary,
        detail: claims.mobile ? "Only desktop-class BCn/S3TC formats — phone GPUs ship ASTC." : "Desktop-class texture formats.",
        status: claims.mobile ? "fail" : "info",
        evidence: claims.mobile ? { spoofed: 1.2, emulator: 0.6, phone: -1.2, tablet: -1.0 } : { desktop: 0.4 },
      });
    } else {
      add({ id: "graphics.texture", title: "Hardware texture compression", value: summary, detail: "Mixed support (Apple Silicon, some ARM laptops).", status: "info" });
    }
  }

  if (claims.mobile && (gl.maxTextureSize ?? 0) >= 32768) {
    add({
      id: "graphics.limits",
      title: "GPU limits",
      value: `MAX_TEXTURE_SIZE ${gl.maxTextureSize}`,
      detail: "32K textures are a discrete desktop GPU trait; phone GPUs top out at 16K.",
      status: "warn",
      evidence: { spoofed: 1.0, emulator: 0.5, phone: -1.0 },
    });
  }

  /* -------------------------------- WebGPU -------------------------------- */
  const ad = d.webgpu?.adapter;
  if (ad && c.webgpuClass) {
    const label = `${ad.vendor || "?"} / ${ad.architecture || "?"}${ad.isFallbackAdapter ? " (fallback)" : ""}`;
    const glClass = gpu.class === "apple" ? "apple" : gpu.class;
    const conflict =
      (c.webgpuClass === "mobile" && glClass === "desktop") || (c.webgpuClass === "desktop" && glClass === "mobile");
    if (conflict) {
      add({
        id: "graphics.webgpu",
        title: "WebGPU adapter",
        value: label,
        detail: "WebGPU and WebGL describe different GPU vendors — one of them has been spoofed.",
        status: "fail",
        evidence: { spoofed: 2.0, phone: -1.5, tablet: -1.2 },
      });
    } else if (ad.isFallbackAdapter) {
      add({
        id: "graphics.webgpu",
        title: "WebGPU adapter",
        value: label,
        detail: "Only a software fallback adapter is available.",
        status: "warn",
        evidence: { automation: 1.0, emulator: 0.8, phone: -0.5 },
      });
    } else if (c.webgpuClass === "mobile") {
      add({
        id: "graphics.webgpu",
        title: "WebGPU adapter",
        value: label,
        detail: "WebGPU independently reports a mobile GPU vendor/architecture.",
        status: "pass",
        evidence: { phone: 0.6, tablet: 0.6, spoofed: -0.8 },
      });
    } else if (c.webgpuClass === "desktop" && claims.mobile) {
      add({
        id: "graphics.webgpu",
        title: "WebGPU adapter",
        value: label,
        detail: "WebGPU reports a desktop GPU vendor behind a mobile user agent.",
        status: "fail",
        evidence: { spoofed: 1.2, emulator: 0.6, phone: -1.2 },
      });
    } else {
      add({ id: "graphics.webgpu", title: "WebGPU adapter", value: label, detail: "Recorded.", status: "info" });
    }
  } else {
    add({
      id: "graphics.webgpu",
      title: "WebGPU adapter",
      value: d.webgpu?.supported ? d.webgpu.error ?? "no adapter" : "not supported",
      detail: "WebGPU unavailable in this browser build or blocked.",
      status: "info",
    });
  }
}
