import type { GroupingSettings, Orientation, PageSizeId, PageSpec } from './types';
import type { Mm } from './units';

/** Appendix A defaults. Single source of truth for tuning. */
export const PARAMS = {
  maxAssets: 200,
  hardMaxAssets: 400,
  maxFileBytes: 80 * 1024 * 1024,
  maxEdgePx: 12000,
  analysisColorThumb: 96,
  previewThumb: 256,
  groupStrongThreshold: 0.68,
  groupWeakThreshold: 0.52,
  groupTargetMin: 3,
  groupTargetMax: 10,
  groupHardMax: 12,
  nearDuplicateHashDistance: 6,
  cropLossStrongPenalty: 0.42,
  cropLossHardReject: 0.6,
  undoDepth: 80,
  targetDpi: 300,
  dpiWarning: 300,
  dpiStrongWarning: 200,
  dpiError: 150,
  defaultBleed: 3,
  similarityWindow: 8,
} as const;

export const VISUAL_THRESHOLDS = {
  darkLuma: 0.32,
  brightLuma: 0.72,
  lowSaturation: 0.18,
  highSaturation: 0.55,
  panoramaAspect: 1.9,
  tallAspect: 0.62,
} as const;

export function imageWorkerConcurrency(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.min(4, Math.max(2, cores - 1));
}

export const A4: Pick<PageSpec, 'trimWidth' | 'trimHeight' | 'safeMargin' | 'gutter'> = {
  trimWidth: 210,
  trimHeight: 297,
  safeMargin: 12,
  gutter: 14,
};

export const A5: Pick<PageSpec, 'trimWidth' | 'trimHeight' | 'safeMargin' | 'gutter'> = {
  trimWidth: 148,
  trimHeight: 210,
  safeMargin: 10,
  gutter: 12,
};

export function defaultPageSpec(sizeId: PageSizeId = 'A4'): PageSpec {
  const base = pageSizePreset(sizeId) ?? PAGE_SIZES[0];
  return {
    sizeId: base.id,
    trimWidth: base.trimWidth,
    trimHeight: base.trimHeight,
    orientation: base.trimWidth > base.trimHeight ? 'landscape' : 'portrait',
    bleed: PARAMS.defaultBleed,
    safeMargin: base.safeMargin,
    gutter: base.gutter,
    targetDpi: 300,
    background: '#ffffff',
    showPageNumbers: true,
    cropMarks: false,
  };
}

export interface PageSizePreset {
  id: Exclude<PageSizeId, 'custom'>;
  label: string;
  /** Authored portrait dimensions; the orientation toggle swaps them. */
  trimWidth: Mm;
  trimHeight: Mm;
  safeMargin: Mm;
  gutter: Mm;
}

/** The open formats offered in the UI. Everything else is 'custom'. */
export const PAGE_SIZES: PageSizePreset[] = [
  { id: 'A4', label: 'A4', ...A4 },
  { id: 'A5', label: 'A5', ...A5 },
  { id: 'B5', label: 'B5', trimWidth: 176, trimHeight: 250, safeMargin: 11, gutter: 12 },
  { id: 'B4', label: 'B4', trimWidth: 250, trimHeight: 353, safeMargin: 14, gutter: 16 },
  { id: 'B3', label: 'B3', trimWidth: 353, trimHeight: 500, safeMargin: 18, gutter: 20 },
  { id: 'square', label: '1:1', trimWidth: 210, trimHeight: 210, safeMargin: 12, gutter: 14 },
  { id: 'wide', label: '16:9', trimWidth: 167, trimHeight: 297, safeMargin: 11, gutter: 12 },
];

export function pageSizePreset(id: PageSizeId): PageSizePreset | undefined {
  return PAGE_SIZES.find((preset) => preset.id === id);
}

/** Page-spec patch for a preset, keeping the book's current orientation. */
export function sizePatch(id: PageSizeId, orientation: Orientation): Partial<PageSpec> {
  const preset = pageSizePreset(id);
  if (!preset) return {};
  const long = Math.max(preset.trimWidth, preset.trimHeight);
  const short = Math.min(preset.trimWidth, preset.trimHeight);
  return {
    sizeId: preset.id,
    orientation,
    trimWidth: orientation === 'landscape' ? long : short,
    trimHeight: orientation === 'landscape' ? short : long,
    safeMargin: preset.safeMargin,
    gutter: preset.gutter,
  };
}

/** Rotating a page swaps trim dimensions; margins stay in mm. */
export function withOrientation(spec: PageSpec, orientation: PageSpec['orientation']): PageSpec {
  if (spec.orientation === orientation) return spec;
  return {
    ...spec,
    orientation,
    trimWidth: spec.trimHeight,
    trimHeight: spec.trimWidth,
  };
}

export function defaultGroupingSettings(): GroupingSettings {
  return {
    orderMode: 'standardSmart',
    groupStrength: 1,
    colorWeight: 0.5,
    timeWeight: 0.2,
    maxImagesPerGroup: PARAMS.groupTargetMax,
    allowSpreads: true,
    windowSize: PARAMS.similarityWindow,
  };
}

/** Text size defaults per role, in pt (section 10.3). */
export const TEXT_STYLES = {
  A4: {
    chapterTitle: { size: 34, lineHeight: 1.25, maxLines: 2 },
    sentence: { size: 19, lineHeight: 1.5, maxLines: 4 },
    body: { size: 10.5, lineHeight: 1.55, maxLines: 0 },
    caption: { size: 8.5, lineHeight: 1.4, maxLines: 3 },
    pageNumber: { size: 7.5, lineHeight: 1.2, maxLines: 1 },
  },
  A5: {
    chapterTitle: { size: 27, lineHeight: 1.25, maxLines: 2 },
    sentence: { size: 16, lineHeight: 1.5, maxLines: 4 },
    body: { size: 9.8, lineHeight: 1.55, maxLines: 0 },
    caption: { size: 7.8, lineHeight: 1.4, maxLines: 3 },
    pageNumber: { size: 7, lineHeight: 1.2, maxLines: 1 },
  },
} as const;

export const MIN_BODY_PT = 8.5;
