import {
  BUILTIN_STYLES,
  parseBookStyle,
  serializeStyle,
  type BookStyle,
} from '../engine/layout/bookStyle';

const KEY = 'autobook.styles.v1';
const MAX_CUSTOM = 24;

/**
 * Imported styles live in localStorage, not in the project: they are a personal
 * library that outlives a single album. The engine never reads this file.
 */
export function loadCustomStyles(): BookStyle[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      try {
        return [parseBookStyle(item)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function write(styles: BookStyle[]): BookStyle[] {
  const capped = styles.slice(0, MAX_CUSTOM);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(capped));
  } catch {
    // Storage full or blocked: the style still applies to this session.
  }
  return capped;
}

/** Adds or replaces a style by id and returns the new library. */
export function saveCustomStyle(style: BookStyle): BookStyle[] {
  const rest = loadCustomStyles().filter((item) => item.id !== style.id);
  return write([style, ...rest]);
}

export function deleteCustomStyle(id: string): BookStyle[] {
  return write(loadCustomStyles().filter((item) => item.id !== id));
}

export function allStyles(customs: BookStyle[]): BookStyle[] {
  return [...BUILTIN_STYLES, ...customs];
}

/** Reads a .json template file; throws a Chinese message when unusable. */
export async function readStyleFile(file: File): Promise<BookStyle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('模版文件不是有效的 JSON。');
  }
  return parseBookStyle(parsed);
}

/** Saves a style to disk as a shareable .json file. */
export function downloadStyle(style: BookStyle): void {
  const blob = new Blob([serializeStyle(style)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${style.name || 'template'}.autobook.json`;
  link.click();
  URL.revokeObjectURL(url);
}
