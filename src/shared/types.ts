import type { Mm } from './units';

export type AssetKind = 'image' | 'text';

export type AspectClass = 'portrait' | 'square' | 'landscape' | 'panorama';
export type TextLengthClass = 'label' | 'short' | 'medium' | 'long' | 'tooLong';

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export interface DominantColor {
  lab: LabColor;
  /** sRGB 0-255 for UI swatches. */
  rgb: [number, number, number];
  weight: number;
}

export interface VisualFeatures {
  widthPx: number;
  heightPx: number;
  aspectRatio: number;
  aspectClass: AspectClass;
  /** Perceptual luminance mean, 0..1. */
  luma: number;
  saturation: number;
  contrast: number;
  entropy: number;
  dominantColors: DominantColor[];
  /** 64-bit dHash as a 16-char hex string. */
  dHash: string;
  hasAlpha: boolean;
  /** Subject-weighted crop focus in 0..1 image coordinates. */
  focus?: Focus;
}

export interface TextFeatures {
  normalized: string;
  charCount: number;
  lengthClass: TextLengthClass;
  tokens: string[];
  /** token -> term frequency (already L2-normalised against the corpus idf). */
  tfidf: Record<string, number>;
  keywords: string[];
  specialTokens: string[];
  cjkRatio: number;
}

export interface AssetMeta {
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
  /** Milliseconds epoch. Source is tracked so the UI can explain ordering. */
  takenAt?: number;
  takenAtSource?: 'exif' | 'fileModified' | 'none';
  exifOrientation?: number;
}

export type AnalysisStatus = 'pending' | 'analyzing' | 'done' | 'error';

export interface Asset {
  id: string;
  kind: AssetKind;
  importIndex: number;
  meta: AssetMeta;
  /** IndexedDB key of the original blob (images only). */
  blobKey?: string;
  /** IndexedDB key of the 256px preview (images only). */
  thumbKey?: string;
  text?: string;
  visual?: VisualFeatures;
  textFeatures?: TextFeatures;
  /** Hard user binding: this text asset is a caption of that image asset. */
  boundToAssetId?: string;
  groupId?: string;
  locked?: boolean;
  analysisStatus: AnalysisStatus;
  warnings: string[];
  nearDuplicateOf?: string;
  /** Transient AI tags; not required for saved projects. */
  aiTags?: string[];
  aiCaption?: string;
}

export interface AssetError {
  fileName: string;
  reason: string;
  level: 'assetError' | 'blocking';
}

export type PageSizeId = 'A4' | 'A5' | 'B3' | 'B4' | 'B5' | 'square' | 'wide' | 'custom';
export type Orientation = 'portrait' | 'landscape';

export interface PageSpec {
  sizeId: PageSizeId;
  /** Trim size after rotation is applied. */
  trimWidth: Mm;
  trimHeight: Mm;
  orientation: Orientation;
  bleed: Mm;
  safeMargin: Mm;
  gutter: Mm;
  targetDpi: 150 | 200 | 300;
  background: string;
  showPageNumbers: boolean;
  cropMarks: boolean;
}

export type TemplateTag = 'hero' | 'quiet' | 'grid' | 'text' | 'chapter' | 'panorama' | 'dual';
export type Density = 1 | 2 | 3 | 4 | 5;
export type FitMode = 'fill' | 'fit';

export interface Focus {
  x: number;
  y: number;
}

export type TextRole = 'chapterTitle' | 'sentence' | 'body' | 'caption' | 'pageNumber';

export interface LayoutFrame {
  id: string;
  kind: 'image' | 'text';
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
  assetId?: string;
  fit?: FitMode;
  focus?: Focus;
  textRole?: TextRole;
  /** Overridden text content (chapter titles are generated, not imported). */
  textOverride?: string;
  align?: 'left' | 'center' | 'right';
  color?: string;
  /** Text overlays photography; renderer samples the pixels below it for contrast. */
  textOnImage?: boolean;
  /** Full-bleed frames are authored in bleed coordinates (may be negative). */
  bleedOut?: boolean;
}

/** One physical page. Two pages form a spread in the editor. */
export interface Page {
  id: string;
  /** Index within the book, 0-based; page 0 is the cover. */
  index: number;
  templateId: string;
  density: Density;
  frames: LayoutFrame[];
  groupId?: string;
  locked: boolean;
  /** True when the page is the right half of a spread-spanning template. */
  spreadPartnerOf?: string;
  isBlank?: boolean;
}

export interface Group {
  id: string;
  assetIds: string[];
  title?: string;
  locked: boolean;
  /** Debug/explainability: why the boundary was drawn here. */
  boundaryReason?: string;
}

export type OrderMode = 'original' | 'time' | 'colorFlow' | 'standardSmart' | 'shuffleRhythm';

export interface GroupingSettings {
  orderMode: OrderMode;
  /** Multiplies the strong/weak thresholds; 1 = defaults from the spec. */
  groupStrength: number;
  colorWeight: number;
  timeWeight: number;
  maxImagesPerGroup: number;
  allowSpreads: boolean;
  windowSize: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageSpec: PageSpec;
  grouping: GroupingSettings;
  assets: Asset[];
  groups: Group[];
  pages: Page[];
  errors: AssetError[];
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  level: IssueLevel;
  code:
    | 'lowDpi'
    | 'textOverflow'
    | 'missingGlyph'
    | 'assetDecodeFailed'
    | 'bleedNotCovered'
    | 'blankPage'
    | 'pageCountNotMultipleOfFour'
    | 'noCmykPdfx'
    | 'noAssets'
    | 'fontMissing';
  message: string;
  pageIndex?: number;
  frameId?: string;
  assetId?: string;
  autoFix?: 'switchTemplate' | 'shrinkFrame' | 'addBlankPages' | 'extendBleed' | 'fallbackFont';
}
