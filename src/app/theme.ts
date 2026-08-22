/**
 * Theme is a presentation-only preference, so it lives outside the project
 * store: it must survive `reset()` and never enter undo history.
 */
export type Theme = 'light' | 'grey' | 'dark';

const KEY = 'autobook.theme';

export const THEMES: ReadonlyArray<{ id: Theme; label: string }> = [
  { id: 'light', label: '白' },
  { id: 'grey', label: '灰' },
  { id: 'dark', label: '黑' },
];

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'grey' || value === 'dark';
}

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Private browsing can throw on access; fall back to the default.
  }
  return 'light';
}

/** Writes `data-theme` on <html>; the CSS token blocks key off that attribute. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Ignore quota/permission errors: the theme still applies for this session.
  }
}
