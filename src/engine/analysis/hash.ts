/**
 * dHash: horizontal gradient hash over a 9x8 grayscale grid → 64 bits.
 * Hex string form keeps it JSON/IndexedDB friendly.
 */
export function computeDHash(gray: ArrayLike<number>, width = 9, height = 8): string {
  let bits = '';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      bits += gray[y * width + x] < gray[y * width + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

const HEX_BITS = new Map<string, number>();
for (let i = 0; i < 16; i += 1) {
  HEX_BITS.set(i.toString(16), (i.toString(2).match(/1/g) ?? []).length);
}

/** Hamming distance between two hex hashes of equal length. */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += HEX_BITS.get(x.toString(16)) ?? 0;
  }
  return distance;
}

/** 1 at identical, 0 at fully different. */
export function perceptualSimilarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  return 1 - hashDistance(a, b) / 64;
}
