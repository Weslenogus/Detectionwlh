import type { CameraCapture, CameraSignals, FlashColor, FlashSegment } from "../types";
import { attempt, errorMessage, sleep, withTimeout } from "../util/safe";
import { isNativeMediaFn, listDevices, plainCaps, shortHash } from "./devices";
import { detectFaces } from "./face";
import { analyzeFlash, FLASH_COLORS } from "./flash";
import { analyzeFrames, analyzeNoiseMap, frameTiming, NOISE_GRID, tileOrigin, type RawFrame } from "./frame-analysis";
import type { PoseDir } from "./liveness3d";
import { runPoseChallenge, type PoseProgress } from "./pose-challenge";

export type CameraPhase = "requesting" | "warming" | "capturing" | "pose" | "rear" | "analyzing" | "done" | "error";

export interface CameraTestOptions {
  video: HTMLVideoElement;
  setFlash: (color: string | null) => void;
  sequence: FlashColor[];
  captureMs?: number;
  warmupMs?: number;
  probeRear?: boolean;
  /** Server-issued head-turn order for the active 3D liveness check; omitted/empty skips it. */
  pose?: PoseDir[];
  poseTimeoutMs?: number;
  onPose?: (p: PoseProgress) => void;
  onPhase?: (phase: CameraPhase, detail?: { progress?: number; message?: string; facing?: "front" | "rear" }) => void;
  /** Returns true once the caller no longer wants the result (e.g. component unmounted). */
  isCancelled?: () => boolean;
}

export interface CameraTestResult {
  signals: CameraSignals;
  snapshot: string | null;
}

interface WindowResult {
  frames: RawFrame[];
  stamps: number[];
  schedule: FlashSegment[];
  dropped: number;
  rvfc: boolean;
  faceCanvases: HTMLCanvasElement[];
  /** Noise-map tile mosaics, one per frame (front camera only). */
  tiles: Uint8ClampedArray[];
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { presentedFrames: number; captureTime?: number }) => void) => number;
};

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function scaledCopy(video: HTMLVideoElement, max = 320): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const c = canvas(Math.max(1, Math.round(video.videoWidth * s)), Math.max(1, Math.round(video.videoHeight * s)));
  c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

function waitFirstFrame(video: RVFCVideo, timeoutMs: number): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve) => {
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve());
      else if (video.readyState >= 2) resolve();
      else video.addEventListener("loadeddata", () => resolve(), { once: true });
    }),
    timeoutMs,
    "first video frame",
  );
}

