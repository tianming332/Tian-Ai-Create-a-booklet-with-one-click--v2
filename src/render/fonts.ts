import type { TextRole } from '../shared/types';

export type FontKey = 'sans' | 'serif';

/** Families registered by `loadPreviewFonts`; kept in sync with the PDF embedder. */
export const PREVIEW_FAMILY: Record<FontKey, string> = {
  sans: 'AutoBook Sans',
  serif: 'AutoBook Sans',
};

export const FONT_FILES: Record<FontKey, string> = {
  sans: 'NotoSansSC-Regular.otf',
  serif: 'NotoSansSC-Regular.otf',
};

const FALLBACK: Record<FontKey, string> = {
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  serif: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
};

/** Absolute URL of a bundled font, honouring the Vite base path. */
export function fontUrl(key: FontKey): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.replace(/\/$/, '')}/fonts/${FONT_FILES[key]}`;
}

export function fontRoleKey(role: TextRole | undefined): FontKey {
  void role;
  return 'sans';
}

/** CSS font shorthand for a canvas context at a given px size. */
export function cssFont(key: FontKey, sizePx: number): string {
  return `${sizePx}px ${PREVIEW_FAMILY[key]}, ${FALLBACK[key]}`;
}

const loaded: Partial<Record<FontKey, boolean>> = {};
let loadingAll: Promise<Record<FontKey, boolean>> | undefined;

/**
 * Registers the bundled CJK fonts for canvas preview. Missing files are not an
 * error: the preview falls back to system fonts and Preflight reports it.
 */
export function loadPreviewFonts(): Promise<Record<FontKey, boolean>> {
  if (loadingAll) return loadingAll;
  loadingAll = (async () => {
    const keys: FontKey[] = ['sans', 'serif'];
    await Promise.all(
      keys.map(async (key) => {
        if (loaded[key] !== undefined) return;
        if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
          loaded[key] = false;
          return;
        }
        try {
          const face = new FontFace(PREVIEW_FAMILY[key], `url(${fontUrl(key)})`);
          await face.load();
          document.fonts.add(face);
          loaded[key] = true;
        } catch {
          loaded[key] = false;
        }
      }),
    );
    return { sans: loaded.sans ?? false, serif: loaded.serif ?? false };
  })();
  return loadingAll;
}

export function fontsLoaded(): Record<FontKey, boolean> {
  return { sans: loaded.sans ?? false, serif: loaded.serif ?? false };
}
