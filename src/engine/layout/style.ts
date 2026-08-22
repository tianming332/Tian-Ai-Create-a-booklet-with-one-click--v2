import { TEXT_STYLES } from '../../shared/constants';
import type { PageSpec, TextRole } from '../../shared/types';
import { ptToMm, type Mm } from '../../shared/units';

export interface TextStyle {
  size: number;
  lineHeight: number;
  maxLines: number;
}

/** A5 metrics for small pages, A4 metrics otherwise (custom sizes included). */
export function styleSetFor(spec: PageSpec): Record<TextRole, TextStyle> {
  const area = spec.trimWidth * spec.trimHeight;
  return area <= 148 * 210 * 1.2 ? TEXT_STYLES.A5 : TEXT_STYLES.A4;
}

export function textStyle(spec: PageSpec, role: TextRole): TextStyle {
  return styleSetFor(spec)[role];
}

/** Height in mm of `lines` lines of a role, in mm. */
export function textBlockHeight(spec: PageSpec, role: TextRole, lines: number): Mm {
  const style = textStyle(spec, role);
  return ptToMm(style.size * style.lineHeight * lines);
}

/** Rough line capacity of a text box; refined by the real line breaker later. */
export function linesThatFit(spec: PageSpec, role: TextRole, height: Mm): number {
  const style = textStyle(spec, role);
  const lineMm = ptToMm(style.size * style.lineHeight);
  return Math.max(0, Math.floor(height / lineMm + 0.001));
}
