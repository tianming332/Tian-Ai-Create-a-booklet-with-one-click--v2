import { parsePhotoName, type PhotoNameInfo } from '../analysis/filename';
import { colorDistance } from '../analysis/color';
import type { Asset, SemanticTags } from '../../shared/types';
import { buildTextImageRelations, bestRelation } from '../relations/textImage';
import { parseTextDocument } from '../text/structure';

export interface StoryDigest {
  id: string;
  kind: 'image' | 'text';
  seq?: number;
  seqPrefix?: string;
  dev?: string;
  t?: string;
  tSrc?: 'name' | 'exif';
  tConflict?: boolean;
  place?: string;
  placeHint?: string;
  ori?: 'portrait' | 'square' | 'landscape' | 'panorama';
  luma?: number;
  hex?: string[];
  tags?: string[];
  cap?: string;
  gap?: boolean;
  dup?: boolean;
  screenshot?: boolean;
  textPreview?: string;
  boundToAssetId?: string;
  textRole?: string;
  entities?: Array<{ type: string; value: string }>;
  semantic?: SemanticTags;
  faces?: import('../../shared/types').FaceRegion[];
}

export interface StoryPlan {
  digests: StoryDigest[];
  storyOrder: string[];
  coverage: number;
  unnamedIds: string[];
}

const placeByAsset = new WeakMap<Asset, string>();

export function rememberPlace(asset: Asset, placeId: string | undefined): void {
  if (placeId) placeByAsset.set(asset, placeId);
}

export function placeOf(asset: Asset): string | undefined {
  return placeByAsset.get(asset);
}

