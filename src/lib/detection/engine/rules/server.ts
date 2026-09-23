import type { Add, Ctx } from "../context";

const unquote = (s: string | undefined) => (s ?? "").replace(/^"|"$/g, "");

/** Cross-checks between what the network layer saw and what JavaScript reports. */
export function serverRules(c: Ctx, add: Add) {
  const s = c.bundle.server;
  if (!s) return;
  const h = s.headers ?? {};
  const nav = c.d.navigator;

  const headerUA = h["user-agent"] ?? "";
  if (headerUA) {
    const same = headerUA === nav.userAgent;
    add({
      id: "server.ua",
      title: "HTTP User-Agent vs JavaScript",
      value: same ? "identical" : "different",
      detail: same
        ? "The network-level User-Agent header matches navigator.userAgent."
        : `The HTTP header says “${headerUA.slice(0, 90)}${headerUA.length > 90 ? "…" : ""}” — JavaScript-level UA spoofing.`,
      status: same ? "pass" : "fail",
      evidence: same ? {} : { spoofed: 2.5, phone: -2.0, tablet: -1.5 },
    });
  }
  const chMobile = h["sec-ch-ua-mobile"];
  if (chMobile && nav.uaData) {
    const hdr = chMobile === "?1";
    const same = hdr === nav.uaData.mobile;
    add({
      id: "server.ch-mobile",
      title: "Sec-CH-UA-Mobile header",
      value: chMobile,
      detail: same ? "Header agrees with navigator.userAgentData.mobile." : "Header and JavaScript disagree on the mobile flag.",
      status: same ? "pass" : "fail",
      evidence: same ? {} : { spoofed: 1.5, phone: -1.0 },
    });
  }
  const chPlatform = unquote(h["sec-ch-ua-platform"]);
  if (chPlatform && nav.uaData?.platform) {
    const same = chPlatform === nav.uaData.platform;
    add({
      id: "server.ch-platform",
      title: "Sec-CH-UA-Platform header",
      value: chPlatform,
      detail: same ? "Header agrees with JavaScript." : `JavaScript reports “${nav.uaData.platform}”.`,
      status: same ? "pass" : "fail",
      evidence: same ? {} : { spoofed: 1.5, phone: -1.0 },
    });
  }
  const chModel = unquote(h["sec-ch-ua-model"]);
  const jsModel = nav.uaData?.high?.model;
  if (chModel && jsModel && chModel !== jsModel) {
    add({
      id: "server.ch-model",
      title: "Sec-CH-UA-Model header",
      value: `${chModel} vs ${jsModel}`,
      detail: "The model announced over HTTP differs from the one reported to JavaScript.",
      status: "fail",
      evidence: { spoofed: 1.0 },
    });
  }
  const al = h["accept-language"];
  if (al && nav.language) {
    const hdr = al.split(",")[0].trim().toLowerCase().split("-")[0];
    const js = nav.language.toLowerCase().split("-")[0];
    const same = hdr === js;
    add({
      id: "server.language",
      title: "Accept-Language vs navigator.language",
      value: `${al.split(",")[0]} / ${nav.language}`,
      detail: same ? "Primary languages agree." : "The HTTP language preference differs from the JavaScript one.",
      status: same ? "info" : "warn",
      evidence: same ? {} : { spoofed: 0.5, automation: 0.3 },
    });
  }
  const geoTz = s.geo?.timezone;
  if (geoTz && nav.timezone) {
    const same = geoTz === nav.timezone;
    add({
      id: "server.geo-tz",
      title: "IP geolocation timezone",
      value: `${geoTz} vs device ${nav.timezone}`,
      detail: same ? "The device clock matches the IP's region." : "The IP address resolves to a different timezone (VPN, proxy, or spoofed timezone).",
      status: same ? "pass" : "warn",
      evidence: same ? {} : { spoofed: 0.6, automation: 0.3 },
    });
  }
  add({
    id: "server.ip",
    title: "Client address",
    value: `${s.ip ?? "unknown"}${s.ipVersion ? ` (IPv${s.ipVersion})` : ""}${s.geo?.country ? ` · ${s.geo.country}` : ""}`,
    detail: s.privateIp ? "Private / loopback address — testing on a local network." : "As seen by the server (after trusted proxies).",
    status: "info",
  });
  if (s.tls?.ja4 || s.tls?.ja3) {
    add({ id: "server.tls", title: "TLS fingerprint", value: s.tls.ja4 ?? s.tls.ja3 ?? "", detail: "Provided by the edge network.", status: "info" });
  }
}
