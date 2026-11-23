/** FNV-1a style 32-bit hash over integers, for determinism checks. */
export const HASH_SEED = 0x811c9dc5;

export function hashInt(h: number, n: number): number {
  // Mix all 32 bits of n, one byte at a time.
  let v = n | 0;
  for (let i = 0; i < 4; i++) {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    v >>>= 8;
  }
  return h >>> 0;
}

export function hashString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = hashInt(h, s.charCodeAt(i));
  return hashInt(h, s.length);
}
