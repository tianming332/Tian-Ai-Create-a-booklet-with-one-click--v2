import { useEffect, useState } from 'react';
import { loadPreviewFonts } from '../render/fonts';
import { startAutosave } from '../store/persist';
import { useProject } from '../store/useProject';
import { AssetPanel } from './AssetPanel';
import { BookPreview } from './BookPreview';
import { Composer } from './Composer';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { Landing } from './Landing';
import { PageStrip } from './PageStrip';
import { SettingsDrawer } from './SettingsDrawer';
import { SpreadStage } from './SpreadStage';
import { Toolbar } from './Toolbar';
import { buildSpreads } from './hooks';

export function App(): JSX.Element {
  const store = useProject();
  const { status, progress, view, toast } = store;
  const fontsVersion = usePreviewFonts();
  const [exportOpen, setExportOpen] = useState(false);
  // Panel collapse is pure chrome state: kept local so it stays out of undo.
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  useShortcuts();

  useEffect(() => startAutosave(), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => store.setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast, store]);

  if (status === 'empty' && !progress) return <Landing />;

  return (
    <div className="app">
      <Toolbar onExport={() => setExportOpen(true)} />
      {view.stage === 'compose' ? (
        <Composer />
      ) : view.stage === 'preview' ? (
        <BookPreview fontsVersion={fontsVersion} />
      ) : (
        <div className="workspace">
          {leftOpen ? (
            <AssetPanel onCollapse={() => setLeftOpen(false)} />
          ) : (
            <div className="rail">
              <button onClick={() => setLeftOpen(true)} title="展开素材栏">
                ›
              </button>
              <span className="vertical">material</span>
            </div>
          )}
          <main className="center">
            <SpreadStage fontsVersion={fontsVersion} />
            <PageStrip />
          </main>
          {rightOpen ? (
            <Inspector onCollapse={() => setRightOpen(false)} />
          ) : (
            <div className="rail right">
              <button onClick={() => setRightOpen(true)} title="展开属性栏">
                ‹
              </button>
              <span className="vertical">page</span>
            </div>
          )}
        </div>
      )}
      {view.settingsOpen ? <SettingsDrawer /> : null}
      {exportOpen ? <ExportDialog onClose={() => setExportOpen(false)} /> : null}
      {progress ? (
        <div className="progress">
          <div className="card">
            <strong>{progress.label}</strong>
            <div className="bar">
              <i
                style={{
                  width: `${progress.total ? (progress.done / progress.total) * 100 : 30}%`,
                }}
              />
            </div>
            <span className="hint">
              {progress.done} / {progress.total}
            </span>
          </div>
        </div>
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

/** Registers the bundled CJK fonts; the counter forces canvases to repaint. */
function usePreviewFonts(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    void loadPreviewFonts().then(() => setVersion((n) => n + 1));
  }, []);
  return version;
}

function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      const store = useProject.getState();

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (typing) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const spreads = buildSpreads(store.pages);
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        const next = Math.max(0, Math.min(spreads.length - 1, store.view.spreadIndex + delta));
        event.preventDefault();
        store.showSpread(next);
        store.select({ pageId: spreads[next]?.pages[0]?.id });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
