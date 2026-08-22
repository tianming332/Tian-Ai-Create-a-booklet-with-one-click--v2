import { useEffect, useState } from 'react';
import { applyTheme, readTheme, THEMES, type Theme } from './theme';

/**
 * Collapsible theme cluster in the top-right corner (the pull-out block marked
 * in the reference screenshot). Collapsed it is a single capsule button so it
 * never crowds the export/settings actions.
 */
export function ThemeCapsule(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  if (!open) {
    return (
      <button className="chip" onClick={() => setOpen(true)} title="页面配色">
        ‹ 配色
      </button>
    );
  }

  return (
    <div className="capsule">
      <span className="cap-label">
        配色
        <em>theme</em>
      </span>
      <div className="cap-items">
        {THEMES.map((entry) => (
          <button
            key={entry.id}
            className={entry.id === theme ? 'active' : undefined}
            onClick={() => setTheme(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <button className="cap-toggle" onClick={() => setOpen(false)} title="收起">
        ›
      </button>
    </div>
  );
}
