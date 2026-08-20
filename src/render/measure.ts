import type { MeasureText } from '../engine/text/textLayout';
import { mmToPt, ptToMm } from '../shared/units';
import { cssFont, type FontKey } from './fonts';

const REFERENCE_PX = 100;

/**
 * Canvas text measurer. Widths are measured once at a reference size and scaled,
 * which keeps line breaking independent of the preview zoom level.
 */
export function canvasMeasure(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  key: FontKey,
): MeasureText {
  const cache = new Map<string, number>();
  const previous = ctx.font;
  ctx.font = cssFont(key, REFERENCE_PX);
  const measurer: MeasureText = (text, sizePt) => {
    let unit = cache.get(text);
    if (unit === undefined) {
      ctx.font = cssFont(key, REFERENCE_PX);
      unit = ctx.measureText(text).width / REFERENCE_PX;
      cache.set(text, unit);
    }
    // Reference width is in px at REFERENCE_PX; pt and px share the same scale here
    // because both are expressed relative to the font size.
    return unit * sizePt;
  };
  ctx.font = previous;
  return measurer;
}

/** Font size in preview pixels for a pt size. */
export function ptToPreviewPx(sizePt: number, pxPerMm: number): number {
  return ptToMm(sizePt) * pxPerMm;
}

export function previewPxToPt(sizePx: number, pxPerMm: number): number {
  return mmToPt(sizePx / pxPerMm);
}
