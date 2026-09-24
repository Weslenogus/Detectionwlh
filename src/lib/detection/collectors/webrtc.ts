import type { WebRtcSignals } from "../types";
import { errorMessage } from "../util/safe";

const STUN = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

/**
 * Gathers ICE candidates against public STUN servers. The server-reflexive
 * (srflx) address is the public IP seen over UDP; an HTTP-only proxy or many
 * VPN/"residential proxy" setups leave it different from the IP the web
 * server sees. Host candidates are only counted (mDNS-obfuscated anyway).
 */
export function collectWebRtc(timeoutMs = 2500): Promise<WebRtcSignals> {
  const t0 = performance.now();
  const Pc = (window as unknown as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  if (!Pc) return Promise.resolve({ supported: false, durationMs: 0, candidateTypes: [], srflxIps: [], hostCandidates: 0, mdnsHost: false });
  return new Promise((resolve) => {
    const types = new Set<string>();
    const srflx = new Set<string>();
    let host = 0;
    let mdns = false;
    let pc: RTCPeerConnection | null = null;
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      resolve({
        supported: true,
        error,
        durationMs: Math.round(performance.now() - t0),
        candidateTypes: [...types],
        srflxIps: [...srflx],
        hostCandidates: host,
        mdnsHost: mdns,
      });
    };
    try {
      pc = new Pc({ iceServers: [{ urls: STUN }] });
      pc.createDataChannel("probe");
      pc.onicecandidate = (e) => {
        if (!e.candidate) return finish();
        const parts = e.candidate.candidate.split(" ");
        const address = e.candidate.address ?? parts[4] ?? "";
        const type = e.candidate.type ?? parts[parts.indexOf("typ") + 1] ?? "unknown";
        types.add(type);
        if (type === "srflx" && address) srflx.add(address);
        if (type === "host") {
          host++;
          if (address.endsWith(".local")) mdns = true;
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc?.iceGatheringState === "complete") finish();
      };
      pc.createOffer()
        .then((o) => pc!.setLocalDescription(o))
        .catch((e) => finish(errorMessage(e)));
      setTimeout(() => finish(), timeoutMs);
    } catch (e) {
      finish(errorMessage(e));
    }
  });
}
