import type { MeasureText } from '../engine/text/textLayout';
import { mediaSize, placeImage, safeRect } from '../shared/geometry';
import type { Asset, LayoutFrame, Page, PageSpec } from '../shared/types';
import type { Mm } from '../shared/units';
import { fontRoleKey, cssFont, type FontKey } from './fonts';
import { canvasMeasure, ptToPreviewPx } from './measure';
import { frameText, placeTextFrame } from './textBox';

export type PreviewImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export interface PreviewOverlays {
  bleed: boolean;
  safeArea: boolean;
  frames: boolean;
}

export interface RenderPageInput {
  ctx: CanvasRenderingContext2D;
  spec: PageSpec;
  page: Page;
  side: 'left' | 'right' | 'single';
  assets: Map<string, Asset>;
  images: Map<string, PreviewImage>;
  pxPerMm: number;
  overlays?: Partial<PreviewOverlays>;
  selectedFrameId?: string;
}

const measurers = new WeakMap<CanvasRenderingContext2D, Partial<Record<FontKey, MeasureText>>>();

function measurerFor(ctx: CanvasRenderingContext2D, key: FontKey): MeasureText {
  let entry = measurers.get(ctx);
  if (!entry) {
    entry = {};
    measurers.set(ctx, entry);
  }
  let m = entry[key];
  if (!m) {
    m = canvasMeasure(ctx, key);
    entry[key] = m;
  }
  return m;
}

/** Invalidate cached text widths, e.g. after the real fonts finish loading. */
export function resetMeasureCache(ctx: CanvasRenderingContext2D): void {
  measurers.delete(ctx);
}

/** Pixel size of the canvas needed for one page at a given scale. */
export function pageCanvasSize(spec: PageSpec, pxPerMm: number): { w: number; h: number } {
  const media = mediaSize(spec);
  return { w: Math.round(media.w * pxPerMm), h: Math.round(media.h * pxPerMm) };
}

export function renderPage(input: RenderPageInput): void {
  const { ctx, spec, page, pxPerMm } = input;
  const overlays: PreviewOverlays = {
    bleed: false,
    safeArea: false,
    frames: false,
    ...input.overlays,
  };
  const size = pageCanvasSize(spec, pxPerMm);
  const px = (mm: Mm) => mm * pxPerMm;

  ctx.save();
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = spec.background || '#ffffff';
  ctx.fillRect(0, 0, size.w, size.h);
  // Page coordinates: origin at the top-left of the trim box.
  ctx.translate(px(spec.bleed), px(spec.bleed));

  if (!page.isBlank) {
    for (const frame of page.frames) {
      if (frame.kind === 'image') drawImageFrame(input, frame, px);
      else drawTextFrame(input, frame, px);
    }
  }

  if (overlays.frames) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(59,130,246,0.55)';
    for (const frame of page.frames) {
      ctx.strokeRect(px(frame.x), px(frame.y), px(frame.w), px(frame.h));
    }
  }
  if (input.selectedFrameId) {
    const frame = page.frames.find((f) => f.id === input.selectedFrameId);
    if (frame) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2563eb';
      ctx.setLineDash([]);
      ctx.strokeRect(px(frame.x), px(frame.y), px(frame.w), px(frame.h));
    }
  }
  if (overlays.safeArea) {
    const safe = safeRect(spec, input.side);
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(16,185,129,0.8)';
    ctx.strokeRect(px(safe.x), px(safe.y), px(safe.w), px(safe.h));
    ctx.setLineDash([]);
  }
  if (overlays.bleed) {
    ctx.setLineDash([6, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(239,68,68,0.85)';
    ctx.strokeRect(0, 0, px(spec.trimWidth), px(spec.trimHeight));
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawImageFrame(input: RenderPageInput, frame: LayoutFrame, px: (mm: Mm) => number): void {
  const { ctx } = input;
  const asset = frame.assetId ? input.assets.get(frame.assetId) : undefined;
  const image = frame.assetId ? input.images.get(frame.assetId) : undefined;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px(frame.x), px(frame.y), px(frame.w), px(frame.h));
  ctx.clip();
  if (image) {
    const aspect =
      asset?.visual?.aspectRatio ??
      (image.width && image.height ? image.width / image.height : frame.w / frame.h);
    const rect = placeImage(frame, aspect, frame.fit ?? 'fill', frame.focus);
    ctx.drawImage(image, px(rect.x), px(rect.y), px(rect.w), px(rect.h));
  } else {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(px(frame.x), px(frame.y), px(frame.w), px(frame.h));
    ctx.fillStyle = '#9ca3af';
    ctx.font = cssFont('sans', Math.max(9, px(4)));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const label = asset?.meta.fileName ?? '加载中';
    ctx.fillText(label, px(frame.x + frame.w / 2), px(frame.y + frame.h / 2), px(frame.w) - 8);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawTextFrame(input: RenderPageInput, frame: LayoutFrame, px: (mm: Mm) => number): void {
  const { ctx, spec } = input;
  const text = frameText(frame, input.assets);
  if (!text.trim()) return;
  const key = fontRoleKey(frame.textRole);
  const placed = placeTextFrame({ frame, spec, text, measure: measurerFor(ctx, key) });
  ctx.save();
  ctx.beginPath();
  ctx.rect(px(frame.x) - 1, px(frame.y) - 1, px(frame.w) + 2, px(frame.h) + 2);
  ctx.clip();
  ctx.fillStyle = frame.color ?? '#111827';
  ctx.font = cssFont(key, ptToPreviewPx(placed.sizePt, input.pxPerMm));
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const line of placed.lines) {
    ctx.fillText(line.text, px(line.xMm), px(line.baselineMm));
  }
  ctx.restore();
}
