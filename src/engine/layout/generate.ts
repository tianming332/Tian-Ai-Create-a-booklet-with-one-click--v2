import { makeId } from '../../shared/ids';
import { safeRect } from '../../shared/geometry';
import type { Asset, Group, LayoutFrame, Page, PageSpec } from '../../shared/types';
import { textBlockHeight } from './style';
import { frameGap, TEMPLATES, templateById } from './templates';
import { bestCandidate, evaluateTemplate, type Candidate } from './select';
import { initialRhythm, pushRhythm } from './rhythm';
import type { PageSide, RhythmState, TemplateContext, TemplateDefinition } from './types';
import { templatePool, templateWeight, type BookStyle } from './bookStyle';

export interface GenerateOptions {
  spec: PageSpec;
  assets: Asset[];
  groups: Group[];
  /** Page 0 is a full-bleed cover unless disabled. */
  cover?: boolean;
  /** Emit T09 dividers when the book has enough chapters. */
  chapters?: boolean;
  /** Restricts and weights the template pool; also carries cover/chapter policy. */
  style?: BookStyle;
}

/** Interior pages alternate recto/verso so the gutter always sits at the spine. */
export function sideForIndex(index: number): PageSide {
  if (index === 0) return 'single';
  return index % 2 === 1 ? 'right' : 'left';
}

export function pageNumberFrame(spec: PageSpec, side: PageSide, index: number): LayoutFrame {
  const h = textBlockHeight(spec, 'pageNumber', 1);
  const live = safeRect(spec, side);
  return {
    id: makeId('frm'),
    kind: 'text',
    x: live.x,
    y: spec.trimHeight - spec.safeMargin + Math.max(1, spec.safeMargin * 0.15),
    w: live.w,
    h,
    textRole: 'pageNumber',
    textOverride: String(index),
    align: side === 'left' ? 'left' : 'right',
  };
}

/**
 * Chapter titles only ever come from words the user actually imported: a group
 * title or a short text asset. No text in, no text out — a divider is skipped
 * rather than filled with a date or a "第 N 章" the user never wrote.
 */
export function chapterTitleFor(group: Group, assets: Map<string, Asset>): string | undefined {
  if (group.title) return group.title;
  for (const id of group.assetIds) {
    const asset = assets.get(id);
    const cls = asset?.textFeatures?.lengthClass;
    if (asset?.kind === 'text' && (cls === 'label' || cls === 'short')) {
      return asset.textFeatures!.normalized.slice(0, 24);
    }
  }
  return undefined;
}

function coverScore(asset: Asset): number {
  const v = asset.visual;
  if (!v) return 0;
  const centred = 1 - Math.abs(v.luma - 0.52) * 1.2;
  return v.contrast * 0.35 + v.entropy * 0.3 + v.saturation * 0.15 + centred * 0.2;
}

interface Bucket {
  images: Asset[];
  freeTexts: Asset[];
  captions: Map<string, Asset>;
}

function bucketFor(group: Group, byId: Map<string, Asset>): Bucket {
  const images: Asset[] = [];
  const freeTexts: Asset[] = [];
  const captions = new Map<string, Asset>();
  for (const id of group.assetIds) {
    const asset = byId.get(id);
    if (!asset) continue;
    if (asset.kind === 'image') images.push(asset);
    else if (asset.boundToAssetId) captions.set(asset.boundToAssetId, asset);
    else freeTexts.push(asset);
  }
  return { images, freeTexts, captions };
}

function contextFor(
  def: TemplateDefinition,
  bucket: Bucket,
  spec: PageSpec,
  side: PageSide,
  pageIndex: number,
): TemplateContext | undefined {
  const images = bucket.images.slice(0, def.maxImages);
  if (images.length < def.minImages) return undefined;
  const texts: Asset[] = [];
  if (def.maxTexts > 0) {
    for (const image of images) {
      const caption = bucket.captions.get(image.id);
      if (caption && texts.length < def.maxTexts) texts.push(caption);
    }
    // Free sentences may headline a calm page (T03/T08) but never a grid.
    if (texts.length === 0 && def.maxImages <= 1 && bucket.freeTexts.length > 0) {
      texts.push(bucket.freeTexts[0]);
    }
  }
  return { spec, side, images, texts, gap: frameGap(spec), pageIndex };
}

function consume(bucket: Bucket, ctx: TemplateContext): void {
  for (const image of ctx.images) {
    const at = bucket.images.indexOf(image);
    if (at >= 0) bucket.images.splice(at, 1);
    bucket.captions.delete(image.id);
  }
  for (const text of ctx.texts) {
    const at = bucket.freeTexts.indexOf(text);
    if (at >= 0) bucket.freeTexts.splice(at, 1);
  }
}

