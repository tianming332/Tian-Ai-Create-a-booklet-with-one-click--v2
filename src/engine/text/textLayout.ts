import { MIN_BODY_PT } from '../../shared/constants';
import type { PageSpec, TextRole } from '../../shared/types';
import { mmToPt, ptToMm, type Mm } from '../../shared/units';
import { textStyle } from '../layout/style';

/** Width of `text` at `sizePt`, in pt. Canvas and pdf-lib both provide one. */
export type MeasureText = (text: string, sizePt: number) => number;

/** Characters that may not start a line (行首禁则). */
const NO_LINE_START = new Set(
  '、。，．！？；：）〕］｝〉》」』】,.!?;:)]}>»”’…～ー・％‰℃°'.split(''),
);
/** Characters that may not end a line (行尾禁则). */
const NO_LINE_END = new Set('（〔［｛〈《「『【([{<«“‘#$￥'.split(''));

const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;
const LATIN_WORD = /[A-Za-z0-9@#$%&'’\-_/\\.+*=<>~^]/;

/** Splits text into unbreakable units honouring 禁则 rules. */
export function segmentUnits(text: string): string[] {
  const units: string[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\n') {
      units.push('\n');
      i += 1;
      continue;
    }
    if (char === ' ' || char === '\t') {
      // Spaces ride along with the previous unit so they never open a line.
      if (units.length && units[units.length - 1] !== '\n') units[units.length - 1] += ' ';
      i += 1;
      continue;
    }
    let unit = char;
    i += 1;
    if (LATIN_WORD.test(char)) {
      while (i < text.length && LATIN_WORD.test(text[i])) {
        unit += text[i];
        i += 1;
      }
    }
    // Trailing punctuation that cannot start a line joins this unit.
    while (i < text.length && NO_LINE_START.has(text[i])) {
      unit += text[i];
      i += 1;
    }
    // Opening punctuation cannot end a line, so it prefixes the next unit.
    if (NO_LINE_END.has(unit[unit.length - 1]) && i < text.length) {
      let next = text[i];
      i += 1;
      if (LATIN_WORD.test(next)) {
        while (i < text.length && LATIN_WORD.test(text[i])) {
          next += text[i];
          i += 1;
        }
      }
      unit += next;
      while (i < text.length && NO_LINE_START.has(text[i])) {
        unit += text[i];
        i += 1;
      }
    }
    units.push(unit);
  }
  return units;
}

/** Greedy line breaking; hard-splits units that are wider than the box. */
export function wrapUnits(
  units: string[],
  maxWidthPt: number,
  sizePt: number,
  measure: MeasureText,
): string[] {
  const lines: string[] = [];
  let line = '';
  const flush = () => {
    lines.push(line);
    line = '';
  };
  for (const unit of units) {
    if (unit === '\n') {
      flush();
      continue;
    }
    const candidate = line + unit;
    if (line === '' || measure(candidate.trimEnd(), sizePt) <= maxWidthPt) {
      if (measure(unit.trimEnd(), sizePt) > maxWidthPt && line === '') {
        // Single unit too wide: split by character.
        let chunk = '';
        for (const char of unit) {
          if (chunk && measure(chunk + char, sizePt) > maxWidthPt) {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        line = chunk;
        continue;
      }
      line = candidate;
    } else {
      flush();
      line = unit;
    }
  }
  if (line !== '') lines.push(line);
  return lines.map((l) => l.trimEnd());
}

/**
 * Width approximation used by tests and by any renderer without a real font
 * metric source: CJK glyphs are full-width, latin roughly half-width.
 */
export function createApproxMeasure(): MeasureText {
  return (text, sizePt) => {
    let units = 0;
    for (const char of text) {
      if (char === ' ') units += 0.32;
      else if (CJK.test(char)) units += 1;
      else units += 0.52;
    }
    return units * sizePt;
  };
}

export interface TextLayoutRequest {
  text: string;
  role: TextRole;
  spec: PageSpec;
  box: { w: Mm; h: Mm };
  measure: MeasureText;
  /** Allow shrinking down to 80% (never below MIN_BODY_PT) before truncating. */
  allowShrink?: boolean;
}

export interface TextLayoutResult {
  lines: string[];
  sizePt: number;
  lineHeightMm: Mm;
  /** Total height of the laid-out lines. */
  heightMm: Mm;
  /** Text did not fit even after shrinking and truncation. */
  overflow: boolean;
  truncated: boolean;
  shrunk: boolean;
}

/** Lines that fit in `height` at a given size, respecting the role's maxLines. */
function capacity(role: TextRole, spec: PageSpec, height: Mm, sizePt: number): number {
  const style = textStyle(spec, role);
  const lineMm = ptToMm(sizePt * style.lineHeight);
  const byHeight = Math.max(0, Math.floor(height / lineMm + 0.001));
  return style.maxLines > 0 ? Math.min(style.maxLines, byHeight) : byHeight;
}

/**
 * Breaks `text` into lines that fit `box`, shrinking then truncating per the
 * overflow ladder. Deterministic for a given measure function.
 */
export function layoutText(req: TextLayoutRequest): TextLayoutResult {
  const style = textStyle(req.spec, req.role);
  const units = segmentUnits(req.text.trim());
  const maxWidthPt = mmToPt(req.box.w);
  const floorPt = Math.max(MIN_BODY_PT, style.size * 0.8);

  let sizePt = style.size;
  let lines = wrapUnits(units, maxWidthPt, sizePt, req.measure);
  let allowed = capacity(req.role, req.spec, req.box.h, sizePt);

  if (req.allowShrink !== false) {
    while (lines.length > allowed && sizePt - 0.5 >= floorPt - 1e-6) {
      sizePt = Math.round((sizePt - 0.5) * 100) / 100;
      lines = wrapUnits(units, maxWidthPt, sizePt, req.measure);
      allowed = capacity(req.role, req.spec, req.box.h, sizePt);
    }
  }

  let truncated = false;
  let overflow = false;
  if (lines.length > allowed) {
    if (allowed <= 0) {
      lines = [];
      overflow = true;
      truncated = true;
    } else {
      const kept = lines.slice(0, allowed);
      const last = kept[allowed - 1];
      kept[allowed - 1] = ellipsize(last, maxWidthPt, sizePt, req.measure);
      lines = kept;
      truncated = true;
      overflow = true;
    }
  }

  const lineHeightMm = ptToMm(sizePt * style.lineHeight);
  return {
    lines,
    sizePt,
    lineHeightMm,
    heightMm: lineHeightMm * lines.length,
    overflow,
    truncated,
    shrunk: sizePt < style.size,
  };
}

/** Appends an ellipsis, dropping characters until the line fits again. */
function ellipsize(line: string, maxWidthPt: number, sizePt: number, measure: MeasureText): string {
  const chars = Array.from(line.trimEnd());
  while (chars.length && measure(chars.join('') + '…', sizePt) > maxWidthPt) chars.pop();
  while (chars.length && NO_LINE_END.has(chars[chars.length - 1])) chars.pop();
  return chars.join('') + '…';
}
