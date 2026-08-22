import { PARAMS } from '../../shared/constants';
import type { VisualFeatures } from '../../shared/types';
import { createCanvas2D, scaledSize } from './canvas';
import { analyzePixels, buildVisualFeatures, toGrayscale } from './features';
import { computeDHash } from './hash';

export interface ImageAnalysisResult {
  visual: VisualFeatures;
  thumb: Blob;
  warnings: string[];
}

async function decode(blob: Blob, longEdge?: number): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (longEdge) {
    // resizeWidth/Height are hints; probe intrinsic size first for correct ratio.
    const probe = await createImageBitmap(blob, options);
    const { w, h } = scaledSize(probe.width, probe.height, longEdge);
    if (w === probe.width && h === probe.height) return probe;
    const resized = await createImageBitmap(probe, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'medium',
    });
    probe.close();
    return resized;
  }
  return createImageBitmap(blob, options);
}

function drawToPixels(bitmap: ImageBitmap, w: number, h: number) {
  const canvas = createCanvas2D(w, h);
  canvas.ctx.drawImage(bitmap, 0, 0, w, h);
  const data = canvas.ctx.getImageData(0, 0, w, h);
  canvas.release();
  return { data: data.data, width: w, height: h };
}

/**
 * Full local analysis of one image blob.
 * Only small thumbnails are ever rasterised — a 24MP source never becomes RGBA.
 */
export async function analyzeImageBlob(blob: Blob): Promise<ImageAnalysisResult> {
  const warnings: string[] = [];
  const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const widthPx = probe.width;
  const heightPx = probe.height;
  if (Math.max(widthPx, heightPx) > PARAMS.maxEdgePx) {
    warnings.push(`超大尺寸（${widthPx}×${heightPx}px），仅使用缩略图分析`);
  }

  const colorSize = scaledSize(widthPx, heightPx, PARAMS.analysisColorThumb);
  const colorBitmap = await createImageBitmap(probe, {
    resizeWidth: colorSize.w,
    resizeHeight: colorSize.h,
    resizeQuality: 'medium',
  });
  const stats = analyzePixels(drawToPixels(colorBitmap, colorSize.w, colorSize.h));
  colorBitmap.close();

  const hashBitmap = await createImageBitmap(probe, { resizeWidth: 9, resizeHeight: 8, resizeQuality: 'medium' });
  const dHash = computeDHash(toGrayscale(drawToPixels(hashBitmap, 9, 8)), 9, 8);
  hashBitmap.close();

  const thumbSize = scaledSize(widthPx, heightPx, PARAMS.previewThumb);
  const thumbCanvas = createCanvas2D(thumbSize.w, thumbSize.h);
  thumbCanvas.ctx.drawImage(probe, 0, 0, thumbSize.w, thumbSize.h);
  const thumb = await thumbCanvas.toBlob('image/jpeg', 0.82);
  thumbCanvas.release();
  probe.close();

  return {
    visual: buildVisualFeatures({ widthPx, heightPx, stats, dHash }),
    thumb,
    warnings,
  };
}

/** Decodes a blob to a bitmap capped at `longEdge` for on-screen preview. */
export async function decodePreview(blob: Blob, longEdge = 1600): Promise<ImageBitmap> {
  return decode(blob, longEdge);
}
