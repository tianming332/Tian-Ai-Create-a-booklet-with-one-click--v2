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
import type { SplitImageSide, TemplateContext, TemplateDefinition } from './types';
import { assignTextSlots, buildTextSlotFrames, STRUCTURED_TEXT_SLOTS } from './textSlots';

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
    fit: extra.fit ?? (asset?.visual?.aspectClass === 'portrait' && rect.w / rect.h > 1.15 ? 'fit' : 'fill'),
    focus: asset?.visual?.focus ?? { x: 0.5, y: 0.4 },
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

function overlayColors(image: Asset | undefined): { color: string; textOnImage: true } {
  const darkImage = (image?.visual?.luma ?? 0.5) < 0.56;
  return { color: darkImage ? '#ffffff' : '#111111', textOnImage: true };
}

/** Caption plate placed over the bottom of a photograph-filled composition. */
function overlayCaption(
  ctx: TemplateContext,
  area: Rect,
  image: Asset | undefined,
): LayoutFrame | undefined {
  const asset = ctx.texts[0];
  if (!asset) return undefined;
  const h = textBlockHeight(ctx.spec, 'caption', captionLines(asset));
  const inset = Math.max(2.5, ctx.gap * 0.65);
  const w = Math.max(1, area.w - inset * 2);
  const candidates: Rect[] = [
    { x: area.x + inset, y: area.y + area.h - h - inset, w, h },
    { x: area.x + inset, y: area.y + inset, w, h },
    { x: area.x + inset, y: area.y + (area.h - h) / 2, w, h },
  ];
  const faces = ctx.avoidFaces ? image?.faces ?? [] : [];
  const overlapsFace = (candidate: Rect) => faces.some((face) => {
    const pad = Math.max(2, inset * 0.5);
    const region = {
      x: area.x + face.x * area.w - pad, y: area.y + face.y * area.h - pad,
      w: face.w * area.w + pad * 2, h: face.h * area.h + pad * 2,
    };
    return candidate.x < region.x + region.w && candidate.x + candidate.w > region.x
      && candidate.y < region.y + region.h && candidate.y + candidate.h > region.y;
  });
  const safe = candidates.find((candidate) => !overlapsFace(candidate));
  if (!safe) return undefined;
  return textFrame(
    safe,
    'caption',
    asset,
    { ...overlayColors(image) },
  );
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
  family: 'hero',
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
      const overlay = overlayCaption(ctx, live, ctx.images[0]);
      if (overlay) frames.push(overlay);
    }
    return frames;
  },
};

/** T02 — Framed Single: one image with generous white space, never cropped. */
const T02: TemplateDefinition = {
  id: 'T02',
  name: '留白单图',
  family: 'framed',
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

function resolveSplitImageSide(requested: SplitImageSide | undefined, pageSide: TemplateContext['side']): 'left' | 'right' {
  if (requested === 'left' || requested === 'right') return requested;
  if (requested === 'inner') return pageSide === 'left' ? 'right' : 'left';
  // Auto follows the editorial default: image toward the fore-edge, text
  // toward the gutter. A single page uses image-left for familiar LTR flow.
  if (requested === 'outer' || requested === 'auto' || !requested) return pageSide === 'right' ? 'right' : 'left';
  return 'left';
}

/** T03 — Parameterised Split: one image and a semantic text column. */
const T03: TemplateDefinition = {
  id: 'T03',
  name: '图文',
  family: 'split',
  tags: ['quiet', 'text'],
  density: 2,
  minImages: 1,
  maxImages: 1,
  maxTexts: 6,
  textSlots: STRUCTURED_TEXT_SLOTS,
  accepts: (ctx) => ctx.images.length === 1 && ctx.texts.length >= 1,
  aspectFit: (ctx) => (aspectOf(ctx.images[0]) < 1.35 ? 0.92 : 0.76),
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const ratio = Math.max(0.34, Math.min(0.68, ctx.layoutParams?.imageRatio ?? 0.52));
    const imageSide = resolveSplitImageSide(ctx.layoutParams?.imageSide, ctx.side);
    const firstRatio = imageSide === 'left' ? ratio : 1 - ratio;
    const [left, right] = splitColumnsWeighted(live, firstRatio, ctx.gap * 1.5);
    const imageColumn = imageSide === 'left' ? left : right;
    const textColumn = imageSide === 'left' ? right : left;
    const assigned = assignTextSlots(ctx.texts, STRUCTURED_TEXT_SLOTS);
    const captionSlots = assigned.filter((slot) => slot.definition.id === 'caption');
    const contentSlots = assigned.filter((slot) => slot.definition.id !== 'caption');
    const captionFrames = buildTextSlotFrames(ctx.spec, imageColumn, ctx.gap, captionSlots);
    const captionHeight = captionFrames.reduce((sum, frame) => sum + frame.h, 0)
      + Math.max(0, captionFrames.length - 1) * Math.max(1.8, ctx.gap * 0.65);
    const imageRect = captionFrames.length
      ? { ...imageColumn, h: Math.max(1, imageColumn.h - captionHeight - ctx.gap) }
      : imageColumn;
    if (captionFrames.length) {
      let y = imageRect.y + imageRect.h + ctx.gap;
      for (const frame of captionFrames) {
        frame.y = y;
        y += frame.h + Math.max(1.8, ctx.gap * 0.65);
      }
    }
    return [
      imageFrame(imageRect, ctx.images[0], { fit: 'fit' }),
      ...captionFrames,
      ...buildTextSlotFrames(ctx.spec, textColumn, ctx.gap, contentSlots),
    ];
  },
};

