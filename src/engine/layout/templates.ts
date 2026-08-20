import { VISUAL_THRESHOLDS } from '../../shared/constants';
import {
  bleedRect,
  cropLoss,
  insetRect,
  safeRect,
  splitColumns,
  splitColumnsWeighted,
  splitRows,
  splitRowsWeighted,
  type Rect,
} from '../../shared/geometry';
import { makeId } from '../../shared/ids';
import type { Asset, LayoutFrame, PageSpec, TextRole } from '../../shared/types';
import type { Mm } from '../../shared/units';
import { textBlockHeight } from './style';
import type { TemplateContext, TemplateDefinition } from './types';

/** Gap between sibling frames, scaled with the page size. */
export function frameGap(spec: PageSpec): Mm {
  return Math.max(3, spec.safeMargin * 0.35);
}

export function aspectOf(asset: Asset | undefined): number {
  return asset?.visual?.aspectRatio ?? 1;
}

function imageFrame(rect: Rect, asset: Asset | undefined, extra: Partial<LayoutFrame> = {}): LayoutFrame {
  return {
    id: makeId('frm'),
    kind: 'image',
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    assetId: asset?.id,
    fit: 'fill',
    focus: { x: 0.5, y: 0.5 },
    ...extra,
  };
}

function textFrame(
  rect: Rect,
  role: TextRole,
  asset: Asset | undefined,
  extra: Partial<LayoutFrame> = {},
): LayoutFrame {
  return {
    id: makeId('frm'),
    kind: 'text',
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    assetId: asset?.id,
    textRole: role,
    align: 'left',
    ...extra,
  };
}

/** Largest rect with `aspect` centred inside `rect` (used by framed templates). */
export function containRect(rect: Rect, aspect: number): Rect {
  let w = rect.w;
  let h = w / aspect;
  if (h > rect.h) {
    h = rect.h;
    w = h * aspect;
  }
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

/** Mean crop loss of the images the template would place. */
export function meanCropLoss(frames: LayoutFrame[], byId: Map<string, Asset>): number {
  const image = frames.filter((f) => f.kind === 'image' && f.assetId && f.fit !== 'fit');
  if (image.length === 0) return 0;
  let total = 0;
  for (const frame of image) {
    total += cropLoss(frame.w, frame.h, aspectOf(byId.get(frame.assetId!)));
  }
  return total / image.length;
}

function captionLines(asset: Asset | undefined): number {
  const cls = asset?.textFeatures?.lengthClass;
  if (!asset) return 0;
  if (cls === 'label' || cls === 'short') return 1;
  if (cls === 'medium') return 2;
  return 3;
}

/** Splits the live area into an image area plus a caption strip when text exists. */
function withCaption(
  ctx: TemplateContext,
  area: Rect,
): { image: Rect; caption?: Rect; captionAsset?: Asset } {
  const asset = ctx.texts[0];
  if (!asset) return { image: area };
  const lines = captionLines(asset);
  const h = textBlockHeight(ctx.spec, 'caption', lines);
  return {
    image: { ...area, h: area.h - h - ctx.gap },
    caption: { x: area.x, y: area.y + area.h - h, w: area.w, h },
    captionAsset: asset,
  };
}

const isPanorama = (asset: Asset | undefined) => aspectOf(asset) >= VISUAL_THRESHOLDS.panoramaAspect;

/** T01 — Full Bleed Hero: one image over the whole media box. */
const T01: TemplateDefinition = {
  id: 'T01',
  name: '满版主图',
  tags: ['hero'],
  density: 1,
  minImages: 1,
  maxImages: 1,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 1,
  aspectFit: (ctx) => {
    const loss = cropLoss(ctx.spec.trimWidth, ctx.spec.trimHeight, aspectOf(ctx.images[0]));
    return Math.max(0, 1 - loss * 1.4);
  },
  build: (ctx) => {
    const frames = [imageFrame(bleedRect(ctx.spec), ctx.images[0], { bleedOut: true })];
    const caption = ctx.texts[0];
    if (caption) {
      const live = safeRect(ctx.spec, ctx.side);
      const h = textBlockHeight(ctx.spec, 'caption', captionLines(caption));
      frames.push(
        textFrame({ x: live.x, y: live.y + live.h - h, w: live.w, h }, 'caption', caption, {
          color: '#ffffff',
        }),
      );
    }
    return frames;
  },
};

/** T02 — Framed Single: one image with generous white space, never cropped. */
const T02: TemplateDefinition = {
  id: 'T02',
  name: '留白单图',
  tags: ['quiet'],
  density: 2,
  minImages: 1,
  maxImages: 1,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 1,
  aspectFit: () => 0.82,
  build: (ctx) => {
    const live = insetRect(safeRect(ctx.spec, ctx.side), ctx.gap);
    const { image, caption, captionAsset } = withCaption(ctx, live);
    const rect = containRect(image, aspectOf(ctx.images[0]));
    const frames = [imageFrame(rect, ctx.images[0], { fit: 'fit' })];
    if (caption) frames.push(textFrame(caption, 'caption', captionAsset, { align: 'center' }));
    return frames;
  },
};

/** T03 — Image + Text: image on top, a sentence or body block underneath. */
const T03: TemplateDefinition = {
  id: 'T03',
  name: '图文',
  tags: ['quiet', 'text'],
  density: 2,
  minImages: 1,
  maxImages: 1,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 1 && ctx.texts.length >= 1,
  aspectFit: (ctx) => (aspectOf(ctx.images[0]) >= 0.9 ? 0.9 : 0.66),
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const [top, bottom] = splitRowsWeighted(live, 0.62, ctx.gap * 1.5);
    const asset = ctx.texts[0];
    const role: TextRole = asset?.textFeatures?.lengthClass === 'short' ? 'sentence' : 'body';
    return [
      imageFrame(top, ctx.images[0]),
      textFrame(bottom, role, asset),
    ];
  },
};

