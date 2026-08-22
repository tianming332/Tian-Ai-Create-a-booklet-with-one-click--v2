import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { renderPage, type PreviewImage, type PreviewOverlays } from '../render/preview';
import type { Asset, Page, PageSpec } from '../shared/types';
import { useProject } from '../store/useProject';
import { buildSpreads, sideOf, useElementSize, usePageImages, useThumbImages } from './hooks';
import type { SpreadView } from './hooks';

/** The book view is a finished-product preview: no guides, no selection. */
const NO_OVERLAYS: PreviewOverlays = { bleed: false, safeArea: false, frames: false };

interface BookPageProps {
  page: Page;
  spec: PageSpec;
  assets: Map<string, Asset>;
  images: Map<string, PreviewImage>;
  pxPerMm: number;
  fontsVersion: number;
}

/** A single page trimmed to its final size — the bleed is cropped away. */
function BookPage(props: BookPageProps): JSX.Element {
  const { page, spec, assets, images, pxPerMm, fontsVersion } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.round(spec.trimWidth * pxPerMm);
  const h = Math.round(spec.trimHeight * pxPerMm);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Pull the media box up-left so the trim box exactly fills the canvas.
    const offset = spec.bleed * pxPerMm;
    ctx.setTransform(dpr, 0, 0, dpr, -offset * dpr, -offset * dpr);
    renderPage({ ctx, spec, page, side: sideOf(page), assets, images, pxPerMm, overlays: NO_OVERLAYS });
  }, [page, spec, assets, images, pxPerMm, fontsVersion, w, h]);

  return <canvas ref={ref} className="book-page" style={{ width: w, height: h }} />;
}

/**
 * Indices of the spreads near the viewport, as a stable comma string so the
 * caller can memoise on it without depending on array identity.
 */
function useVisibleSpreads(root: RefObject<HTMLElement>, spreads: SpreadView[]): string {
  const [key, setKey] = useState('0');

  useEffect(() => {
    const el = root.current;
    if (!el || spreads.length === 0) return;
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-spread]')];
    if (nodes.length === 0) return;
    const live = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number(entry.target.getAttribute('data-spread'));
          if (entry.isIntersecting) live.add(index);
          else live.delete(index);
        }
        const next = [...live].sort((a, b) => a - b).join(',');
        setKey(next || '0');
      },
      { root: el, rootMargin: '500px 0px' },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [root, spreads]);

  return key;
}

function caption(pages: Page[]): string {
  if (pages.length === 1 && pages[0].index === 0) return '封面';
  return pages.map((page) => `P${page.index}`).join(' – ');
}

/** Whole-book preview: scrolls spread by spread, like flipping a printed book. */
export function BookPreview({ fontsVersion }: { fontsVersion: number }): JSX.Element {
  const store = useProject();
  const { pages, assets, pageSpec } = store;
  const spreads = useMemo(() => buildSpreads(pages), [pages]);
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const [ref, size] = useElementSize<HTMLDivElement>();

  // Thumbnails paint instantly; the spreads on screen are upgraded to full
  // previews so scrolling never waits on decoding the whole book.
  const visible = useVisibleSpreads(ref, spreads);
  const hotPages = useMemo(() => {
    const out: Page[] = [];
    for (const index of visible.split(',')) {
      const spread = spreads[Number(index)];
      if (spread) out.push(...spread.pages);
    }
    return out;
  }, [visible, spreads]);
  const thumbs = useThumbImages(assets);
  const previews = usePageImages(hotPages, assets);
  const images = useMemo(() => {
    const merged = new Map(thumbs);
    for (const [id, image] of previews) merged.set(id, image);
    return merged;
  }, [thumbs, previews]);

  const fitW = size.w > 0 ? (size.w - 112) / (pageSpec.trimWidth * 2) : 1;
  const fitH = size.h > 0 ? (size.h - 132) / pageSpec.trimHeight : 1;
  const pxPerMm = Math.max(0.5, Math.min(fitW, fitH));

  return (
    <div className="book-preview" ref={ref}>
      <header className="book-head">
        <strong>{store.name}</strong>
        <span className="hint">
          {store.style.name} · {pages.length} 页 · {spreads.length} 个版面
        </span>
      </header>

      {spreads.length === 0 ? <span className="hint">还没有页面，先导入素材。</span> : null}

      {spreads.map((spread, index) => (
        <section
          key={spread.pages[0].id}
          className={`book-spread${spread.pages.length === 1 ? ' single' : ''}`}
          data-spread={index}
        >
          <div className="sheet">
            {spread.pages.map((page) => (
              <BookPage
                key={page.id}
                page={page}
                spec={pageSpec}
                assets={assetMap}
                images={images}
                pxPerMm={pxPerMm}
                fontsVersion={fontsVersion}
              />
            ))}
            {spread.pages.length > 1 ? <span className="spine" /> : null}
          </div>
          <span className="book-caption">{caption(spread.pages)}</span>
        </section>
      ))}

      {spreads.length > 0 ? (
        <footer className="book-end">
          <span className="hint">全书结束 · 顶部可以重新排版、进入编辑或导出 PDF</span>
        </footer>
      ) : null}
    </div>
  );
}
