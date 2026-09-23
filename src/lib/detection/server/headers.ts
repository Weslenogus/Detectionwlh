import "server-only";
import type { ServerSignals } from "../types";

const KEEP = [
  "user-agent",
  "accept",
  "accept-language",
  "accept-encoding",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-ch-ua-model",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-form-factors",
  "sec-ch-ua-wow64",
  "sec-ch-device-memory",
  "device-memory",
  "sec-ch-dpr",
  "sec-ch-viewport-width",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-gpc",
  "dnt",
  "save-data",
  "ect",
  "rtt",
  "downlink",
  "via",
  "x-forwarded-proto",
];

export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, "");
  if (/^(10\.|127\.|192\.168\.|169\.254\.)/.test(v)) return true;
  const m = v.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (v === "::1" || /^f[cd][0-9a-f]{2}:/i.test(v) || /^fe80:/i.test(v)) return true;
  return false;
}

export function extractServerSignals(headers: Headers): ServerSignals {
  const h: Record<string, string> = {};
  for (const k of KEEP) {
    const v = headers.get(k);
    if (v) h[k] = v.slice(0, 512);
  }
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || headers.get("cf-connecting-ip") || null;
  const ip = fwd ? fwd.replace(/^\[|\]$/g, "") : null;
  const ipVersion = ip ? (ip.includes(":") && !ip.startsWith("::ffff:") ? 6 : 4) : null;
  const geo = {
    country: headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? undefined,
    region: headers.get("x-vercel-ip-country-region") ?? undefined,
    city: headers.get("x-vercel-ip-city") ? decodeURIComponent(headers.get("x-vercel-ip-city")!) : undefined,
    timezone: headers.get("x-vercel-ip-timezone") ?? headers.get("cf-timezone") ?? undefined,
  };
  const ja4 = headers.get("x-vercel-ja4-digest") ?? headers.get("cf-ja4") ?? undefined;
  const ja3 = headers.get("cf-ja3-hash") ?? undefined;
  return {
    ip,
    ipVersion,
    privateIp: ip ? isPrivateIp(ip) : false,
    headers: h,
    headerOrder: [],
    geo: Object.values(geo).some(Boolean) ? geo : null,
    tls: ja4 || ja3 ? { ja4, ja3 } : null,
    receivedAt: Date.now(),
  };
}
