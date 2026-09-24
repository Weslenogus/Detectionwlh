import "server-only";
import type { IpIntel } from "../types";
import { errorMessage } from "../util/safe";

/**
 * IP reputation, Persona-style: mobile carrier vs datacenter vs VPN/proxy/Tor.
 *
 *  - ipapi.is: with IPAPI_IS_KEY you get is_vpn / is_proxy / is_tor /
 *    is_datacenter / is_mobile / is_abuser; without a key only ASN + geo, which
 *    are classified with the heuristics below.
 *  - Tor Project bulk exit list (cached for an hour).
 * Set IP_INTEL=off to disable all outbound lookups.
 */

const HOSTING =
  /amazon|\baws\b|google cloud|microsoft|azure|digitalocean|\bovh|hetzner|linode|akamai|vultr|choopa|oracle|alibaba|tencent|huawei cloud|m247|datacamp|leaseweb|contabo|scaleway|hostinger|ionos|rackspace|packet|equinix|hostwinds|colocrossing|psychz|quadranet|servers\.com|kamatera|upcloud|netcup|\bvpn\b|proxy|hosting|data ?cent(er|re)|\bserver/i;
const MOBILE =
  /mobile|mobility|wireless|cellular|\blte\b|t-mobile|verizon wireless|cricket|metro ?pcs|us cellular|jio|airtel|rogers|freedom mobile|telstra|optus|singtel|docomo|kddi|softbank|turkcell|megafon|beeline|telkomsel|indosat|viettel|safaricom|\bmtn\b|etisalat|\bzain\b|globe telecom|smart communications/i;

const cache = new Map<string, { at: number; value: IpIntel }>();
let tor: { at: number; set: Set<string> } | null = null;
const HOUR = 3_600_000;

async function fetchJson(url: string, ms: number): Promise<unknown> {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(id);
  }
}

async function torExits(): Promise<Set<string> | null> {
  if (tor && Date.now() - tor.at < HOUR) return tor.set;
  try {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch("https://check.torproject.org/torbulkexitlist", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(id);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    tor = { at: Date.now(), set: new Set((await r.text()).split(/\s+/).filter(Boolean)) };
    return tor.set;
  } catch {
    return tor?.set ?? null;
  }
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

/** Parse both the keyed (nested) and the keyless (flat) ipapi.is formats. */
export function parseIpapi(j: Raw): IpIntel {
  const asnObj = (j.asn && typeof j.asn === "object" ? j.asn : null) as Raw | null;
  const loc = (j.location && typeof j.location === "object" ? j.location : null) as Raw | null;
  const company = (j.company && typeof j.company === "object" ? j.company : null) as Raw | null;
  const asn = asnObj ? (asnObj.asn ? `AS${asnObj.asn}` : null) : str(j.asn)?.split(" ")[0] ?? null;
  const org = asnObj ? str(asnObj.org) ?? str(company?.name) : str(j.asn)?.split(" ").slice(1).join(" ") || str(j.company);
  const orgText = `${org ?? ""} ${str(j.company) ?? str(company?.name) ?? ""}`;
  const keyed = typeof j.is_datacenter === "boolean";
  const asnType = str(asnObj?.type) ?? str(company?.type);
  return {
    provider: "ipapi.is",
    source: keyed ? "api" : "heuristic",
    asn,
    org,
    country: str(loc?.country) ?? str(j.country),
    city: str(loc?.city) ?? str(j.city),
    lat: num(loc?.latitude) ?? num(j.lat),
    lon: num(loc?.longitude) ?? num(j.lon),
    timezone: str(loc?.timezone) ?? str(j.timezone),
    isMobile: keyed ? bool(j.is_mobile) : MOBILE.test(orgText) ? true : null,
    isDatacenter: keyed ? bool(j.is_datacenter) : asnType === "hosting" || HOSTING.test(orgText) ? true : null,
    isVpn: keyed ? bool(j.is_vpn) : /\bvpn\b/i.test(orgText) ? true : null,
    isProxy: keyed ? bool(j.is_proxy) : null,
    isTor: keyed ? bool(j.is_tor) : null,
    isAbuser: keyed ? bool(j.is_abuser) : null,
  };
}

export async function lookupIp(ip: string | null, isPrivate: boolean): Promise<IpIntel | null> {
  if (!ip || isPrivate || process.env.IP_INTEL === "off") return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  const key = process.env.IPAPI_IS_KEY;
  const url = `https://api.ipapi.is/?q=${encodeURIComponent(ip)}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
  let value: IpIntel;
  try {
    const [j, exits] = await Promise.all([fetchJson(url, 2500), torExits()]);
    value = parseIpapi(j as Raw);
    if (exits) value.isTor = exits.has(ip) || value.isTor === true;
  } catch (e) {
    const exits = await torExits();
    value = {
      provider: "ipapi.is",
      source: "heuristic",
      asn: null,
      org: null,
      country: null,
      city: null,
      lat: null,
      lon: null,
      timezone: null,
      isMobile: null,
      isDatacenter: null,
      isVpn: null,
      isProxy: null,
      isTor: exits ? exits.has(ip) : null,
      isAbuser: null,
      error: errorMessage(e),
    };
  }
  if (cache.size > 5000) cache.clear();
  cache.set(ip, { at: Date.now(), value });
  return value;
}

export { haversineKm } from "../util/geo";
