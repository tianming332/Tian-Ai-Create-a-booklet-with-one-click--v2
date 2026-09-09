import { useProject } from '../store/useProject';
import { ThemeCapsule } from './ThemeCapsule';

/**
 * Top bar. Each stage shows only what that stage needs: picking a template has
 * no chrome at all, the preview offers 重新排版 / 编辑 / 导出, and the editor adds
 * history, zoom and settings.
 */
export function Toolbar(props: { onExport: () => void }): JSX.Element {
  const store = useProject();
  const { pages, view, past, future } = store;
  const editing = view.stage === 'edit';

  return (
    <header className="toolbar">
      <span className="brand">
        <a
          className="tjm-link"
          href="https://tianming332.github.io/JiangmingTian_Portfolio_Final/"
          target="_blank"
          rel="noreferrer"
          aria-label="返回 TJM 个人作品集"
          title="返回 TJM 个人作品集"
        >
          <img src={`${import.meta.env.BASE_URL}brand/tjm-logo.png`} alt="TJM" />
        </a>
        一键成册
        <em>autobook</em>
      </span>

      {view.stage === 'preview' ? (
        <div className="group">
          <button onClick={() => store.setStage('compose')} title="换一个模版重新排版">
            重新排版
          </button>
          <button onClick={() => store.setStage('edit')} title="逐页微调">
            编辑
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="group">
          <button onClick={store.undo} disabled={past.length === 0} title="撤销 (⌘Z)">
            撤销
          </button>
          <button onClick={store.redo} disabled={future.length === 0} title="重做 (⌘⇧Z)">
            重做
          </button>
          <button onClick={() => store.setStage('preview')} title="看整本画册">
            预览
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="group">
          <button onClick={() => store.setZoom(view.zoom - 0.25)} title="缩小">
            −
          </button>
          <button onClick={() => store.setZoom(1)} title="回到适应窗口">
            {Math.round(view.zoom * 100)}%
          </button>
          <button onClick={() => store.setZoom(view.zoom + 0.25)} title="放大">
            +
          </button>
        </div>
      ) : null}

      <span className="spacer" />

      <ThemeCapsule />

      {view.stage === 'compose' ? null : (
        <>
          <span className="rule" />
          <div className="group">
            {editing ? (
              <button onClick={() => store.setSettingsOpen(!view.settingsOpen)}>设置</button>
            ) : null}
            <button className="primary" onClick={props.onExport} disabled={pages.length === 0}>
              导出 PDF
            </button>
          </div>
        </>
      )}
    </header>
  );
}
