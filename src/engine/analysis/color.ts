import type { DominantColor, LabColor } from '../../shared/types';

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0-255) → CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): LabColor {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(lab: LabColor): [number, number, number] {
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const rl = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const gl = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const bl = x * 0.0557 + y * -0.204 + z * 1.057;
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return [enc(rl), enc(gl), enc(bl)];
}

/** Simplified ΔE76 — enough discrimination at 200-asset scale (spec 5.4). */
export function deltaE76(a: LabColor, b: LabColor): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Perceptual luminance 0..1 from linear RGB. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** HSV saturation, 0..1. */
export function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

interface KMeansOptions {
  k: number;
  maxIterations?: number;
}

/**
 * K-Means over Lab pixels. Deterministic seeding (evenly spaced by luminance
 * order) so repeated analysis of the same image yields identical clusters.
 */
export function kMeansLab(pixels: LabColor[], options: KMeansOptions): DominantColor[] {
  const k = Math.min(options.k, pixels.length);
  if (k === 0) return [];
  const maxIterations = options.maxIterations ?? 12;
  const sorted = [...pixels].sort((p, q) => p.l - q.l || p.a - q.a || p.b - q.b);
  let centroids: LabColor[] = Array.from({ length: k }, (_, i) => {
    const idx = Math.floor(((i + 0.5) / k) * sorted.length);
    return { ...sorted[Math.min(idx, sorted.length - 1)] };
  });
  let assignment = new Array<number>(pixels.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter += 1) {
    let moved = false;
    for (let i = 0; i < pixels.length; i += 1) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = deltaE76(pixels[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best;
        moved = true;
      }
    }
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < pixels.length; i += 1) {
      const s = sums[assignment[i]];
      s.l += pixels[i].l;
      s.a += pixels[i].a;
      s.b += pixels[i].b;
      s.n += 1;
    }
    centroids = centroids.map((c, i) =>
      sums[i].n === 0 ? c : { l: sums[i].l / sums[i].n, a: sums[i].a / sums[i].n, b: sums[i].b / sums[i].n },
    );
    if (!moved) break;
  }

  const counts = centroids.map(() => 0);
  for (const a of assignment) counts[a] += 1;
  return centroids
    .map((lab, i) => ({ lab, rgb: labToRgb(lab), weight: counts[i] / pixels.length }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

const D_MAX = 110;

/** Weighted colour distance between two assets (spec 5.4). */
export function colorDistance(
  a: { dominantColors: DominantColor[]; luma: number; saturation: number },
  b: { dominantColors: DominantColor[]; luma: number; saturation: number },
): number {
  const weighted = weightedDeltaE(a.dominantColors, b.dominantColors);
  return (
    0.65 * weighted + 0.2 * Math.abs(a.luma - b.luma) * D_MAX + 0.15 * Math.abs(a.saturation - b.saturation) * D_MAX
  );
}

export function colorSimilarity(
  a: { dominantColors: DominantColor[]; luma: number; saturation: number },
  b: { dominantColors: DominantColor[]; luma: number; saturation: number },
): number {
  const d = colorDistance(a, b) / D_MAX;
  return Math.max(0, Math.min(1, 1 - d));
}

/** For each dominant colour of A take the closest in B, weighted by coverage. */
export function weightedDeltaE(a: DominantColor[], b: DominantColor[]): number {
  if (a.length === 0 || b.length === 0) return D_MAX;
  let total = 0;
  let weight = 0;
  for (const ca of a) {
    let min = Infinity;
    for (const cb of b) min = Math.min(min, deltaE76(ca.lab, cb.lab));
    total += min * ca.weight;
    weight += ca.weight;
  }
  return weight === 0 ? D_MAX : total / weight;
}
