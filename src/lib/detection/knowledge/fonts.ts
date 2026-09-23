/**
 * System-font markers. Fonts are detected by glyph metrics, so they reveal the
 * *host OS* even when the user agent, screen and touch points are emulated.
 */

export const WINDOWS_FONTS = [
  "Segoe UI",
  "Calibri",
  "Cambria",
  "Consolas",
  "Candara",
  "Corbel",
  "Constantia",
  "Ebrima",
  "Gadugi",
  "Nirmala UI",
  "Leelawadee UI",
  "Sylfaen",
  "MS Gothic",
  "Yu Gothic",
  "Microsoft YaHei",
  "Malgun Gothic",
  "Segoe UI Emoji",
];

export const APPLE_FONTS = [
  "Helvetica Neue",
  "Avenir",
  "Avenir Next",
  "Menlo",
  "Hiragino Sans",
  "PingFang SC",
  "Apple SD Gothic Neo",
  "Gill Sans",
  "Optima",
  "Didot",
  "Futura",
  "Snell Roundhand",
  "Kailasa",
];

/** Present on macOS but not iOS (useful when an "iPhone" is really a Mac in responsive mode). */
export const MACOS_ONLY_FONTS = ["Monaco", "Apple Chancery", "Herculanum", "Luminari", "Trattatello", "Skia"];

export const ANDROID_FONTS = [
  "Roboto",
  "Noto Color Emoji",
  "Cutive Mono",
  "Coming Soon",
  "Dancing Script",
  "Carrois Gothic SC",
  "Droid Sans Mono",
  "sans-serif-condensed",
  "sans-serif-smallcaps",
];

export const LINUX_DESKTOP_FONTS = ["DejaVu Sans", "Liberation Sans", "Ubuntu", "Cantarell", "Liberation Mono", "Noto Sans Mono"];

export const ALL_PROBE_FONTS = Array.from(
  new Set([...WINDOWS_FONTS, ...APPLE_FONTS, ...MACOS_ONLY_FONTS, ...ANDROID_FONTS, ...LINUX_DESKTOP_FONTS, "Arial", "Times New Roman", "Courier New", "Verdana", "Georgia", "Tahoma", "Trebuchet MS"]),
);

export function countFamily(detected: string[], family: string[]): number {
  const set = new Set(detected);
  return family.filter((f) => set.has(f)).length;
}