/** T04 — Dual: two images, stacked or side by side depending on orientation. */
const T04: TemplateDefinition = {
  id: 'T04',
  name: '双图',
  tags: ['dual'],
  density: 3,
  minImages: 2,
  maxImages: 2,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 2,
  aspectFit: (ctx) => {
    const [a, b] = ctx.images.map(aspectOf);
    const bothPortrait = a < 1 && b < 1;
    const bothLandscape = a >= 1 && b >= 1;
    return bothPortrait || bothLandscape ? 0.9 : 0.62;
  },
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const { image, caption, captionAsset } = withCaption(ctx, live);
    const portrait = ctx.images.every((a) => aspectOf(a) < 1);
    const cells = portrait ? splitColumns(image, 2, ctx.gap) : splitRows(image, 2, ctx.gap);
    const frames = ctx.images.map((asset, i) => imageFrame(cells[i], asset));
    if (caption) frames.push(textFrame(caption, 'caption', captionAsset));
    return frames;
  },
};

/** T05 — Hero + Two: a lead image with two supporting images below. */
const T05: TemplateDefinition = {
  id: 'T05',
  name: '主图配两图',
  tags: ['hero', 'grid'],
  density: 3,
  minImages: 3,
  maxImages: 3,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 3,
  aspectFit: (ctx) => (aspectOf(ctx.images[0]) >= 1 ? 0.92 : 0.7),
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const { image, caption, captionAsset } = withCaption(ctx, live);
    const [top, bottom] = splitRowsWeighted(image, 0.58, ctx.gap);
    const cells = splitColumns(bottom, 2, ctx.gap);
    const frames = [
      imageFrame(top, ctx.images[0]),
      imageFrame(cells[0], ctx.images[1]),
      imageFrame(cells[1], ctx.images[2]),
    ];
    if (caption) frames.push(textFrame(caption, 'caption', captionAsset));
    return frames;
  },
};

/** T06 — Three Grid: an even band of three, orientation follows the page. */
const T06: TemplateDefinition = {
  id: 'T06',
  name: '三格',
  tags: ['grid'],
  density: 4,
  minImages: 3,
  maxImages: 3,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 3,
  aspectFit: (ctx) => {
    const portraitPage = ctx.spec.trimHeight >= ctx.spec.trimWidth;
    const wide = ctx.images.filter((a) => aspectOf(a) >= 1).length;
    return portraitPage ? 0.6 + wide * 0.1 : 0.9 - wide * 0.08;
  },
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const { image, caption, captionAsset } = withCaption(ctx, live);
    const portraitPage = ctx.spec.trimHeight >= ctx.spec.trimWidth;
    const cells = portraitPage ? splitRows(image, 3, ctx.gap) : splitColumns(image, 3, ctx.gap);
    const frames = ctx.images.map((asset, i) => imageFrame(cells[i], asset));
    if (caption) frames.push(textFrame(caption, 'caption', captionAsset));
    return frames;
  },
};

