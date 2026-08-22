import { VISUAL_THRESHOLDS } from '../../shared/constants';
import type { AspectClass, DominantColor, VisualFeatures } from '../../shared/types';
import { kMeansLab, luminance, rgbToLab, saturationOf } from './color';

export interface PixelSource {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export function classifyAspect(aspect: number): AspectClass {
  if (aspect >= VISUAL_THRESHOLDS.panoramaAspect) return 'panorama';
  if (aspect > 1.15) return 'landscape';
  if (aspect < 0.87) return 'portrait';
  return 'square';
}

export interface PixelStats {
  luma: number;
  saturation: number;
  contrast: number;
  entropy: number;
  dominantColors: DominantColor[];
  hasAlpha: boolean;
}

/**
 * Pure pixel statistics over a small thumbnail (96px long edge).
 * Nearly transparent pixels are ignored so PNG cut-outs do not skew colours.
 */
export function analyzePixels(source: PixelSource, k = 4): PixelStats {
  const { data } = source;
  const lumas: number[] = [];
  const labs = [];
  let satSum = 0;
  let hasAlpha = false;
  const histogram = new Array<number>(64).fill(0);
  let counted = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 250) hasAlpha = true;
    if (alpha < 24) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = luminance(r, g, b);
    lumas.push(lum);
    satSum += saturationOf(r, g, b);
    labs.push(rgbToLab(r, g, b));
    histogram[Math.min(63, Math.floor(lum * 64))] += 1;
    counted += 1;
  }

  if (counted === 0) {
    return { luma: 1, saturation: 0, contrast: 0, entropy: 0, dominantColors: [], hasAlpha };
  }

  const mean = lumas.reduce((a, b) => a + b, 0) / counted;
  const variance = lumas.reduce((acc, v) => acc + (v - mean) ** 2, 0) / counted;
  const sorted = [...lumas].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(counted * 0.1)];
  const p90 = sorted[Math.min(counted - 1, Math.floor(counted * 0.9))];
  const contrast = Math.max(Math.sqrt(variance) * 2, p90 - p10);

  let entropy = 0;
  for (const bin of histogram) {
    if (bin === 0) continue;
    const p = bin / counted;
    entropy -= p * Math.log2(p);
  }

  return {
    luma: mean,
    saturation: satSum / counted,
    contrast: Math.min(1, contrast),
    entropy: entropy / 6,
    dominantColors: kMeansLab(labs, { k }),
    hasAlpha,
  };
}

export function buildVisualFeatures(input: {
  widthPx: number;
  heightPx: number;
  stats: PixelStats;
  dHash: string;
}): VisualFeatures {
  const aspectRatio = input.widthPx / input.heightPx;
  return {
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    aspectRatio,
    aspectClass: classifyAspect(aspectRatio),
    luma: input.stats.luma,
    saturation: input.stats.saturation,
    contrast: input.stats.contrast,
    entropy: input.stats.entropy,
    dominantColors: input.stats.dominantColors,
    dHash: input.dHash,
    hasAlpha: input.stats.hasAlpha,
  };
}

export function isDark(f: VisualFeatures): boolean {
  return f.luma < VISUAL_THRESHOLDS.darkLuma;
}

export function isBright(f: VisualFeatures): boolean {
  return f.luma > VISUAL_THRESHOLDS.brightLuma;
}

export function isLowSaturation(f: VisualFeatures): boolean {
  return f.saturation < VISUAL_THRESHOLDS.lowSaturation;
}

/** Grayscale grid for dHash, computed from an already downscaled 9x8 source. */
export function toGrayscale(source: PixelSource): number[] {
  const out = new Array<number>(source.width * source.height);
  for (let i = 0, p = 0; i < source.data.length; i += 4, p += 1) {
    out[p] = 0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2];
  }
  return out;
}
