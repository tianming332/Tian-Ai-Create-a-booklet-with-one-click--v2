import { useMemo } from 'react';
import { templateById } from '../engine/layout/templates';
import { frameText } from '../render/textBox';
import * as cmd from '../store/commands';
import type { BookState } from '../store/commands';
import { useProject } from '../store/useProject';

/** Right panel: page-level and frame-level manual tuning. */
export function Inspector(props: { onCollapse: () => void }): JSX.Element {
  const store = useProject();
  const { pages, assets, view } = store;
  const book: BookState = useMemo(
    () => ({
      pageSpec: store.pageSpec,
      grouping: store.grouping,
      assets: store.assets,
      groups: store.groups,
      pages: store.pages,
    }),
    [store.pageSpec, store.grouping, store.assets, store.groups, store.pages],
  );

  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const page = pages.find((p) => p.id === view.selection.pageId) ?? pages[0];
  const frame = page?.frames.find((f) => f.id === view.selection.frameId);
  const alternatives = useMemo(
    () => (page ? cmd.templateAlternatives(book, page.id) : []),
    [book, page],
  );

  if (!page) {
    return (
      <aside className="side right">
        <h3>
          <button className="panel-toggle" onClick={props.onCollapse} title="收起属性栏">
            ›
          </button>
          <span>页面</span>
          <em>page</em>
        </h3>
        <div className="body">
          <span className="hint">还没有页面。</span>
        </div>
      </aside>
    );
  }

  const def = templateById(page.templateId);
  const imageFrames = page.frames.filter((f) => f.kind === 'image');

  return (
    <aside className="side right">
      <h3>
        <button className="panel-toggle" onClick={props.onCollapse} title="收起属性栏">
          ›
        </button>
        <span>{page.index === 0 ? '封面' : `第 ${page.index} 页`}</span>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {def?.name ?? page.templateId}
        </span>
      </h3>
      <div className="body">
        <div>
          <label>
            版式<em>template</em>
          </label>
          <div className="chips">
            {alternatives.map((id) => (
              <button
                key={id}
                className={id === page.templateId ? 'chip active' : 'chip'}
                onClick={() => store.setPageTemplate(page.id, id)}
              >
                {templateById(id)?.name ?? id}
              </button>
            ))}
            {alternatives.length === 0 && <span className="hint">没有其他可用版式</span>}
          </div>
        </div>
        <div>
          <label>
            页面顺序<em>order</em>
          </label>
          <div className="chips">
            <button
              className="chip"
              disabled={page.index === 0}
              onClick={() => store.movePage(page.id, page.index - 1)}
            >
              前移
            </button>
            <button
              className="chip"
              disabled={page.index === 0 || page.index >= pages.length - 1}
              onClick={() => store.movePage(page.id, page.index + 1)}
            >
              后移
            </button>
            <button className="chip" onClick={() => store.insertBlankPage(page.index)}>
              插入空白页
            </button>
          </div>
        </div>
        <div>
          <label>
            页面操作<em>page</em>
          </label>
          <div className="chips">
            <button className="chip" onClick={() => store.togglePageLock(page.id)}>
              {page.locked ? '解锁页面' : '锁定页面'}
            </button>
            {page.spreadPartnerOf || def?.spread ? (
              <button className="chip" onClick={() => store.splitSpread(page.id)}>
                拆分跨页
              </button>
            ) : null}
            <button
              className="chip"
              disabled={page.index === 0}
              onClick={() => store.deletePage(page.id)}
            >
              删除页
            </button>
          </div>
        </div>
        {frame ? (
          <label>
            所选{frame.kind === 'text' ? '文字' : '图片'}
            <em>selection</em>
          </label>
        ) : null}
        {frame && frame.kind === 'image' && (
          <>
            <div>
              <label>
                裁切方式<em>crop</em>
              </label>
              <div className="chips">
                {(['fill', 'fit'] as const).map((fit) => (
                  <button
                    key={fit}
                    className={(frame.fit ?? 'fill') === fit ? 'chip active' : 'chip'}
                    onClick={() => store.setFrameFit(page.id, frame.id, fit)}
                  >
                    {fit === 'fill' ? '填满裁切' : '完整显示'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="focus-x">
                水平焦点<em>focus x</em>
              </label>
              <input
                id="focus-x"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={frame.focus?.x ?? 0.5}
                onChange={(e) =>
                  store.setFrameFocus(page.id, frame.id, {
                    x: Number(e.target.value),
                    y: frame.focus?.y ?? 0.5,
                  })
                }
              />
              <label htmlFor="focus-y">
                垂直焦点<em>focus y</em>
              </label>
              <input
                id="focus-y"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={frame.focus?.y ?? 0.5}
                onChange={(e) =>
                  store.setFrameFocus(page.id, frame.id, {
                    x: frame.focus?.x ?? 0.5,
                    y: Number(e.target.value),
                  })
                }
              />
              <span className="hint">也可以直接在页面上拖动图片。</span>
            </div>
            {imageFrames.length > 1 && (
              <div>
                <label htmlFor="swap-with">
                  与本页其它图片交换<em>swap</em>
                </label>
                <select
                  id="swap-with"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    store.swapFrames(
                      { pageId: page.id, frameId: frame.id },
                      { pageId: page.id, frameId: e.target.value },
                    );
                  }}
                >
                  <option value="">选择目标框…</option>
                  {imageFrames
                    .filter((f) => f.id !== frame.id)
                    .map((f, i) => (
                      <option key={f.id} value={f.id}>
                        图片框 {i + 1}
                        {f.assetId ? `（${assetMap.get(f.assetId)?.meta.fileName ?? ''}）` : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="frame-asset">
                替换素材<em>replace</em>
              </label>
              <select
                id="frame-asset"
                value={frame.assetId ?? ''}
                onChange={(e) => store.setFrameAsset(page.id, frame.id, e.target.value)}
              >
                {assets
                  .filter((a) => a.kind === 'image')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.meta.fileName ?? a.id}
                    </option>
                  ))}
              </select>
            </div>
          </>
        )}
        {frame && frame.kind === 'text' && (
          <div>
            <label htmlFor="frame-text">
              文字<em>text</em>
            </label>
            <textarea
              id="frame-text"
              rows={4}
              value={frameText(frame, assetMap)}
              onChange={(e) => store.setFrameText(page.id, frame.id, e.target.value)}
            />
          </div>
        )}
        {!frame && <span className="hint">点击页面中的图片或文字进行微调。</span>}
      </div>
    </aside>
  );
}