/** Grab every new frame for `ms` milliseconds while (optionally) driving the flash challenge. */
function captureWindow(
  video: RVFCVideo,
  ms: number,
  opts: { sequence?: FlashColor[]; setFlash?: (c: string | null) => void; faces?: number; tiles?: boolean; onProgress?: (p: number) => void },
): Promise<WindowResult> {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const crop = Math.max(32, Math.min(160, Math.floor(Math.min(vw, vh) / 16) * 16));
  // Align the crop to the 16-px macroblock grid so codec blocking lands on phase 0.
  const sx = Math.floor((vw - crop) / 2 / 16) * 16;
  const sy = Math.floor((vh - crop) / 2 / 16) * 16;
  const tw = 64;
  const th = Math.max(16, Math.round((64 * vh) / vw));
  const cctx = canvas(crop, crop).getContext("2d", { willReadFrequently: true })!;
  const tctx = canvas(tw, th).getContext("2d", { willReadFrequently: true })!;
  const frames: RawFrame[] = [];
  const stamps: number[] = [];
  const schedule: FlashSegment[] = [];
  const faceCanvases: HTMLCanvasElement[] = [];
  const tiles: Uint8ClampedArray[] = [];
  const { cols, rows, size } = NOISE_GRID;
  const origins = Array.from({ length: cols * rows }, (_, t) => tileOrigin(t % cols, Math.floor(t / cols), vw, vh));
  const mctx = opts.tiles && vw >= size * cols && vh >= size * rows ? canvas(cols * size, rows * size).getContext("2d", { willReadFrequently: true }) : null;
  const faceMarks = Array.from({ length: opts.faces ?? 0 }, (_, i) => (i + 0.5) / (opts.faces ?? 1));
  let dropped = 0;
  let lastPresented: number | null = null;
  const start = performance.now();
  const seq = opts.sequence ?? [];
  const segLen = seq.length ? ms / seq.length : 0;
  let segIdx = -1;
  let raf = 0;

  const flashTick = () => {
    const now = performance.now();
    const el = now - start;
    if (el >= ms) return;
    const idx = Math.min(seq.length - 1, Math.floor(el / segLen));
    if (idx !== segIdx) {
      if (schedule.length) schedule[schedule.length - 1].end = now;
      opts.setFlash?.(FLASH_COLORS[seq[idx]]);
      schedule.push({ color: seq[idx], start: now, end: start + ms });
      segIdx = idx;
    }
    opts.onProgress?.(el / ms);
    raf = requestAnimationFrame(flashTick);
  };

  const grab = (t: number) => {
    cctx.drawImage(video, sx, sy, crop, crop, 0, 0, crop, crop);
    tctx.drawImage(video, 0, 0, tw, th);
    frames.push({
      t,
      crop: cctx.getImageData(0, 0, crop, crop).data,
      cw: crop,
      ch: crop,
      thumb: tctx.getImageData(0, 0, tw, th).data,
      tw,
      th,
    });
    stamps.push(t);
    if (mctx && tiles.length < 90) {
      // 1:1 source → destination copies: native sensor pixels, no resampling.
      origins.forEach((o, i) => mctx.drawImage(video, o.x, o.y, size, size, (i % cols) * size, Math.floor(i / cols) * size, size, size));
      tiles.push(mctx.getImageData(0, 0, cols * size, rows * size).data);
    }
    const progress = (performance.now() - start) / ms;
    if (faceMarks.length && progress >= faceMarks[0]) {
      faceMarks.shift();
      faceCanvases.push(scaledCopy(video));
    }
  };

  return new Promise<WindowResult>((resolve) => {
    let finished = false;
    const rvfc = typeof video.requestVideoFrameCallback === "function";
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      const end = performance.now();
      if (schedule.length) schedule[schedule.length - 1].end = Math.min(schedule[schedule.length - 1].end, end);
      opts.onProgress?.(1);
      resolve({ frames, stamps, schedule, dropped, rvfc, faceCanvases, tiles });
    };
    if (seq.length) flashTick();
    else {
      const tick = () => {
        opts.onProgress?.((performance.now() - start) / ms);
        if (!finished) raf = requestAnimationFrame(tick);
      };
      tick();
    }
    if (rvfc) {
      const cb = (now: number, meta: { presentedFrames: number; captureTime?: number }) => {
        if (finished) return;
        const ct = typeof meta.captureTime === "number" && Math.abs(meta.captureTime - now) < 1000 ? meta.captureTime : now;
        if (lastPresented !== null && meta.presentedFrames - lastPresented > 1) dropped += meta.presentedFrames - lastPresented - 1;
        lastPresented = meta.presentedFrames;
        attempt(() => grab(ct), undefined);
        if (performance.now() - start >= ms) finish();
        else video.requestVideoFrameCallback!(cb);
      };
      video.requestVideoFrameCallback!(cb);
    } else {
      // Fallback: poll decoded-frame counter so we only sample genuinely new frames.
      let lastCount = -1;
      const poll = () => {
        if (finished) return;
        const q = attempt(() => video.getVideoPlaybackQuality?.().totalVideoFrames ?? -1, -1);
        if (q === -1 || q !== lastCount) {
          lastCount = q;
          attempt(() => grab(performance.now()), undefined);
        }
        if (performance.now() - start >= ms) finish();
        else requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }
    setTimeout(finish, ms + 800);
  });
}

async function photoCapabilities(track: MediaStreamTrack): Promise<{ caps: Record<string, unknown> | null; error?: string }> {
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { getPhotoCapabilities(): Promise<unknown> } }).ImageCapture;
  if (!IC) return { caps: null, error: "ImageCapture unsupported" };
  try {
    const caps = await withTimeout(new IC(track).getPhotoCapabilities(), 1500, "getPhotoCapabilities");
    return { caps: plainCaps(caps) };
  } catch (e) {
    return { caps: null, error: errorMessage(e) };
  }
}

function videoFrameInfo(video: HTMLVideoElement): CameraCapture["videoFrame"] {
  const VF = (window as unknown as { VideoFrame?: new (src: HTMLVideoElement, init?: { timestamp: number }) => { format: string | null; colorSpace?: { toJSON?: () => Record<string, unknown> }; close(): void } }).VideoFrame;
  if (!VF) return null;
  try {
    const f = new VF(video, { timestamp: 0 });
    const out = { format: f.format ?? null, colorSpace: f.colorSpace?.toJSON?.() ?? null };
    f.close();
    return out;
  } catch {
    return null;
  }
}

