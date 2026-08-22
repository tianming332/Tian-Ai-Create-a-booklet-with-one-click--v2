import { layoutText, type MeasureText } from '../engine/text/textLayout';
import { textStyle } from '../engine/layout/style';
import type { Asset, LayoutFrame, PageSpec, TextRole } from '../shared/types';
import { ptToMm, type Mm } from '../shared/units';

export interface PlacedLine {
  text: string;
  /** Left edge of the line in page mm (already aligned). */
  xMm: Mm;
  /** Baseline position in page mm, measured from the top of the page. */
  baselineMm: Mm;
  widthMm: Mm;
}

export interface PlacedText {
  lines: PlacedLine[];
  sizePt: number;
  lineHeightMm: Mm;
  overflow: boolean;
  truncated: boolean;
  shrunk: boolean;
}

/** Fraction of the em box above the baseline; matches Noto Sans/Serif closely. */
const ASCENT_RATIO = 0.78;

function verticalAlign(role: TextRole | undefined): 'top' | 'center' {
  return role === 'sentence' || role === 'chapterTitle' || role === 'pageNumber' ? 'center' : 'top';
}

/** Text of a frame: explicit override first, then the bound asset. */
export function frameText(frame: LayoutFrame, assets: Map<string, Asset>): string {
  if (frame.textOverride !== undefined) return frame.textOverride;
  const asset = frame.assetId ? assets.get(frame.assetId) : undefined;
  return asset?.text ?? '';
}

/**
 * Breaks and positions the text of a frame. Preview and PDF share this so a
 * page looks identical in both, down to the line breaks.
 */
export function placeTextFrame(options: {
  frame: LayoutFrame;
  spec: PageSpec;
  text: string;
  measure: MeasureText;
}): PlacedText {
  const { frame, spec, text } = options;
  const role: TextRole = frame.textRole ?? 'body';
  const style = textStyle(spec, role);
  const laid = layoutText({
    text,
    role,
    spec,
    box: { w: frame.w, h: frame.h },
    measure: options.measure,
  });

  const lineHeightMm = laid.lineHeightMm;
  const blockHeight = lineHeightMm * laid.lines.length;
  const topMm =
    verticalAlign(role) === 'center'
      ? frame.y + Math.max(0, (frame.h - blockHeight) / 2)
      : frame.y;
  const ascentMm = ptToMm(laid.sizePt * ASCENT_RATIO);
  const align = frame.align ?? (role === 'sentence' || role === 'chapterTitle' ? 'left' : 'left');

  const lines: PlacedLine[] = laid.lines.map((line, i) => {
    const widthMm = ptToMm(options.measure(line, laid.sizePt));
    let xMm = frame.x;
    if (align === 'center') xMm = frame.x + (frame.w - widthMm) / 2;
    else if (align === 'right') xMm = frame.x + frame.w - widthMm;
    const leading = (lineHeightMm - ptToMm(laid.sizePt)) / 2;
    return { text: line, xMm, widthMm, baselineMm: topMm + i * lineHeightMm + leading + ascentMm };
  });

  return {
    lines,
    sizePt: laid.sizePt,
    lineHeightMm,
    overflow: laid.overflow,
    truncated: laid.truncated,
    shrunk: laid.sizePt < style.size,
  };
}
