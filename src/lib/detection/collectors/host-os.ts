import type { HostOsSignals } from "../types";
import { attempt } from "../util/safe";

/**
 * Fonts that CSS `system-ui` can resolve to. The winning family identifies the
 * OS that is really rendering the page — DevTools device mode on Windows still
 * renders system-ui with Segoe UI.
 */
export const SYSTEM_UI_CANDIDATES = [
  "Segoe UI",
  "Roboto",
  "Google Sans",
  "SamsungOne",
  "HarmonyOS Sans",
  "MiSans",
  "Helvetica Neue",
  "Ubuntu",
  "Cantarell",
  "DejaVu Sans",
  "Noto Sans",
  "Liberation Sans",
  "Tahoma",
  "Arial",
] as const;

const SAMPLES = ["Mmwq Il1 0Oo gjpqy — 1234567890", "The quick brown fox, ÅÉÎ"];

function widths(ctx: CanvasRenderingContext2D, font: string): string {
  ctx.font = "72px monospace"; // reset so an unparsable font can't inherit the previous one
  ctx.font = font;
  return SAMPLES.map((s) => ctx.measureText(s).width.toFixed(2)).join("|");
}

export function collectHostOs(): HostOsSignals {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { systemUiFont: null, appleSystemFont: null, flagEmojiAsLetters: null, subpixelText: null };

  const mono = widths(ctx, "72px monospace");
  const systemUi = widths(ctx, "72px system-ui, monospace");
  const apple = widths(ctx, "72px -apple-system, monospace");
  const appleSystemFont = apple !== mono;

  let systemUiFont: string | null = null;
  if (appleSystemFont && apple === systemUi) systemUiFont = "Apple system font (SF)";
  else {
    for (const f of SYSTEM_UI_CANDIDATES) {
      if (widths(ctx, `72px "${f}", monospace`) === systemUi) {
        systemUiFont = f;
        break;
      }
    }
  }

  const flagEmojiAsLetters = attempt(() => {
    ctx.font = "48px sans-serif";
    const flag = ctx.measureText("🇺🇸").width;
    const face = ctx.measureText("😀").width;
    return face > 0 ? flag / face > 1.6 : null;
  }, null);

  // Opaque canvases get LCD (sub-pixel) text on desktop platforms: colour fringes on black text.
  const subpixelText = attempt(() => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 32;
    const x = c.getContext("2d", { alpha: false });
    if (!x) return null;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 160, 32);
    x.fillStyle = "#000";
    x.font = "15px sans-serif";
    x.fillText("mmmmwwwwllll 01", 4, 22);
    const d = x.getImageData(0, 0, 160, 32).data;
    let colored = 0;
    let inked = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) continue;
      inked++;
      if (Math.max(Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2])) > 24) colored++;
    }
    return inked > 20 ? colored / inked > 0.05 : null;
  }, null);

  return { systemUiFont, appleSystemFont, flagEmojiAsLetters, subpixelText };
}