function describeTrack(track: MediaStreamTrack): Pick<CameraCapture, "label" | "deviceId" | "groupId" | "trackConstructor" | "contentHint" | "settings" | "capabilities" | "trackStats"> {
  const settings = attempt(() => ({ ...track.getSettings() }) as Record<string, unknown>, {});
  const rawDeviceId = String(settings.deviceId ?? "");
  const rawGroupId = String(settings.groupId ?? "");
  if ("deviceId" in settings) settings.deviceId = shortHash(rawDeviceId);
  if ("groupId" in settings) settings.groupId = shortHash(rawGroupId);
  const stats = attempt(() => {
    const s = (track as unknown as { stats?: { toJSON?: () => Record<string, number> } & Record<string, number> }).stats;
    if (!s) return null;
    return s.toJSON ? s.toJSON() : { deliveredFrames: s.deliveredFrames, discardedFrames: s.discardedFrames, totalFrames: s.totalFrames };
  }, null);
  return {
    label: track.label,
    deviceId: shortHash(rawDeviceId),
    groupId: shortHash(rawGroupId),
    trackConstructor: attempt(() => Object.getPrototypeOf(track)?.constructor?.name ?? "unknown", "unknown"),
    contentHint: track.contentHint ?? "",
    settings,
    capabilities: attempt(() => (typeof track.getCapabilities === "function" ? plainCaps(track.getCapabilities()) : null), null),
    trackStats: stats,
  };
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => attempt(() => t.stop(), undefined));
}

/** getUserMedia with a timeout that never leaks: a stream that arrives late is stopped immediately. */
async function openStream(constraints: MediaStreamConstraints, timeoutMs: number) {
  const p = navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await withTimeout(p, timeoutMs, "getUserMedia");
  } catch (e) {
    p.then(stopStream, () => undefined);
    throw e;
  }
}

async function attach(video: HTMLVideoElement, stream: MediaStream) {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  await video.play().catch(() => undefined);
}

function buildCapture(
  facing: "front" | "rear",
  track: MediaStreamTrack,
  video: HTMLVideoElement,
  win: WindowResult,
  timing: { openMs: number; firstFrameMs: number | null; captureMs: number },
  photo: { caps: Record<string, unknown> | null; error?: string },
  sequence: FlashColor[] | null,
): CameraCapture {
  const { metrics, aggregate } = analyzeFrames(win.frames);
  const ft = frameTiming(win.stamps);
  return {
    facing,
    ...describeTrack(track),
    photoCapabilities: photo.caps,
    photoError: photo.error,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    timing: {
      openMs: timing.openMs,
      firstFrameMs: timing.firstFrameMs,
      captureMs: timing.captureMs,
      frames: win.frames.length,
      fps: ft.fps,
      intervalMean: ft.mean,
      intervalStd: ft.std,
      intervalCv: ft.cv,
      dropped: win.dropped,
      rvfc: win.rvfc,
    },
    metrics,
    aggregate,
    noiseMap: win.tiles.length ? analyzeNoiseMap(win.tiles) : null,
    flash: sequence ? analyzeFlash(metrics, sequence, win.schedule, aggregate?.dark ?? false) : null,
    face: null,
    videoFrame: videoFrameInfo(video),
  };
}

function classifyError(e: unknown): CameraSignals["permission"] {
  const name = (e as Error)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "no-device";
  return "error";
}

/**
 * The camera test: opens the front camera, lets auto-exposure settle, records
 * exactly `captureMs` (default 1 s) of frames while flashing the challenge
 * colours, then briefly probes the rear camera for hardware capabilities.
 */
