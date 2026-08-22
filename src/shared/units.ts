/** Millimetre. All layout geometry in AutoBook is authored in mm. */
export type Mm = number;
/** PDF point. 1 inch = 72 pt = 25.4 mm. */
export type Pt = number;

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export function mmToPt(mm: Mm): Pt {
  return (mm * PT_PER_INCH) / MM_PER_INCH;
}

export function ptToMm(pt: Pt): Mm {
  return (pt * MM_PER_INCH) / PT_PER_INCH;
}

export function mmToInch(mm: Mm): number {
  return mm / MM_PER_INCH;
}

export function inchToMm(inch: number): Mm {
  return inch * MM_PER_INCH;
}

/** Preview scale: how many CSS px represent 1 mm at a given zoom. */
export function mmToPreviewPx(mm: Mm, pxPerMm: number): number {
  return mm * pxPerMm;
}

export function previewPxToMm(px: number, pxPerMm: number): Mm {
  return px / pxPerMm;
}

/**
 * Effective DPI of a raster image placed into a frame of physical size.
 * The limiting axis decides, because the placed image is scaled uniformly.
 */
export function effectiveDpi(
  sourceWidthPx: number,
  sourceHeightPx: number,
  placedWidthMm: Mm,
  placedHeightMm: Mm,
): number {
  const wIn = mmToInch(placedWidthMm);
  const hIn = mmToInch(placedHeightMm);
  if (wIn <= 0 || hIn <= 0) return 0;
  return Math.min(sourceWidthPx / wIn, sourceHeightPx / hIn);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function round(value: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
