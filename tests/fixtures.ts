import type { Asset, VisualFeatures } from '../src/shared/types';

export interface FakeImageOptions {
  aspect?: number;
  luma?: number;
  saturation?: number;
  takenAt?: number;
  dHash?: string;
  lab?: { l: number; a: number; b: number };
}

export function fakeImage(index: number, options: FakeImageOptions = {}): Asset {
  const aspect = options.aspect ?? 1.5;
  const luma = options.luma ?? 0.5;
  const lab = options.lab ?? { l: luma * 100, a: 4, b: -6 };
  const visual: VisualFeatures = {
    widthPx: Math.round(3000 * (aspect >= 1 ? 1 : aspect)),
    heightPx: Math.round(3000 * (aspect >= 1 ? 1 / aspect : 1)),
    aspectRatio: aspect,
    aspectClass: aspect >= 1.9 ? 'panorama' : aspect > 1.15 ? 'landscape' : aspect < 0.87 ? 'portrait' : 'square',
    luma,
    saturation: options.saturation ?? 0.4,
    contrast: 0.5,
    entropy: 0.6,
    dominantColors: [
      { lab, rgb: [120, 120, 120], weight: 0.7 },
      { lab: { l: lab.l * 0.6, a: lab.a, b: lab.b }, rgb: [60, 60, 60], weight: 0.3 },
    ],
    dHash: options.dHash ?? (index % 2 === 0 ? 'f0f0f0f0f0f0f0f0' : '0f0f0f0f0f0f0f0f'),
    hasAlpha: false,
  };
  return {
    id: `img${index}`,
    kind: 'image',
    importIndex: index,
    meta: {
      fileName: `photo-${index}.jpg`,
      widthPx: visual.widthPx,
      heightPx: visual.heightPx,
      takenAt: options.takenAt,
      takenAtSource: options.takenAt ? 'exif' : 'none',
    },
    visual,
    analysisStatus: 'done',
    warnings: [],
  };
}

export function fakeText(index: number, text: string, boundToAssetId?: string): Asset {
  return {
    id: `txt${index}`,
    kind: 'text',
    importIndex: index,
    meta: {},
    text,
    boundToAssetId,
    textFeatures: {
      normalized: text,
      charCount: text.length,
      lengthClass: text.length <= 12 ? 'label' : text.length <= 45 ? 'short' : 'medium',
      tokens: [text],
      tfidf: { [text]: 1 },
      keywords: [text],
      specialTokens: [],
      cjkRatio: 1,
    },
    analysisStatus: 'done',
    warnings: [],
  };
}
