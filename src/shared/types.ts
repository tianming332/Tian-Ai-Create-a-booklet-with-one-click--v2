import type { Mm } from './units';

export type AssetKind = 'image' | 'text';

export type AspectClass = 'portrait' | 'square' | 'landscape' | 'panorama';
export type TextLengthClass = 'label' | 'short' | 'medium' | 'long' | 'tooLong';

/** Semantic role of a piece of authored text. This is deliberately separate
 * from TextRole, which is the much smaller set of renderer typography roles. */
export type TextBlockRole =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'lead'
  | 'body'
  | 'shortSentence'
  | 'quote'
  | 'caption'
  | 'metadata'
  | 'credit';

export type TextEntityType =
  | 'location'
  | 'person'
  | 'date'
  | 'time'
  | 'event'
  | 'object'
  | 'action'
  | 'emotion'
  | 'mood'
  | 'theme';

export interface TextEntity {
  type: TextEntityType;
  value: string;
  normalizedValue?: string;
  confidence: number;
}

export interface TextBlock {
  id: string;
  sourceDocumentId: string;
  role: TextBlockRole;
  text: string;
  order: number;
  importance: number;
  /** Headings/leads/quotes may become compositional display type. */
  decorative: boolean;
  allowOverlay: boolean;
  /** Body fragments may continue on another physical page. */
  allowSplit: boolean;
  continuation?: boolean;
  entities: TextEntity[];
  semanticTags: string[];
  parser: 'rule' | 'ai' | 'manual';
}

export interface TextDocument {
  id: string;
  blocks: TextBlock[];
  parser: 'rule' | 'ai' | 'manual';
  version: 1;
}

/** Shared vocabulary used by text and image analysis. Arrays stay open-ended
 * so a future model can add useful terms without a schema migration. */
export interface SemanticTags {
  people?: string[];
  actions?: string[];
  scenes?: string[];
  objects?: string[];
  locations?: string[];
  events?: string[];
  emotions?: string[];
  moods?: string[];
  themes?: string[];
}

/** Normalized image-space region returned by vision analysis. */
export interface FaceRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextImageRelationKind =
  | 'caption'
  | 'literal'
  | 'person'
  | 'action'
  | 'location'
  | 'time'
  | 'emotion'
  | 'mood'
  | 'theme'
  | 'manual'
  | 'weak';

export interface TextImageRelation {
  id: string;
  textAssetId: string;
  textBlockId: string;
  imageId: string;
  kind: TextImageRelationKind;
  score: number;
  reasons: string[];
  source: 'rule' | 'ai' | 'manual';
  locked: boolean;
}

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
  /** One semantic block per asset keeps the existing layout engine compatible;
   * sourceDocumentId reconnects blocks imported from the same document. */
  textBlock?: TextBlock;
  sourceDocumentId?: string;
  visual?: VisualFeatures;
  textFeatures?: TextFeatures;
  /** Hard user binding: this text asset is a caption of that image asset. */
  boundToAssetId?: string;
  /** Best non-destructive semantic suggestion; unlike a caption binding this
   * may be recomputed as tags improve. */
  relatedToAssetId?: string;
  groupId?: string;
  locked?: boolean;
  analysisStatus: AnalysisStatus;
  warnings: string[];
  nearDuplicateOf?: string;
  /** Transient AI tags; not required for saved projects. */
  aiTags?: string[];
  aiCaption?: string;
  aiSemantic?: SemanticTags;
  /** AI-detected faces in normalized image coordinates. */
  faces?: FaceRegion[];
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
  /** Character range used when one body asset flows through several frames. */
  textRange?: { start: number; end: number };
  writingMode?: 'horizontal-tb' | 'vertical-rl';
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
  /** Family-level geometry controls; currently used by the Split family. */
  layoutParams?: import('../engine/layout/types').SplitLayoutParameters;
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
  textImageRelations?: TextImageRelation[];
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
