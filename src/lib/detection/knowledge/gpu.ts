/** GPU renderer-string classification (WebGL UNMASKED_RENDERER / WebGPU adapter info). */

export type GpuClass = "mobile" | "apple" | "desktop" | "software" | "emulator" | "virtual" | "unknown";

export interface GpuInfo {
  class: GpuClass;
  family: string;
  label: string;
}

const RULES: [RegExp, GpuClass, string][] = [
  // Emulators first: they often embed the *host* GPU name inside the string.
  [/Android Emulator|Emulator OpenGL|OpenGL ES Translator|goldfish|ranchu|gfxstream/i, "emulator", "android-emulator"],
  [/SwiftShader|Subzero/i, "software", "swiftshader"],
  [/llvmpipe|softpipe|lavapipe|swrast|Software Rasterizer|Microsoft Basic Render|Mesa OffScreen|GDI Generic/i, "software", "cpu-rasterizer"],
  [/VMware|VirtualBox|Parallels|SVGA3D|\bQXL\b|virgl|Red Hat|Hyper-V|Citrix|VirtIO/i, "virtual", "virtual-machine"],
  // Windows-on-ARM laptops expose Adreno through Direct3D: that is still a desktop.
  [/Direct3D|D3D1\d|D3D9/i, "desktop", "direct3d"],
  [/Adreno\s*\(?T?M?\)?\s*X\d|Snapdragon\(R\) X/i, "desktop", "snapdragon-x"],
  [/Adreno/i, "mobile", "adreno"],
  [/Immortalis/i, "mobile", "immortalis"],
  [/Mali/i, "mobile", "mali"],
  [/PowerVR|Imagination|\bIMG\b/i, "mobile", "powervr"],
  [/Xclipse/i, "mobile", "xclipse"],
  [/Maleoon/i, "mobile", "maleoon"],
  [/Vivante|\bGC\d{3,4}\b/i, "mobile", "vivante"],
  [/Tegra/i, "mobile", "tegra"],
  [/Apple A\d+/i, "mobile", "apple-a-series"],
  [/Apple M\d+|ANGLE Metal Renderer: Apple/i, "desktop", "apple-silicon"],
  [/Apple GPU/i, "apple", "apple-gpu"],
  [/NVIDIA|GeForce|Quadro|RTX|GTX|NVS/i, "desktop", "nvidia"],
  [/AMD|Radeon|\bATI\b|FirePro|RDNA/i, "desktop", "amd"],
  [/Intel|Iris|UHD Graphics|HD Graphics|Arc\(TM\)/i, "desktop", "intel"],
];

export function classifyGpu(renderer?: string | null, vendor?: string | null): GpuInfo {
  const s = `${renderer ?? ""} ${vendor ?? ""}`.trim();
  if (!s) return { class: "unknown", family: "unknown", label: "Unavailable" };
  for (const [re, cls, family] of RULES) {
    if (re.test(s)) return { class: cls, family, label: cleanRenderer(renderer ?? vendor ?? s) };
  }
  return { class: "unknown", family: "unknown", label: cleanRenderer(renderer ?? s) };
}

/** Strip ANGLE wrapping: "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)" → "Adreno (TM) 740". */
export function cleanRenderer(r: string): string {
  const m = r.match(/^ANGLE \(([^,]+),\s*(.+?)(?:,\s*[^,]*(?:OpenGL|Vulkan|Direct3D|D3D|Metal)[^,]*)?\)$/i);
  if (m) return m[2].replace(/\s*\(0x[0-9a-f]+\)/gi, "").replace(/ANGLE Metal Renderer:\s*/i, "").trim();
  return r.trim();
}

/** WebGPU adapter vendor strings (adapter.info.vendor) grouped the same way. */
export function classifyWebGpuVendor(vendor: string, architecture: string): GpuClass {
  const v = `${vendor} ${architecture}`.toLowerCase();
  if (/swiftshader|google/.test(v) && /swiftshader/.test(v)) return "software";
  if (/qualcomm|arm\b|^arm|img-tec|imagination|samsung|mali|adreno|valhall|bifrost/.test(v)) return "mobile";
  if (/apple/.test(v)) return "apple";
  if (/nvidia|amd|intel|microsoft/.test(v)) return "desktop";
  return "unknown";
}
