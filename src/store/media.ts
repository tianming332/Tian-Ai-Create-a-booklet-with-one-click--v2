import { decodePreview } from '../engine/analysis/image';
import type { PreviewImage } from '../render/preview';

/**
 * In-memory registry of original blobs, thumbnails and decoded preview bitmaps.
 * Blobs are the single source of truth for pixels; IndexedDB persistence
 * rehydrates this registry on project restore.
 */
const blobs = new Map<string, Blob>();
const thumbs = new Map<string, Blob>();
const urls = new Map<string, string>();
const bitmaps = new Map<string, PreviewImage>();
const pending = new Map<string, Promise<PreviewImage | undefined>>();

const MAX_BITMAPS = 64;

export function putBlob(id: string, blob: Blob): void {
  blobs.set(id, blob);
}

export function getBlob(id: string): Blob | undefined {
  return blobs.get(id);
}

export function putThumb(id: string, blob: Blob): void {
  thumbs.set(id, blob);
  const old = urls.get(id);
  if (old) {
    URL.revokeObjectURL(old);
    urls.delete(id);
  }
}

export function getThumb(id: string): Blob | undefined {
  return thumbs.get(id);
}

/** Stable object URL for the asset panel; created lazily, revoked on forget. */
export function thumbUrl(id: string): string | undefined {
  const existing = urls.get(id);
  if (existing) return existing;
  const blob = thumbs.get(id) ?? blobs.get(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export function cachedPreview(id: string): PreviewImage | undefined {
  return bitmaps.get(id);
}

/** Decodes a page-resolution bitmap, keeping an LRU of recent pages warm. */
export function loadPreview(id: string): Promise<PreviewImage | undefined> {
  const ready = bitmaps.get(id);
  if (ready) return Promise.resolve(ready);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const blob = blobs.get(id);
  if (!blob) return Promise.resolve(undefined);
  const task = decodePreview(blob, 1600)
    .then((bitmap) => {
      bitmaps.set(id, bitmap);
      trim();
      return bitmap as PreviewImage;
    })
    .catch(() => undefined)
    .finally(() => pending.delete(id));
  pending.set(id, task);
  return task;
}

function trim(): void {
  while (bitmaps.size > MAX_BITMAPS) {
    const oldest = bitmaps.keys().next();
    if (oldest.done) return;
    const value = bitmaps.get(oldest.value);
    if (value && 'close' in value && typeof value.close === 'function') value.close();
    bitmaps.delete(oldest.value);
  }
}

export function forget(id: string): void {
  blobs.delete(id);
  thumbs.delete(id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  const bitmap = bitmaps.get(id);
  if (bitmap && 'close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  bitmaps.delete(id);
}

export function releaseAll(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  for (const bitmap of bitmaps.values()) {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
  bitmaps.clear();
  blobs.clear();
  thumbs.clear();
}