function makePage(
  index: number,
  templateId: string,
  density: Page['density'],
  frames: LayoutFrame[],
  groupId: string | undefined,
  spec: PageSpec,
): Page {
  const side = sideForIndex(index);
  const all = [...frames];
  if (spec.showPageNumbers && index > 0) all.push(pageNumberFrame(spec, side, index));
  return { id: makeId('pg'), index, templateId, density, frames: all, groupId, locked: false };
}

/** Deterministic content-driven pagination (spec 12.1). */
export function generatePages(options: GenerateOptions): Page[] {
  const { spec, assets, groups } = options;
  const style = options.style;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const pages: Page[] = [];
  let rhythm: RhythmState = initialRhythm();
  const pool = new Set(templatePool(style, TEMPLATES.map((def) => def.id)));
  const useChapters =
    options.chapters !== false &&
    (style ? style.layout.chapters : true) &&
    pool.has('T09') &&
    groups.length >= 3;

  const analysed = assets.filter((a) => a.kind === 'image' && a.visual);
  if (options.cover !== false && (style ? style.layout.cover : true) && analysed.length > 0) {
    const hero = [...analysed].sort((a, b) => coverScore(b) - coverScore(a) || a.importIndex - b.importIndex)[0];
    const def = templateById('T01')!;
    const ctx: TemplateContext = {
      spec,
      side: 'single',
      images: [hero],
      texts: [],
      gap: frameGap(spec),
      pageIndex: 0,
    };
    pages.push(makePage(0, def.id, def.density, def.build(ctx), undefined, spec));
    rhythm = pushRhythm(rhythm, def, 1);
  }

  groups.forEach((group) => {
    const bucket = bucketFor(group, byId);
    if (bucket.images.length === 0 && bucket.freeTexts.length === 0) return;

    const chapterTitle = useChapters ? chapterTitleFor(group, byId) : undefined;
    if (chapterTitle && bucket.images.length >= 3) {
      const def = templateById('T09')!;
      const index = pages.length;
      const ctx: TemplateContext = {
        spec,
        side: sideForIndex(index),
        images: [],
        texts: [],
        gap: frameGap(spec),
        pageIndex: index,
        chapterTitle,
      };
      pages.push(makePage(index, def.id, def.density, def.build(ctx), group.id, spec));
      rhythm = pushRhythm(rhythm, def, 1);
    }

    let guard = 0;
    while ((bucket.images.length > 0 || bucket.freeTexts.length > 0) && guard < 500) {
      guard += 1;
      const index = pages.length;
      const side = sideForIndex(index);
      const remainingImages = bucket.images.length;
      const remainingTexts = bucket.freeTexts.length;

      const build = (state: RhythmState): { candidate: Candidate; ctx: TemplateContext } | undefined => {
        const found: { candidate: Candidate; ctx: TemplateContext }[] = [];
        for (const def of TEMPLATES) {
          if (def.id === 'T09') continue;
          if (!pool.has(def.id)) continue;
          // Spread templates must start on the left half of a spread.
          if (def.spread && side !== 'left') continue;
          const ctx = contextFor(def, bucket, spec, side, index);
          if (!ctx) continue;
          const candidate = evaluateTemplate(def, ctx, {
            remainingImages,
            remainingTexts,
            byId,
            rhythm: state,
            weight: templateWeight(style, def.id),
          });
          if (candidate) found.push({ candidate, ctx });
        }
        const best = bestCandidate(found.map((f) => f.candidate));
        return best ? found.find((f) => f.candidate === best) : undefined;
      };

      // Rhythm rules are advisory when nothing else fits — a page must be emitted.
      const picked = build(rhythm) ?? build(initialRhythm());
      if (!picked) {
        if (bucket.images.length) bucket.images.shift();
        else bucket.freeTexts.shift();
        continue;
      }

      const { candidate, ctx } = picked;
      consume(bucket, ctx);
      pages.push(makePage(index, candidate.def.id, candidate.def.density, candidate.frames, group.id, spec));

      if (candidate.def.spread) {
        const partnerIndex = pages.length;
        const partnerCtx: TemplateContext = { ...ctx, side: sideForIndex(partnerIndex), pageIndex: partnerIndex };
        const partner = makePage(
          partnerIndex,
          candidate.def.id,
          candidate.def.density,
          candidate.def.build(partnerCtx),
          group.id,
          spec,
        );
        partner.spreadPartnerOf = pages[pages.length - 1].id;
        pages.push(partner);
        rhythm = pushRhythm(rhythm, candidate.def, 2);
      } else {
        rhythm = pushRhythm(rhythm, candidate.def, 1);
      }
    }
  });

  // Books are printed in spreads: keep the page count even.
  if (pages.length % 2 === 1) {
    pages.push({
      id: makeId('pg'),
      index: pages.length,
      templateId: 'blank',
      density: 1,
      frames: [],
      locked: false,
      isBlank: true,
    });
  }
  return pages;
}