/** T04 — Dual: two images, stacked or side by side depending on orientation. */
const T04: TemplateDefinition = {
  id: 'T04',
  name: '双图',
  family: 'grid',
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
    const portrait = ctx.images.every((a) => aspectOf(a) < 1);
    const cells = portrait ? splitColumns(live, 2, ctx.gap) : splitRows(live, 2, ctx.gap);
    const frames = ctx.images.map((asset, i) => imageFrame(cells[i], asset));
    const overlay = overlayCaption(ctx, live, ctx.images[ctx.images.length - 1]);
    if (overlay) frames.push(overlay);
    return frames;
  },
};

/** T05 — Hero + Two: a lead image with two supporting images below. */
const T05: TemplateDefinition = {
  id: 'T05',
  name: '主图配两图',
  family: 'grid',
  tags: ['hero', 'grid'],
  density: 3,
  minImages: 3,
  maxImages: 3,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 3,
  aspectFit: (ctx) => (aspectOf(ctx.images[0]) >= 1 ? 0.92 : 0.7),
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const [top, bottom] = splitRowsWeighted(live, 0.58, ctx.gap);
    const cells = splitColumns(bottom, 2, ctx.gap);
    const frames = [
      imageFrame(top, ctx.images[0]),
      imageFrame(cells[0], ctx.images[1]),
      imageFrame(cells[1], ctx.images[2]),
    ];
    const overlay = overlayCaption(ctx, live, ctx.images[2]);
    if (overlay) frames.push(overlay);
    return frames;
  },
};

/** T06 — Three Grid: an even band of three, orientation follows the page. */
const T06: TemplateDefinition = {
  id: 'T06',
  name: '三格',
  family: 'grid',
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
    const portraitPage = ctx.spec.trimHeight >= ctx.spec.trimWidth;
    const cells = portraitPage ? splitRows(live, 3, ctx.gap) : splitColumns(live, 3, ctx.gap);
    const frames = ctx.images.map((asset, i) => imageFrame(cells[i], asset));
    const overlay = overlayCaption(ctx, live, ctx.images[ctx.images.length - 1]);
    if (overlay) frames.push(overlay);
    return frames;
  },
};

/** T07 — Four Grid: 2×2, the densest content page. */
const T07: TemplateDefinition = {
  id: 'T07',
  name: '四格',
  family: 'grid',
  tags: ['grid'],
  density: 5,
  minImages: 4,
  maxImages: 4,
  maxTexts: 1,
  accepts: (ctx) => ctx.images.length === 4,
  aspectFit: () => 0.78,
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const rows = splitRows(live, 2, ctx.gap);
    const cells = [...splitColumns(rows[0], 2, ctx.gap), ...splitColumns(rows[1], 2, ctx.gap)];
    const frames = ctx.images.map((asset, i) => imageFrame(cells[i], asset));
    const overlay = overlayCaption(ctx, live, ctx.images[ctx.images.length - 1]);
    if (overlay) frames.push(overlay);
    return frames;
  },
};

