import type { Mm } from '../../shared/units';
import type { Asset, Density, LayoutFrame, PageSpec, TemplateTag, TextBlockRole, TextRole } from '../../shared/types';

export type PageSide = 'left' | 'right' | 'single';
export type LayoutFamily = 'hero' | 'framed' | 'stack' | 'split' | 'grid' | 'text' | 'chapter' | 'spread';
export type SplitImageSide = 'auto' | 'left' | 'right' | 'inner' | 'outer';

/** Parameters shared by every left/right image-text composition. Relative
 * sides are resolved against the physical recto/verso page at build time. */
export interface SplitLayoutParameters {
  imageSide?: SplitImageSide;
  /** Fraction of usable width assigned to the image, clamped to 0.34..0.68. */
  imageRatio?: number;
}
export type SlotOverflow = 'shrink' | 'continue' | 'switchTemplate' | 'truncate';

/** Semantic capacity of a layout family. Geometry is still calculated by the
 * family builder, so optional slots collapse instead of leaving fixed holes. */
export interface TextSlotDefinition {
  id: string;
  accepts: TextBlockRole[];
  required?: boolean;
  maxBlocks: number;
  maxChars?: number;
  typography: TextRole;
  align?: 'left' | 'center' | 'right';
  overlay?: boolean;
  overflow: SlotOverflow;
}

export interface AssignedTextSlot {
  definition: TextSlotDefinition;
  assets: Asset[];
}

/** Everything a template needs to emit geometry. Pure data — no DOM, no store. */
export interface TemplateContext {
  spec: PageSpec;
  side: PageSide;
  /** Images assigned to this page, in reading order. */
  images: Asset[];
  /** Text assets assigned to this page (captions / sentences / body). */
  texts: Asset[];
  /** Gap between sibling frames. */
  gap: Mm;
  /** Generated chapter title (T09) — never imported content. */
  chapterTitle?: string;
  /** Optional family parameters supplied by rules, the editor, or AI. */
  layoutParams?: SplitLayoutParameters;
  writingMode?: 'horizontal-tb' | 'vertical-rl';
  avoidFaces?: boolean;
  /** 0-based page index in the book, used for page numbers. */
  pageIndex: number;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  /** Parameterised family behind this legacy template id. */
  family: LayoutFamily;
  tags: TemplateTag[];
  density: Density;
  minImages: number;
  maxImages: number;
  /** Text assets the template can host. */
  maxTexts: number;
  /** Optional semantic slots; absent means the legacy generic text input. */
  textSlots?: TextSlotDefinition[];
  /** Spans both halves of a spread; the generator emits a partner page. */
  spread?: boolean;
  /** Hard constraints (spec 11.3): false ⇒ template is not a candidate at all. */
  accepts(ctx: TemplateContext): boolean;
  /** Aspect-ratio suitability, 0..1. */
  aspectFit(ctx: TemplateContext): number;
  build(ctx: TemplateContext): LayoutFrame[];
}

export interface TemplateScore {
  templateId: string;
  total: number;
  assetCountFit: number;
  aspectRatioFit: number;
  textFit: number;
  rhythmFit: number;
  cropLossFit: number;
  repetitionFit: number;
  rejected?: string;
}

/** Rolling state that keeps the book from looking mechanical (spec 12). */
export interface RhythmState {
  recentTemplateIds: string[];
  recentDensities: Density[];
  consecutiveText: number;
  lastPanoramaPage: number;
  pageIndex: number;
}