/** T07 — Four Grid: 2×2, the densest content page. */
const T07: TemplateDefinition = {
  id: 'T07',
  name: '四格',
  tags: ['grid'],
  density: 5,
  minImages: 4,
  maxImages: 4,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 4,
  aspectFit: () => 0.78,
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const { image, caption, captionAsset } = withCaption(ctx, live);
    const rows = splitRows(image, 2, ctx.gap);
    const cells = [...splitColumns(rows[0], 2, ctx.gap), ...splitColumns(rows[1], 2, ctx.gap)];
    const frames = ctx.images.map((asset, i) => imageFrame(cells[i], asset));
    if (caption) frames.push(textFrame(caption, 'caption', captionAsset));
    return frames;
  },
};

/** T08 — Quote: a standalone sentence, used to breathe between dense pages. */
const T08: TemplateDefinition = {
  id: 'T08',
  name: '文字页',
  tags: ['text', 'quiet'],
  density: 1,
  minImages: 0,
  maxImages: 0,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 0 && ctx.texts.length === 1,
  aspectFit: () => 0.8,
  build: (ctx) => {
    const live = insetRect(safeRect(ctx.spec, ctx.side), ctx.gap * 2);
    const asset = ctx.texts[0];
    const cls = asset?.textFeatures?.lengthClass;
    const long = cls === 'long' || cls === 'tooLong';
    const role: TextRole = long ? 'body' : 'sentence';
    const h = long ? live.h : Math.min(live.h, textBlockHeight(ctx.spec, 'sentence', 5));
    return [
      textFrame({ x: live.x, y: live.y + (live.h - h) / 2, w: live.w, h }, role, asset, {
        align: long ? 'left' : 'center',
      }),
    ];
  },
};

/** T09 — Chapter Divider: generated title, optional accent image. */
const T09: TemplateDefinition = {
  id: 'T09',
  name: '章节页',
  tags: ['chapter', 'quiet'],
  density: 1,
  minImages: 0,
  maxImages: 1,
  maxTexts: 0,
  accepts: (ctx) => Boolean(ctx.chapterTitle) && ctx.images.length <= 1,
  aspectFit: () => 0.85,
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const titleHeight = textBlockHeight(ctx.spec, 'chapterTitle', 2);
    if (ctx.images.length === 0) {
      return [
        textFrame(
          { x: live.x, y: live.y + live.h * 0.38, w: live.w, h: titleHeight },
          'chapterTitle',
          undefined,
          { textOverride: ctx.chapterTitle },
        ),
      ];
    }
    const [left, right] = splitColumnsWeighted(live, 0.46, ctx.gap * 1.5);
    return [
      textFrame({ x: left.x, y: left.y + left.h * 0.34, w: left.w, h: titleHeight }, 'chapterTitle', undefined, {
        textOverride: ctx.chapterTitle,
      }),
      imageFrame(right, ctx.images[0]),
    ];
  },
};

/** T10 — Panorama Spread: one wide image across both halves of a spread. */
const T10: TemplateDefinition = {
  id: 'T10',
  name: '跨页全景',
  tags: ['panorama', 'hero'],
  density: 1,
  minImages: 1,
  maxImages: 1,
  maxTexts: 0,
  spread: true,
  accepts: (ctx) => ctx.images.length === 1 && isPanorama(ctx.images[0]) && ctx.side !== 'single',
  aspectFit: (ctx) => {
    const spreadAspect = (ctx.spec.trimWidth * 2) / ctx.spec.trimHeight;
    const loss = cropLoss(spreadAspect, 1, aspectOf(ctx.images[0]));
    return Math.max(0, 1 - loss * 1.2);
  },
  build: (ctx) => {
    const { bleed, trimWidth, trimHeight } = ctx.spec;
    const rect: Rect = {
      x: ctx.side === 'right' ? -(trimWidth + bleed) : -bleed,
      y: -bleed,
      w: trimWidth * 2 + bleed * 2,
      h: trimHeight + bleed * 2,
    };
    return [imageFrame(rect, ctx.images[0], { bleedOut: true })];
  },
};

export const TEMPLATES: TemplateDefinition[] = [T01, T02, T03, T04, T05, T06, T07, T08, T09, T10];

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateById(id: string): TemplateDefinition | undefined {
  return TEMPLATE_BY_ID.get(id);
}
