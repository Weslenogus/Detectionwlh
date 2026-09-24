import { ALL_PROBE_FONTS } from "../knowledge/fonts";
import type { FingerprintSignals } from "../types";
import { hash128, hashBytes } from "../util/hash";
import { attempt, withTimeout } from "../util/safe";

function canvasHash(): string | null {
  const c = document.createElement("canvas");
  c.width = 280;
  c.height = 60;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.textBaseline = "alphabetic";
  const grad = ctx.createLinearGradient(0, 0, 280, 0);
  grad.addColorStop(0, "#ff2d55");
  grad.addColorStop(0.5, "#5ac8fa");
  grad.addColorStop(1, "#34c759");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 280, 60);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
  ctx.beginPath();
  ctx.arc(60, 30, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.font = "18px 'Times New Roman', serif";
  ctx.fillStyle = "#101010";
  ctx.fillText("Cwm fjordbank glyphs vext quiz ✓", 8, 24);
  ctx.font = "italic 15px sans-serif";
  ctx.strokeStyle = "rgba(0,0,120,0.6)";
  ctx.strokeText("ƒingerprint Ω≈ç√∫ 1.618", 12, 50);
  return hash128(c.toDataURL());
}

function emojiHash(): string | null {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 40;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.font = "32px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("😀🫠🧑‍💻🦄🇺🇳", 0, 0);
  return hashBytes(ctx.getImageData(0, 0, 200, 40).data, 3);
}

function mathHash(): string {
  const vals = [
    Math.acos(0.123124234234234),
    Math.acosh(1e308),
    Math.asin(0.123124234234234),
    Math.asinh(1),
    Math.atanh(0.5),
    Math.atan(2),
    Math.cbrt(100),
    Math.cos(21 * Math.LN2),
    Math.cosh(1),
    Math.exp(1),
    Math.expm1(1),
    Math.log1p(10),
    Math.sin(-1e300),
    Math.sinh(1),
    Math.tan(-1e300),
    Math.tanh(1),
    Math.pow(Math.PI, -100),
  ];
  return hash128(vals.join(","));
}

async function offlineAudioHash(): Promise<string | null> {
  const w = window as unknown as Record<string, unknown>;
  const OAC = (w.OfflineAudioContext ?? w.webkitOfflineAudioContext) as typeof OfflineAudioContext | undefined;
  if (!OAC) return null;
  const ctx = new OAC(1, 5000, 44100);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50;
  comp.knee.value = 40;
  comp.ratio.value = 12;
  comp.attack.value = 0;
  comp.release.value = 0.25;
  osc.connect(comp);
  comp.connect(ctx.destination);
  osc.start(0);
  const buf = await withTimeout(ctx.startRendering(), 2000, "audio render");
  const data = buf.getChannelData(0);
  let sum = 0;
  for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
  return hash128(sum.toString());
}

async function audioContextInfo(): Promise<FingerprintSignals["audio"]> {
  const w = window as unknown as Record<string, unknown>;
  const AC = (w.AudioContext ?? w.webkitAudioContext) as typeof AudioContext | undefined;
  const empty = { sampleRate: null, baseLatency: null, outputLatency: null, maxChannelCount: null, state: null };
  if (!AC) return empty;
  try {
    const ctx = new AC();
    const out = {
      sampleRate: ctx.sampleRate ?? null,
      baseLatency: typeof ctx.baseLatency === "number" ? ctx.baseLatency : null,
      outputLatency: typeof ctx.outputLatency === "number" ? ctx.outputLatency : null,
      maxChannelCount: ctx.destination?.maxChannelCount ?? null,
      state: ctx.state ?? null,
    };
    void ctx.close().catch(() => undefined);
    return out;
  } catch {
    return empty;
  }
}

function detectFonts(): string[] {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return [];
  const text = "mmmmmmmmmmlli1WWWQ@#%&ÅÉ";
  const bases = ["monospace", "sans-serif", "serif"];
  const measure = (font: string) => {
    ctx.font = font;
    const m = ctx.measureText(text);
    return `${m.width.toFixed(3)}|${((m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0)).toFixed(3)}`;
  };
  const baseline = bases.map((b) => measure(`72px ${b}`));
  return ALL_PROBE_FONTS.filter((font) => bases.some((b, i) => measure(`72px "${font}", ${b}`) !== baseline[i]));
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = (window as unknown as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = attempt(() => synth.getVoices(), []);
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(attempt(() => synth.getVoices(), []));
    const id = setTimeout(done, 1200);
    synth.addEventListener?.(
      "voiceschanged",
      () => {
        clearTimeout(id);
        done();
      },
      { once: true },
    );
  });
}

export async function collectFingerprint(): Promise<FingerprintSignals & { audioStable: boolean | null }> {
  const [audioA, audioB, audio, voices] = await Promise.all([
    offlineAudioHash().catch(() => null),
    offlineAudioHash().catch(() => null),
    audioContextInfo(),
    loadVoices(),
  ]);
  const fonts = attempt(detectFonts, []);
  const voiceNames = voices.map((v) => v.name);
  return {
    canvasHash: attempt(canvasHash, null),
    webglHash: null, // filled in by the orchestrator from the GPU render probe
    audioHash: audioA,
    audio,
    fonts,
    voices: {
      count: voices.length,
      names: voiceNames.slice(0, 24),
      localMicrosoft: voices.filter((v) => v.localService && /^Microsoft /.test(v.name) && !/Online|Natural/.test(v.name)).length,
      google: voices.filter((v) => /^Google /.test(v.name)).length,
      apple: voices.filter((v) => /com\.apple\./.test(v.voiceURI)).length,
      defaultVoice: voices.find((v) => v.default)?.name ?? null,
    },
    emojiHash: attempt(emojiHash, null),
    mathHash: attempt(mathHash, null),
    visitorId: null,
    audioStable: audioA && audioB ? audioA === audioB : null,
  };
}
