/** Parse a Sec-CH-UA structured header into brand → major version pairs. */
export function parseSecChUa(h: string | undefined): { brand: string; version: string }[] {
  if (!h) return [];
  const out: { brand: string; version: string }[] = [];
  for (const m of h.matchAll(/"([^"]*)"\s*;\s*v\s*=\s*"([^"]*)"/g)) out.push({ brand: m[1], version: m[2] });
  return out;
}
