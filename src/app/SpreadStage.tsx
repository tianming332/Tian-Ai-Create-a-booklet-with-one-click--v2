import { useMemo } from 'react';
import { mediaSize } from '../shared/geometry';
import { useProject } from '../store/useProject';
import { PageCanvas } from './PageCanvas';
import { buildSpreads, useElementSize, usePageImages } from './hooks';

/** Centre stage: the current spread, scaled to fit the viewport. */
export function SpreadStage({ fontsVersion }: { fontsVersion: number }): JSX.Element {
  const store = useProject();
  const { pages, assets, pageSpec, view } = store;
  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  const spread = spreads[Math.min(view.spreadIndex, Math.max(0, spreads.length - 1))];
  const visible = useMemo(() => spread?.pages ?? [], [spread]);
  const images = usePageImages(visible, assets);
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const [ref, size] = useElementSize<HTMLDivElement>();

  const media = mediaSize(pageSpec);
  const columns = visible.length || 1;
  const fitW = size.w > 0 ? (size.w - 40) / (media.w * columns) : 1;
  const fitH = size.h > 0 ? (size.h - 40) / media.h : 1;
  const pxPerMm = Math.max(0.4, Math.min(fitW, fitH) * view.zoom);

  return (
    <div className="stage" ref={ref}>
      {visible.length === 0 ? (
        <span className="hint">还没有页面，先导入素材。</span>
      ) : (
        <div className="spread">
          {visible.map((page) => (
            <PageCanvas
              key={page.id}
              page={page}
              spec={pageSpec}
              assets={assetMap}
              images={images}
              pxPerMm={pxPerMm}
              overlays={view.overlays}
              fontsVersion={fontsVersion}
              selectedFrameId={view.selection.pageId === page.id ? view.selection.frameId : undefined}
              onSelectFrame={(frame) => store.select({ ...view.selection, pageId: page.id, frameId: frame?.id })}
              onFocusChange={(frameId, focus) => store.setFrameFocus(page.id, frameId, focus)}
              onDragStart={store.beginTransient}
              onDragEnd={store.endTransient}
            />
          ))}
        </div>
      )}
    </div>
  );
}
