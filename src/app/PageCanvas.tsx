import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { pageCanvasSize, renderPage, type PreviewImage, type PreviewOverlays } from '../render/preview';
import { placeImage } from '../shared/geometry';
import type { Asset, Focus, LayoutFrame, Page, PageSpec } from '../shared/types';
import { sideOf } from './hooks';

export interface PageCanvasProps {
  page: Page;
  spec: PageSpec;
  assets: Map<string, Asset>;
  images: Map<string, PreviewImage>;
  pxPerMm: number;
  overlays: PreviewOverlays;
  selectedFrameId?: string;
  fontsVersion?: number;
  onSelectFrame?: (frame: LayoutFrame | undefined) => void;
  onFocusChange?: (frameId: string, focus: Focus) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/** Canvas view of a single page, including hit-testing and focus dragging. */
export function PageCanvas(props: PageCanvasProps): JSX.Element {
  const { page, spec, assets, images, pxPerMm, overlays, selectedFrameId } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = pageCanvasSize(spec, pxPerMm);
  const drag = useRef<{ frame: LayoutFrame; startX: number; startY: number; focus: Focus } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderPage({
      ctx,
      spec,
      page,
      side: sideOf(page),
      assets,
      images,
      pxPerMm,
      overlays,
      selectedFrameId,
    });
  });

  return (
    <div className="page-wrap">
      <canvas
        ref={ref}
        className="page-canvas"
        style={{ width: size.w, height: size.h }}
        onPointerDown={(event) => onPointerDown(event, props, drag)}
        onPointerMove={(event) => onPointerMove(event, props, drag)}
        onPointerUp={() => {
          if (drag.current) props.onDragEnd?.();
          drag.current = null;
        }}
      />
      {page.index > 0 ? <span className="badge">P{page.index}</span> : <span className="badge">封面</span>}
    </div>
  );
}

type DragRef = { current: { frame: LayoutFrame; startX: number; startY: number; focus: Focus } | null };

function pointMm(
  event: ReactPointerEvent<HTMLCanvasElement>,
  spec: PageSpec,
  pxPerMm: number,
): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / pxPerMm - spec.bleed,
    y: (event.clientY - rect.top) / pxPerMm - spec.bleed,
  };
}

function hitFrame(page: Page, x: number, y: number): LayoutFrame | undefined {
  for (let i = page.frames.length - 1; i >= 0; i -= 1) {
    const frame = page.frames[i];
    if (frame.textRole === 'pageNumber') continue;
    if (x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h) return frame;
  }
  return undefined;
}

function onPointerDown(
  event: ReactPointerEvent<HTMLCanvasElement>,
  props: PageCanvasProps,
  drag: DragRef,
): void {
  const point = pointMm(event, props.spec, props.pxPerMm);
  const frame = hitFrame(props.page, point.x, point.y);
  props.onSelectFrame?.(frame);
  if (!frame || frame.kind !== 'image' || (frame.fit ?? 'fill') !== 'fill') return;
  drag.current = {
    frame,
    startX: point.x,
    startY: point.y,
    focus: frame.focus ?? { x: 0.5, y: 0.5 },
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  props.onDragStart?.();
}

function onPointerMove(
  event: ReactPointerEvent<HTMLCanvasElement>,
  props: PageCanvasProps,
  drag: DragRef,
): void {
  const state = drag.current;
  if (!state || !props.onFocusChange) return;
  const asset = state.frame.assetId ? props.assets.get(state.frame.assetId) : undefined;
  const aspect = asset?.visual?.aspectRatio ?? state.frame.w / state.frame.h;
  const rect = placeImage(state.frame, aspect, 'fill', { x: 0.5, y: 0.5 });
  const overflowX = Math.max(0.001, rect.w - state.frame.w);
  const overflowY = Math.max(0.001, rect.h - state.frame.h);
  const point = pointMm(event, props.spec, props.pxPerMm);
  const focus: Focus = {
    x: clamp01(state.focus.x - (point.x - state.startX) / overflowX),
    y: clamp01(state.focus.y - (point.y - state.startY) / overflowY),
  };
  props.onFocusChange(state.frame.id, focus);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