function rgbToHex(rgb: [number, number, number] | undefined): string | undefined {
  if (!rgb) return undefined;
  return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('').slice(0, 6)}`;
}

function isoFrom(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function nameInfo(asset: Asset): PhotoNameInfo {
  return parsePhotoName(asset.meta.fileName);
}

export function isInformed(asset: Asset, info = nameInfo(asset)): boolean {
  if (asset.kind !== 'image') return false;
  if (info.seq != null || info.takenAt) return true;
  if (asset.meta.takenAtSource === 'exif' && asset.meta.takenAt) return true;
  if (placeOf(asset)) return true;
  return false;
}

export function buildDigest(asset: Asset): StoryDigest {
  if (asset.kind === 'text') {
    return {
      id: asset.id,
      kind: 'text',
      textPreview: (asset.text || asset.textFeatures?.normalized || '').slice(0, 80),
      // Keep the legacy field in the compact protocol so older gateways place
      // a strong semantic suggestion next to its image. The local Asset itself
      // remains unbound, preserving the distinction from a true caption.
      boundToAssetId: asset.boundToAssetId ?? asset.relatedToAssetId,
      textRole: asset.textBlock?.role,
      entities: asset.textBlock?.entities.slice(0, 10).map(({ type, value }) => ({ type, value })),
    };
  }
  const info = nameInfo(asset);
  const digest: StoryDigest = {
    id: asset.id,
    kind: 'image',
    ori: asset.visual?.aspectClass,
    luma: asset.visual ? Math.round(asset.visual.luma * 100) / 100 : undefined,
    hex: asset.visual?.dominantColors.slice(0, 2).map((c) => rgbToHex(c.rgb)).filter((v): v is string => Boolean(v)),
    dup: Boolean(asset.nearDuplicateOf),
  };
  if (info.seq != null) {
    digest.seq = info.seq;
    digest.seqPrefix = info.seqPrefix;
  }
  if (info.dev) digest.dev = info.dev;
  if (info.screenshot) digest.screenshot = true;
  if (info.placeHint) digest.placeHint = info.placeHint;
  const exifTime = asset.meta.takenAtSource === 'exif' ? asset.meta.takenAt : undefined;
  if (info.takenAt) {
    digest.t = isoFrom(info.takenAt);
    digest.tSrc = 'name';
    if (exifTime && Math.abs(exifTime - info.takenAt) > 24 * 60 * 60 * 1000) digest.tConflict = true;
  } else if (exifTime) {
    digest.t = isoFrom(exifTime);
    digest.tSrc = 'exif';
  }
  const place = placeOf(asset);
  if (place) digest.place = place;
  if (asset.aiTags?.length) digest.tags = asset.aiTags.slice(0, 3);
  if (asset.aiCaption) digest.cap = asset.aiCaption.slice(0, 20);
  if (asset.aiSemantic) digest.semantic = asset.aiSemantic;
  if (asset.faces?.length) digest.faces = asset.faces;
  if (!isInformed(asset, info) && !digest.tags?.length) digest.gap = true;
  return digest;
}

function colorGap(a: Asset, b: Asset): number {
  if (!a.visual || !b.visual) return 999;
  return colorDistance(a.visual, b.visual);
}

function compareInformed(a: Asset, b: Asset): number {
  const na = nameInfo(a);
  const nb = nameInfo(b);
  const prefixA = na.seqPrefix || na.dev || '';
  const prefixB = nb.seqPrefix || nb.dev || '';
  if (prefixA && prefixA === prefixB && na.seq != null && nb.seq != null) return na.seq - nb.seq;
  const ta = na.takenAt || (a.meta.takenAtSource === 'exif' ? a.meta.takenAt : undefined) || Number.MAX_SAFE_INTEGER;
  const tb = nb.takenAt || (b.meta.takenAtSource === 'exif' ? b.meta.takenAt : undefined) || Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

export function planStory(assets: Asset[], coverageThreshold = 0.5): StoryPlan {
  for (const asset of assets) {
    if (asset.kind === 'text' && !asset.textBlock) {
      const document = parseTextDocument(asset.text ?? '', asset.sourceDocumentId);
      asset.sourceDocumentId = document.id;
      asset.textBlock = document.blocks[0];
    }
  }
  const images = assets.filter((asset) => asset.kind === 'image');
  const texts = assets.filter((asset) => asset.kind === 'text');
  const informed = images.filter((asset) => isInformed(asset));
  const unnamed = images.filter((asset) => !isInformed(asset));
  const coverage = images.length ? informed.length / images.length : 1;
  const orderedInformed = [...informed].sort(compareInformed);
  const order: Asset[] = [...orderedInformed];

  const tagged = unnamed.filter((asset) => asset.aiTags?.length);
  const leftover = unnamed.filter((asset) => !asset.aiTags?.length);

  const attachNear = (orphan: Asset) => {
    if (!order.length) {
      order.push(orphan);
      return;
    }
    let best = 0;
    let bestScore = colorGap(order[0], orphan);
    for (let i = 1; i < order.length; i += 1) {
      const score = colorGap(order[i], orphan);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    order.splice(best + 1, 0, orphan);
  };

  for (const orphan of tagged) {
    const tag = orphan.aiTags![0];
    const match = order.findIndex((asset) => asset.aiTags?.includes(tag) || nameInfo(asset).placeHint === tag);
    if (match >= 0) order.splice(match + 1, 0, orphan);
    else attachNear(orphan);
  }
  leftover.sort((a, b) => (nameInfo(a).screenshot ? 1 : 0) - (nameInfo(b).screenshot ? 1 : 0) || a.id.localeCompare(b.id));
  for (const orphan of leftover) attachNear(orphan);

  const relations = buildTextImageRelations(assets);
  for (const text of texts.filter((asset) => !asset.boundToAssetId)) {
    const relation = bestRelation(relations, text.id);
    text.relatedToAssetId = relation && relation.score >= 0.45 ? relation.imageId : undefined;
  }
  const digests = [...images, ...texts].map(buildDigest);

  const storyOrder = [
    ...order.flatMap((asset) => {
      const related = texts.filter((text) => text.boundToAssetId === asset.id || text.relatedToAssetId === asset.id);
      return [asset.id, ...related.map((text) => text.id)];
    }),
    ...texts.filter((text) => !text.boundToAssetId && !text.relatedToAssetId).map((text) => text.id),
  ];
  return {
    digests,
    storyOrder,
    coverage,
    unnamedIds: coverage < coverageThreshold ? unnamed.map((asset) => asset.id) : [],
  };
}

export function needsVision(plan: StoryPlan, threshold = 0.5, maxVision = 40): string[] {
  if (plan.coverage >= threshold) return [];
  return plan.unnamedIds.slice(0, maxVision);
}