/** T08 — Quote: a standalone sentence, used to breathe between dense pages. */
const T08: TemplateDefinition = {
  id: 'T08',
  name: '文字页',
  family: 'text',
  tags: ['text', 'quiet'],
  density: 1,
  minImages: 0,
  maxImages: 0,
  maxTexts: 8,
  textSlots: STRUCTURED_TEXT_SLOTS,
  accepts: (ctx) => ctx.images.length === 0 && ctx.texts.length >= 1,
  aspectFit: () => 0.8,
  build: (ctx) => {
    const live = insetRect(safeRect(ctx.spec, ctx.side), ctx.gap * 2);
    const assigned = assignTextSlots(ctx.texts, STRUCTURED_TEXT_SLOTS);
    const frames = buildTextSlotFrames(ctx.spec, live, ctx.gap, assigned);
    const onlyDisplay = frames.length === 1 && frames[0].textRole !== 'body';
    if (onlyDisplay) {
      const frame = frames[0];
      frame.y = live.y + (live.h - frame.h) / 2;
      frame.align = 'center';
    }
    return frames;
  },
};

/** T09 — Chapter Divider: generated or imported title, supporting metadata /
 * lead, and an optional accent image. */
const T09: TemplateDefinition = {
  id: 'T09',
  name: '章节页',
  family: 'chapter',
  tags: ['chapter', 'quiet'],
  density: 1,
  minImages: 0,
  maxImages: 1,
  maxTexts: 4,
  textSlots: STRUCTURED_TEXT_SLOTS,
  accepts: (ctx) => Boolean(ctx.chapterTitle || ctx.texts.length) && ctx.images.length <= 1,
  aspectFit: () => 0.85,
  build: (ctx) => {
    const live = safeRect(ctx.spec, ctx.side);
    const assigned = assignTextSlots(ctx.texts, STRUCTURED_TEXT_SLOTS);
    const hasImportedTitle = assigned.some((slot) => slot.definition.id === 'title' && slot.assets.length);
    // A generated chapter label is only a fallback. Never duplicate an
    // imported heading from the same document.
    const generatedTitle = !hasImportedTitle && ctx.chapterTitle
      ? textFrame({ x: 0, y: 0, w: 1, h: 1 }, 'chapterTitle', undefined, { textOverride: ctx.chapterTitle })
      : undefined;
    if (ctx.images.length === 0) {
      const area = { x: live.x, y: live.y + live.h * 0.2, w: live.w, h: live.h * 0.6 };
      const titleHeight = generatedTitle ? textBlockHeight(ctx.spec, 'chapterTitle', 2) : 0;
      const contentArea = generatedTitle && assigned.some((slot) => slot.assets.length)
        ? { ...area, y: area.y + titleHeight + ctx.gap, h: area.h - titleHeight - ctx.gap }
        : area;
      const frames = buildTextSlotFrames(ctx.spec, contentArea, ctx.gap, assigned);
      if (generatedTitle) {
        Object.assign(generatedTitle, {
          x: area.x, y: area.y + (frames.length ? 0 : (area.h - titleHeight) / 2), w: area.w, h: titleHeight,
        });
        frames.unshift(generatedTitle);
      }
      return frames;
    }
    const [left, right] = splitColumnsWeighted(live, 0.46, ctx.gap * 1.5);
    const textArea = { x: left.x, y: left.y + left.h * 0.18, w: left.w, h: left.h * 0.64 };
    const titleHeight = generatedTitle ? textBlockHeight(ctx.spec, 'chapterTitle', 2) : 0;
    const contentArea = generatedTitle && assigned.some((slot) => slot.assets.length)
      ? { ...textArea, y: textArea.y + titleHeight + ctx.gap, h: textArea.h - titleHeight - ctx.gap }
      : textArea;
    const frames = buildTextSlotFrames(ctx.spec, contentArea, ctx.gap, assigned);
    if (generatedTitle) {
      Object.assign(generatedTitle, {
        x: textArea.x, y: textArea.y + (frames.length ? 0 : (textArea.h - titleHeight) / 2), w: textArea.w, h: titleHeight,
      });
      frames.unshift(generatedTitle);
    }
    return [...frames, imageFrame(right, ctx.images[0])];
  },
};

/** T10 — Panorama Spread: one wide image across both halves of a spread. */
const T10: TemplateDefinition = {
  id: 'T10',
  name: '跨页全景',
  family: 'spread',
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
