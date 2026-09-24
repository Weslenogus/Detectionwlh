/** Hash helpers: fast non-crypto murmur3 for fingerprints, SHA-256 when available. */

export function murmur3(input: string, seed = 0x9747b28c): string {
  let h = seed >>> 0;
  const len = input.length;
  let i = 0;
  while (i + 4 <= len) {
    let k =
      (input.charCodeAt(i) & 0xff) |
      ((input.charCodeAt(i + 1) & 0xff) << 8) |
      ((input.charCodeAt(i + 2) & 0xff) << 16) |
      ((input.charCodeAt(i + 3) & 0xff) << 24);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    i += 4;
  }
  let k = 0;
  switch (len & 3) {
    case 3:
      k ^= (input.charCodeAt(i + 2) & 0xff) << 16;
    // falls through
    case 2:
      k ^= (input.charCodeAt(i + 1) & 0xff) << 8;
    // falls through
    case 1:
      k ^= input.charCodeAt(i) & 0xff;
      k = Math.imul(k, 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      h ^= k;
  }
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 128-bit-ish hash built from four seeded murmur passes (fast, stable, non-crypto). */
export function hash128(input: string): string {
  return [0x9747b28c, 0x2f4a1d3b, 0x6c8e9f01, 0x51ab2c7d].map((s) => murmur3(input, s)).join("");
}

export function hashBytes(bytes: ArrayLike<number>, stride = 1): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += stride) s += String.fromCharCode(bytes[i] & 0xff);
  return hash128(s);
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return hash128(input);
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
