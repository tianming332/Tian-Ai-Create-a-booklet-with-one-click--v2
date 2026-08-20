import type { Mm } from '../../shared/units';
import type { Asset, Density, LayoutFrame, PageSpec, TemplateTag } from '../../shared/types';

export type PageSide = 'left' | 'right' | 'single';

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
  /** 0-based page index in the book, used for page numbers. */
  pageIndex: number;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  tags: TemplateTag[];
  density: Density;
  minImages: number;
  maxImages: number;
  /** Text assets the template can host. */
  maxTexts: number;
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
