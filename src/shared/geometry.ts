import type { LayoutFrame, PageSpec } from './types';
import type { Mm } from './units';

export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

/** Trim box in page coordinates (origin = top-left of trim). */
export function trimRect(spec: PageSpec): Rect {
  return { x: 0, y: 0, w: spec.trimWidth, h: spec.trimHeight };
}

/** Media box = trim + bleed on all four sides. */
export function mediaSize(spec: PageSpec): { w: Mm; h: Mm } {
  return { w: spec.trimWidth + spec.bleed * 2, h: spec.trimHeight + spec.bleed * 2 };
}

/**
 * Live area for a single page. `side` decides which edge gets the gutter,
 * so inner margins stay in the spine for both halves of a spread.
 */
export function safeRect(spec: PageSpec, side: 'left' | 'right' | 'single' = 'single'): Rect {
  const m = spec.safeMargin;
  const inner = Math.max(spec.gutter, m);
  const left = side === 'right' ? inner : m;
  const right = side === 'left' ? inner : m;
  return {
    x: left,
    y: m,
    w: spec.trimWidth - left - right,
    h: spec.trimHeight - m * 2,
  };
}

/** Full-bleed rect for a page, expressed in trim coordinates (negative origin). */
export function bleedRect(spec: PageSpec): Rect {
  return {
    x: -spec.bleed,
    y: -spec.bleed,
    w: spec.trimWidth + spec.bleed * 2,
    h: spec.trimHeight + spec.bleed * 2,
  };
}

export function insetRect(rect: Rect, inset: Mm): Rect {
  return { x: rect.x + inset, y: rect.y + inset, w: rect.w - inset * 2, h: rect.h - inset * 2 };
}

/** Splits a rect into `count` columns separated by `gap`. */
export function splitColumns(rect: Rect, count: number, gap: Mm): Rect[] {
  const w = (rect.w - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({
    x: rect.x + i * (w + gap),
    y: rect.y,
    w,
    h: rect.h,
  }));
}

export function splitRows(rect: Rect, count: number, gap: Mm): Rect[] {
  const h = (rect.h - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => ({
    x: rect.x,
    y: rect.y + i * (h + gap),
    w: rect.w,
    h,
  }));
}

/** Splits a rect into two rows with a weighted first row. */
export function splitRowsWeighted(rect: Rect, firstWeight: number, gap: Mm): [Rect, Rect] {
  const usable = rect.h - gap;
  const h1 = usable * firstWeight;
  return [
    { x: rect.x, y: rect.y, w: rect.w, h: h1 },
    { x: rect.x, y: rect.y + h1 + gap, w: rect.w, h: usable - h1 },
  ];
}

export function splitColumnsWeighted(rect: Rect, firstWeight: number, gap: Mm): [Rect, Rect] {
  const usable = rect.w - gap;
  const w1 = usable * firstWeight;
  return [
    { x: rect.x, y: rect.y, w: w1, h: rect.h },
    { x: rect.x + w1 + gap, y: rect.y, w: usable - w1, h: rect.h },
  ];
}

/**
 * Geometry of an image inside a frame under fill/fit + focus.
 * Returns the drawn image rect in page mm, possibly larger than the frame (fill).
 */
export function placeImage(
  frame: Pick<LayoutFrame, 'x' | 'y' | 'w' | 'h'>,
  imageAspect: number,
  fit: 'fill' | 'fit',
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Rect {
  const frameAspect = frame.w / frame.h;
  let w: number;
  let h: number;
  const cover = fit === 'fill';
  if (cover === imageAspect > frameAspect) {
    // fill + wider image, or fit + taller-than-frame ratio: height drives.
    h = frame.h;
    w = h * imageAspect;
  } else {
    w = frame.w;
    h = w / imageAspect;
  }
  const overflowX = w - frame.w;
  const overflowY = h - frame.h;
  return {
    x: frame.x - overflowX * (overflowX > 0 ? focus.x : 0.5),
    y: frame.y - overflowY * (overflowY > 0 ? focus.y : 0.5),
    w,
    h,
  };
}

/** Fraction of the source image discarded when filling the frame (spec 11.2). */
export function cropLoss(frameW: Mm, frameH: Mm, imageAspect: number): number {
  const frameAspect = frameW / frameH;
  const ratio = frameAspect > imageAspect ? imageAspect / frameAspect : frameAspect / imageAspect;
  return 1 - ratio;
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0.01): boolean {
  return (
    a.x + a.w > b.x + tolerance &&
    b.x + b.w > a.x + tolerance &&
    a.y + a.h > b.y + tolerance &&
    b.y + b.h > a.y + tolerance
  );
}

export function rectWithin(inner: Rect, outer: Rect, tolerance = 0.01): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  );
}
