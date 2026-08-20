import { colorSimilarity } from '../analysis/color';
import { perceptualSimilarity } from '../analysis/hash';
import { textSimilarity } from '../analysis/text';
import type { Asset, VisualFeatures } from '../../shared/types';

/** 30 minutes: photos inside this window usually belong to one scene. */
const TIME_TAU_MS = 30 * 60 * 1000;

export function timeSimilarity(a?: number, b?: number): number {
  if (a == null || b == null) return 0.5; // unknown time must not dominate
  return Math.exp(-Math.abs(a - b) / TIME_TAU_MS);
}

export function aspectCompatibility(a: VisualFeatures, b: VisualFeatures): number {
  const ratio = Math.log(a.aspectRatio / b.aspectRatio);
  return Math.max(0, 1 - Math.abs(ratio) / Math.log(3));
}

export function importAdjacency(indexA: number, indexB: number, window = 8): number {
  const distance = Math.abs(indexA - indexB);
  return Math.max(0, 1 - distance / (window + 1));
}

export interface SimilarityWeights {
  color: number;
  time: number;
  perceptual: number;
  aspect: number;
  adjacency: number;
}

export const DEFAULT_IMAGE_WEIGHTS: SimilarityWeights = {
  color: 0.5,
  time: 0.2,
  perceptual: 0.1,
  aspect: 0.1,
  adjacency: 0.1,
};

/** Spec 7.2. Weights are renormalised so custom colour/time sliders stay in 0..1. */
export function imageSimilarity(a: Asset, b: Asset, weights = DEFAULT_IMAGE_WEIGHTS, window = 8): number {
  if (!a.visual || !b.visual) return 0;
  const total = weights.color + weights.time + weights.perceptual + weights.aspect + weights.adjacency;
  const score =
    weights.color * colorSimilarity(a.visual, b.visual) +
    weights.time * timeSimilarity(a.meta.takenAt, b.meta.takenAt) +
    weights.perceptual * perceptualSimilarity(a.visual.dHash, b.visual.dHash) +
    weights.aspect * aspectCompatibility(a.visual, b.visual) +
    weights.adjacency * importAdjacency(a.importIndex, b.importIndex, window);
  return score / total;
}

/** Spec 7.3: score of attaching a free text asset to an image group. */
export function mixedSimilarity(
  text: Asset,
  group: Asset[],
  options: { window?: number } = {},
): number {
  if (text.boundToAssetId) return 1;
  if (!text.textFeatures || group.length === 0) return 0;
  const window = options.window ?? 8;
  const texts = group.filter((a) => a.kind === 'text' && a.textFeatures);
  const images = group.filter((a) => a.kind === 'image');

  const textScore = texts.length
    ? Math.max(...texts.map((t) => textSimilarity(text.textFeatures!, t.textFeatures!)))
    : 0;
  const visualFit = images.length ? 0.5 : 0;
  const temporal = images.length
    ? Math.max(...images.map((i) => timeSimilarity(text.meta.takenAt, i.meta.takenAt)))
    : 0.5;
  const adjacency = Math.max(
    ...group.map((a) => importAdjacency(text.importIndex, a.importIndex, window)),
  );

  return 0.4 * visualFit + 0.35 * textScore + 0.15 * temporal + 0.1 * adjacency;
}

export function pairSimilarity(a: Asset, b: Asset, weights = DEFAULT_IMAGE_WEIGHTS, window = 8): number {
  if (a.kind === 'image' && b.kind === 'image') return imageSimilarity(a, b, weights, window);
  if (a.kind === 'text' && b.kind === 'text' && a.textFeatures && b.textFeatures) {
    return textSimilarity(a.textFeatures, b.textFeatures, importAdjacency(a.importIndex, b.importIndex, window));
  }
  const text = a.kind === 'text' ? a : b;
  const image = a.kind === 'text' ? b : a;
  return mixedSimilarity(text, [image], { window });
}
