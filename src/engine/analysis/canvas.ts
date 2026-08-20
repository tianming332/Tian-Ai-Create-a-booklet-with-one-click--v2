/**
 * Canvas abstraction so the same analysis code runs in a Worker
 * (OffscreenCanvas) and on the main thread (HTMLCanvasElement fallback).
 */
export interface Canvas2D {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBlob(type: string, quality?: number): Promise<Blob>;
  release(): void;
}

export function supportsOffscreen(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

export function createCanvas2D(width: number, height: number): Canvas2D {
  if (supportsOffscreen()) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    return {
      ctx,
      toBlob: (type, quality) => canvas.convertToBlob({ type, quality }),
      release: () => {
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2d context unavailable');
  return {
    ctx,
    toBlob: (type, quality) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type, quality);
      }),
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export function scaledSize(width: number, height: number, longEdge: number): { w: number; h: number } {
  const max = Math.max(width, height);
  if (max <= longEdge) return { w: width, h: height };
  const scale = longEdge / max;
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}
