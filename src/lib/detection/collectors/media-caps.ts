import type { MediaCapsSignals } from "../types";
import { attempt, withTimeout } from "../util/safe";

/**
 * Hardware video decoders: every phone decodes H.264 in silicon
 * (powerEfficient = true). Software-only stacks — headless browsers, CPU
 * rasterisers, most emulators — report powerEfficient = false.
 */
const CONFIGS: Record<string, string> = {
  "h264-1080p": 'video/mp4; codecs="avc1.640028"',
  "hevc-1080p": 'video/mp4; codecs="hvc1.1.6.L120.90"',
  "vp9-1080p": 'video/webm; codecs="vp09.00.40.08"',
  "av1-1080p": 'video/mp4; codecs="av01.0.08M.08"',
};

export async function collectMediaCaps(): Promise<MediaCapsSignals> {
  const mc = (navigator as unknown as { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
  const decode: MediaCapsSignals["decode"] = {};
  if (mc?.decodingInfo) {
    await Promise.all(
      Object.entries(CONFIGS).map(async ([k, contentType]) => {
        try {
          const r = await withTimeout(
            mc.decodingInfo({ type: "file", video: { contentType, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 } }),
            1500,
          );
          decode[k] = { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
        } catch {
          decode[k] = null;
        }
      }),
    );
  }
  const rtcVideoCodecs = attempt(() => {
    const caps = (window as unknown as { RTCRtpReceiver?: typeof RTCRtpReceiver }).RTCRtpReceiver?.getCapabilities?.("video");
    return Array.from(new Set((caps?.codecs ?? []).map((c) => c.mimeType.replace(/^video\//, "")))).filter((c) => !/rtx|red|ulpfec|flexfec/i.test(c));
  }, [] as string[]);
  return { supported: Boolean(mc?.decodingInfo), decode, rtcVideoCodecs };
}
