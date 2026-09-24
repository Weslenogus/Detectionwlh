/** Physical device knowledge: Apple screen geometry table and emulator model names. */

export interface AppleScreen {
  w: number; // CSS px, portrait
  h: number;
  dpr: number;
  models: string[];
  cutout: "none" | "notch" | "island";
}

/** iPhone logical resolutions (portrait CSS pixels) — iOS always reports screen in portrait. */
export const IPHONE_SCREENS: AppleScreen[] = [
  { w: 320, h: 568, dpr: 2, models: ["iPhone SE (1st gen)", "iPhone 5s"], cutout: "none" },
  { w: 375, h: 667, dpr: 2, models: ["iPhone SE (2nd/3rd gen)", "iPhone 6/6s/7/8"], cutout: "none" },
  { w: 414, h: 736, dpr: 3, models: ["iPhone 6/6s/7/8 Plus"], cutout: "none" },
  { w: 375, h: 812, dpr: 3, models: ["iPhone X/XS", "iPhone 11 Pro", "iPhone 12/13 mini"], cutout: "notch" },
  { w: 414, h: 896, dpr: 2, models: ["iPhone XR", "iPhone 11"], cutout: "notch" },
  { w: 414, h: 896, dpr: 3, models: ["iPhone XS Max", "iPhone 11 Pro Max"], cutout: "notch" },
  { w: 390, h: 844, dpr: 3, models: ["iPhone 12/12 Pro", "iPhone 13/13 Pro", "iPhone 14", "iPhone 16e"], cutout: "notch" },
  { w: 428, h: 926, dpr: 3, models: ["iPhone 12/13 Pro Max", "iPhone 14 Plus"], cutout: "notch" },
  { w: 393, h: 852, dpr: 3, models: ["iPhone 14 Pro", "iPhone 15/15 Pro", "iPhone 16"], cutout: "island" },
  { w: 430, h: 932, dpr: 3, models: ["iPhone 14 Pro Max", "iPhone 15 Plus/15 Pro Max", "iPhone 16 Plus"], cutout: "island" },
  { w: 402, h: 874, dpr: 3, models: ["iPhone 16 Pro", "iPhone 17", "iPhone 17 Pro"], cutout: "island" },
  { w: 440, h: 956, dpr: 3, models: ["iPhone 16 Pro Max", "iPhone 17 Pro Max"], cutout: "island" },
  { w: 420, h: 912, dpr: 3, models: ["iPhone Air"], cutout: "island" },
];

export const IPAD_SCREENS: AppleScreen[] = [
  { w: 768, h: 1024, dpr: 2, models: ["iPad (9.7\")", "iPad mini 2-5", "iPad Air 1/2"], cutout: "none" },
  { w: 810, h: 1080, dpr: 2, models: ["iPad (10.2\")"], cutout: "none" },
  { w: 820, h: 1180, dpr: 2, models: ["iPad Air (10.9\"/11\")", "iPad (10th gen+)"], cutout: "none" },
  { w: 834, h: 1112, dpr: 2, models: ["iPad Air 3", "iPad Pro 10.5\""], cutout: "none" },
  { w: 834, h: 1194, dpr: 2, models: ["iPad Pro 11\" (1st-4th gen)"], cutout: "none" },
  { w: 834, h: 1210, dpr: 2, models: ["iPad Pro 11\" (M4/M5)"], cutout: "none" },
  { w: 744, h: 1133, dpr: 2, models: ["iPad mini (6th gen+)"], cutout: "none" },
  { w: 1024, h: 1366, dpr: 2, models: ["iPad Pro 12.9\"", "iPad Air 13\""], cutout: "none" },
  { w: 1032, h: 1376, dpr: 2, models: ["iPad Pro 13\" (M4/M5)"], cutout: "none" },
];

export function matchAppleScreen(
  table: AppleScreen[],
  width: number,
  height: number,
  dpr: number,
): AppleScreen | null {
  const w = Math.min(width, height);
  const h = Math.max(width, height);
  return table.find((s) => s.w === w && s.h === h && Math.abs(s.dpr - dpr) < 0.01) ?? null;
}

/** Model identifiers used by official and third-party Android emulators / VMs. */
export const EMULATOR_MODEL_PATTERNS: [RegExp, string][] = [
  [/sdk_gphone|sdk_google|google_sdk|Android SDK built for|AOSP on IA Emulator|\bgphone\d*/i, "Android Studio emulator"],
  [/^(generic|generic_x86|generic_x86_64|generic_arm64)$/i, "Generic AOSP emulator"],
  [/vbox86|Genymotion/i, "Genymotion"],
  [/BlueStacks|\bBST\b/i, "BlueStacks"],
  [/\bNox\b|NoxPlayer/i, "NoxPlayer"],
  [/LDPlayer|ldmnq/i, "LDPlayer"],
  [/MEmu|Microvirt/i, "MEmu"],
  [/\bMuMu\b|NetEase/i, "MuMu Player (NetEase)"],
  [/Emulator|Simulator|Virtual Device/i, "Generic emulator"],
];

export function matchEmulatorModel(model: string | null | undefined): string | null {
  if (!model) return null;
  for (const [re, name] of EMULATOR_MODEL_PATTERNS) if (re.test(model)) return name;
  return null;
}

/** Very small Android model → marketing name map for the report (best effort). */
export function androidModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  if (/^Pixel/i.test(model)) return `Google ${model}`;
  if (/^SM-S9\d{2}/i.test(model)) return `Samsung Galaxy S series (${model})`;
  if (/^SM-F9\d{2}|^SM-F7\d{2}/i.test(model)) return `Samsung Galaxy Z (${model})`;
  if (/^SM-A\d{3}/i.test(model)) return `Samsung Galaxy A series (${model})`;
  if (/^SM-G9\d{2}/i.test(model)) return `Samsung Galaxy S (older, ${model})`;
  if (/^SM-X|^SM-T/i.test(model)) return `Samsung Galaxy Tab (${model})`;
  if (/^(2\d{3}[A-Z0-9]{3,}|M\d{4}|Redmi|POCO|Xiaomi|Mi )/i.test(model)) return `Xiaomi / Redmi / POCO (${model})`;
  if (/^(CPH|RMX|PH[A-Z]\d)/i.test(model)) return `OPPO / realme / OnePlus (${model})`;
  if (/^(V2\d{3}|vivo)/i.test(model)) return `vivo (${model})`;
  if (/^(moto|XT\d{4})/i.test(model)) return `Motorola (${model})`;
  return model;
}
