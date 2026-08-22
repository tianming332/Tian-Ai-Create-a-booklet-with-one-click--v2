import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { sideForIndex } from '../engine/layout/generate';
import type { PageSide } from '../engine/layout/types';
import type { Asset, Page } from '../shared/types';
import { cachedPreview, loadPreview, thumbUrl } from '../store/media';
import type { PreviewImage } from '../render/preview';

/** A visible spread: the cover stands alone, interior verso/recto pages pair up. */
export interface SpreadView {
  pages: Page[];
}

export function buildSpreads(pages: Page[]): SpreadView[] {
  const out: SpreadView[] = [];
  let i = 0;
  while (i < pages.length) {
    const page = pages[i];
    const next = pages[i + 1];
    if (page.index !== 0 && sideForIndex(page.index) === 'left' && next && sideForIndex(next.index) === 'right') {
      out.push({ pages: [page, next] });
      i += 2;
    } else {
      out.push({ pages: [page] });
      i += 1;
    }
  }
  return out;
}

export function spreadIndexOfPage(spreads: SpreadView[], pageId: string): number {
  const found = spreads.findIndex((s) => s.pages.some((p) => p.id === pageId));
  return found < 0 ? 0 : found;
}

export function sideOf(page: Page): PageSide {
  return sideForIndex(page.index);
}

export function useElementSize<T extends HTMLElement>(): [RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** Decodes the bitmaps a set of pages needs; re-renders when new ones arrive. */
export function usePageImages(pages: Page[], assets: Asset[]): Map<string, PreviewImage> {
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const page of pages) {
      for (const frame of page.frames) {
        if (frame.kind === 'image' && frame.assetId) set.add(frame.assetId);
      }
    }
    return [...set];
  }, [pages]);
  const [version, bump] = useState(0);

  useEffect(() => {
    let live = true;
    for (const id of ids) {
      if (cachedPreview(id)) continue;
      void loadPreview(id).then((image) => {
        if (live && image) bump((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [ids]);

  return useMemo(() => {
    const map = new Map<string, PreviewImage>();
    for (const id of ids) {
      const image = cachedPreview(id);
      if (image) map.set(id, image);
    }
    return map;
    // assets participate so a re-analysis (aspect change) refreshes the map
  }, [ids, assets, version]);
}

/**
 * Loads the 256px thumbnails as images. Used by the overview grid, where dozens
 * of pages are on screen and page-resolution bitmaps would blow the LRU.
 */
export function useThumbImages(assets: Asset[]): Map<string, PreviewImage> {
  const [images, setImages] = useState<Map<string, PreviewImage>>(new Map());

  useEffect(() => {
    let live = true;
    const map = new Map<string, PreviewImage>();
    const tasks = assets
      .filter((asset) => asset.kind === 'image')
      .map((asset) => {
        const url = thumbUrl(asset.id);
        if (!url) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => {
            map.set(asset.id, image);
            resolve();
          };
          image.onerror = () => resolve();
          image.src = url;
        });
      });
    void Promise.all(tasks).then(() => {
      if (live) setImages(map);
    });
    return () => {
      live = false;
    };
  }, [assets]);

  return images;
}