export async function runCameraTest(opts: CameraTestOptions): Promise<CameraTestResult> {
  const captureMs = opts.captureMs ?? 1000;
  const warmupMs = opts.warmupMs ?? 450;
  const phase = opts.onPhase ?? (() => undefined);
  const video = opts.video as RVFCVideo;
  const signals: CameraSignals = {
    supported: Boolean(navigator.mediaDevices?.getUserMedia),
    permission: "unsupported",
    devicesBefore: [],
    devicesAfter: [],
    getUserMediaNative: isNativeMediaFn("getUserMedia"),
    enumerateDevicesNative: isNativeMediaFn("enumerateDevices"),
    front: null,
    rear: null,
    challengeSequence: opts.sequence,
  };
  if (!signals.supported) {
    signals.error = window.isSecureContext ? "navigator.mediaDevices.getUserMedia is not available" : "Camera requires HTTPS (insecure origin)";
    phase("error", { message: signals.error });
    return { signals, snapshot: null };
  }
  const cancelled = () => opts.isCancelled?.() === true;

  signals.devicesBefore = await listDevices();
  let stream: MediaStream | null = null;
  let snapshot: string | null = null;
  let faceCanvases: HTMLCanvasElement[] = [];
  try {
    phase("requesting", { facing: "front" });
    const t0 = performance.now();
    stream = await openStream(
      { audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } },
      30000,
    );
    signals.permission = "granted";
    if (cancelled()) throw new Error("cancelled");
    const openMs = Math.round(performance.now() - t0);
    const track = stream.getVideoTracks()[0];
    await attach(video, stream);
    phase("warming", { facing: "front" });
    const f0 = performance.now();
    await waitFirstFrame(video, 5000).catch(() => undefined);
    const firstFrameMs = Math.round(performance.now() - f0);
    await sleep(warmupMs);
    snapshot = attempt(() => scaledCopy(video, 360).toDataURL("image/jpeg", 0.82), null);

    phase("capturing", { progress: 0, facing: "front" });
    const win = await captureWindow(video, captureMs, {
      sequence: opts.sequence,
      setFlash: opts.setFlash,
      faces: 5,
      tiles: true,
      onProgress: (p) => phase("capturing", { progress: Math.min(1, p), facing: "front" }),
    });
    opts.setFlash(null);
    faceCanvases = win.faceCanvases;
    const photo = await photoCapabilities(track);
    signals.front = buildCapture("front", track, video, win, { openMs, firstFrameMs, captureMs }, photo, opts.sequence);
    // Enumerate while the stream is live: Firefox only exposes labels/ids during capture.
    signals.devicesAfter = await listDevices();

    // Active 3D liveness on the same live stream: turn the head as instructed.
    if (opts.pose?.length && !cancelled()) {
      phase("pose", { facing: "front" });
      signals.active3d = await runPoseChallenge(video, opts.pose, (p) => opts.onPose?.(p), {
        timeoutMs: opts.poseTimeoutMs,
        isCancelled: cancelled,
      }).catch((e) => ({
        status: "error" as const,
        error: errorMessage(e),
        challenge: opts.pose ?? [],
        achieved: [],
        window: null,
        frames: 0,
        track: [],
        keyFrames: { frontal: null, left: null, right: null },
      }));
    } else {
      signals.active3d = { status: "skipped", challenge: [], achieved: [], window: null, frames: 0, track: [], keyFrames: { frontal: null, left: null, right: null } };
    }
  } catch (e) {
    opts.setFlash(null);
    signals.permission = signals.permission === "granted" ? "error" : classifyError(e);
    signals.error = errorMessage(e);
    signals.errorName = (e as Error)?.name;
  } finally {
    stopStream(stream);
    video.srcObject = null;
  }

  if (!signals.devicesAfter.length) signals.devicesAfter = await listDevices();

  if (signals.permission === "granted" && opts.probeRear !== false && !cancelled()) {
    const videoInputs = signals.devicesAfter.filter((d) => d.kind === "videoinput");
    const hasOther = videoInputs.length > 1 || videoInputs.some((d) => d.facingMode?.includes("environment"));
    if (hasOther) {
      let rearStream: MediaStream | null = null;
      try {
        phase("rear", { facing: "rear" });
        const t0 = performance.now();
        rearStream = await openStream({ audio: false, video: { facingMode: { exact: "environment" } } }, 6000);
        const openMs = Math.round(performance.now() - t0);
        const track = rearStream.getVideoTracks()[0];
        const frontId = signals.front?.deviceId;
        await attach(video, rearStream);
        const f0 = performance.now();
        await waitFirstFrame(video, 4000).catch(() => undefined);
        const firstFrameMs = Math.round(performance.now() - f0);
        await sleep(200);
        const win = await captureWindow(video, 400, {});
        const photo = await photoCapabilities(track);
        const cap = buildCapture("rear", track, video, win, { openMs, firstFrameMs, captureMs: 400 }, photo, null);
        if (cap.deviceId && cap.deviceId === frontId) signals.rearError = "Rear request returned the front camera";
        else signals.rear = cap;
      } catch (e) {
        signals.rearError = errorMessage(e);
      } finally {
        stopStream(rearStream);
        video.srcObject = null;
      }
    } else {
      signals.rearError = "No second camera enumerated";
    }
  }

  if (signals.front) {
    phase("analyzing", { message: "Running face detection" });
    signals.front.face = await detectFaces(faceCanvases).catch((e) => ({
      available: false,
      error: errorMessage(e),
      framesAnalyzed: 0,
      framesWithFace: 0,
      maxFaces: 0,
      meanScore: null,
      boxes: [],
      movement: null,
    }));
  }
  phase(signals.permission === "granted" ? "done" : "error", { message: signals.error });
  return { signals, snapshot };
}
