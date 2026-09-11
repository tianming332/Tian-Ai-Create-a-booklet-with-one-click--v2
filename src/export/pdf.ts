import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { MeasureText } from '../engine/text/textLayout';
import { sideForIndex } from '../engine/layout/generate';
import { fontRoleKey, fontUrl, type FontKey } from '../render/fonts';
import { pageCanvasSize, renderPage, type PreviewImage } from '../render/preview';
import { frameText, placeTextFrame } from '../render/textBox';
import { mediaSize, placeImage, type Rect } from '../shared/geometry';
import type { Asset, LayoutFrame, Page, PageSpec } from '../shared/types';
import { mmToPt, type Mm } from '../shared/units';
import type { BookState } from '../store/commands';
import { getBlob } from '../store/media';

export interface ExportOptions {
  book: BookState;
  fileName?: string;
  quality?: ExportQuality;
  onProgress?: (done: number, total: number, phase: ExportPhase) => void;
  signal?: AbortSignal;
}

export type ExportPhase = 'rendering' | 'saving';
export type ExportQuality = 'fast' | 'standard' | 'print';

export interface ExportResult {
  blob: Blob;
  fileName: string;
  /** True when the CJK faces could not be embedded and text was romanised. */
  fontFallback: boolean;
}

interface Fonts {
  face: Record<FontKey, PDFFont>;
  measure: Record<FontKey, MeasureText>;
  romanise: Record<FontKey, boolean>;
  fallback: boolean;
}

/**
 * Keep exports inside a realistic browser memory budget. The previous 8192px
 * per side allowed one canvas to occupy 256MB; a book with several frames then
 * exhausted the tab before pdf-lib could save or start the download.
 */
const EXPORT_PROFILES: Record<
  ExportQuality,
  { dpi: number; jpegQuality: number; maxEdge: number; maxPixels: number }
> = {
  fast: { dpi: 160, jpegQuality: 0.74, maxEdge: 2560, maxPixels: 4_000_000 },
  standard: { dpi: 240, jpegQuality: 0.82, maxEdge: 4096, maxPixels: 6_000_000 },
  print: { dpi: 300, jpegQuality: 0.88, maxEdge: 4608, maxPixels: 9_000_000 },
};

class Aborted extends Error {
  constructor() {
    super('export aborted');
    this.name = 'AbortError';
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Aborted();
}

/** Renders the whole book into a print-ready RGB PDF, one PDF page per book page. */
export async function exportPdf(options: ExportOptions): Promise<ExportResult> {
  const { book } = options;
  const spec = book.pageSpec;
  const profile = EXPORT_PROFILES[options.quality ?? 'standard'];
  const assets = new Map(book.assets.map((asset) => [asset.id, asset]));
  const doc = await PDFDocument.create();
  doc.setTitle(options.fileName ?? 'AutoBook');
  doc.setProducer('AutoBook 一键成册');
  doc.setCreator('AutoBook 一键成册');

  const media = mediaSize(spec);
  const sizePt = { w: mmToPt(media.w), h: mmToPt(media.h) };
  const total = book.pages.length;

  for (let i = 0; i < total; i += 1) {
    checkAbort(options.signal);
    const page = book.pages[i];
    const pageJpeg = await rasterizeWholePage(page, spec, assets, profile, options.signal);
    const pdfPage = doc.addPage([sizePt.w, sizePt.h]);
    const image = await doc.embedJpg(pageJpeg);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: sizePt.w,
      height: sizePt.h,
    });
    options.onProgress?.(i + 1, total, 'rendering');
    // Let React paint the progress bar and give the browser a chance to
    // release temporary canvas/bitmap memory before processing the next page.
    await yieldToBrowser();
  }

  checkAbort(options.signal);
  options.onProgress?.(total, total, 'saving');
  await yieldToBrowser();
  // Larger batches make final serialisation substantially faster while still
  // yielding often enough to keep the browser alive.
  const bytes = await doc.save({ objectsPerTick: 100 });
  const fileName = options.fileName ?? 'autobook.pdf';
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    fileName,
    fontFallback: false,
  };
}

/**
 * Flattens one complete page to one JPEG before adding it to the PDF. This
 * keeps the PDF object graph tiny (one image + one content stream per page),
 * which avoids the very long final save seen with dozens of separate frames.
 */
async function rasterizeWholePage(
  page: Page,
  spec: PageSpec,
  assets: Map<string, Asset>,
  profile: { dpi: number; jpegQuality: number; maxEdge: number; maxPixels: number },
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const media = mediaSize(spec);
  const requestedPxPerMm = profile.dpi / 25.4;
  const requestedW = media.w * requestedPxPerMm;
  const requestedH = media.h * requestedPxPerMm;
  const edgeScale = Math.min(1, profile.maxEdge / requestedW, profile.maxEdge / requestedH);
  const pixelScale = Math.min(1, Math.sqrt(profile.maxPixels / (requestedW * requestedH)));
  const pxPerMm = requestedPxPerMm * Math.min(edgeScale, pixelScale);
  const size = pageCanvasSize(spec, pxPerMm);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, size.w);
  canvas.height = Math.max(1, size.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法创建页面画布');

  const images = new Map<string, PreviewImage>();
  const opened: ImageBitmap[] = [];
  try {
    const imageIds = new Set(
      page.frames
        .filter((frame) => frame.kind === 'image' && frame.assetId)
        .map((frame) => frame.assetId as string),
    );
    for (const id of imageIds) {
      checkAbort(signal);
      const blob = getBlob(id);
      if (!blob) continue;
      try {
        const bitmap = await createImageBitmap(blob);
        opened.push(bitmap);
        images.set(id, bitmap);
      } catch {
        // Preview renderer will draw a labelled placeholder for bad images.
      }
    }
    renderPage({
      ctx,
      spec,
      page,
      side: sideForIndex(page.index),
      assets,
      images,
      pxPerMm,
    });
    checkAbort(signal);
    const jpeg = await canvasToJpegAtQuality(canvas, profile.jpegQuality);
    if (!jpeg) throw new Error(`第 ${page.index + 1} 页无法生成图像`);
    return new Uint8Array(await jpeg.arrayBuffer());
  } finally {
    for (const bitmap of opened) bitmap.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Characters the WinAnsi standard fonts can render; used only in fallback mode. */
const LATIN = /[\u0020-\u024F\u2010-\u203A]/;

function sanitizeForFallback(text: string): string {
  return Array.from(text)
    .filter((ch) => LATIN.test(ch))
    .join('');
}

/**
 * Embeds the bundled CJK faces. When the files are missing the export still
 * succeeds with Helvetica and non-Latin characters dropped, which Preflight
 * already warned about.
 */
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const keys: FontKey[] = ['sans', 'serif'];
  const embedded: Partial<Record<FontKey, PDFFont>> = {};
  for (const key of keys) {
    try {
      const response = await fetch(fontUrl(key));
      if (!response.ok) throw new Error(String(response.status));
      const bytes = new Uint8Array(await response.arrayBuffer());
      try {
        embedded[key] = await doc.embedFont(bytes, { subset: true });
      } catch {
        embedded[key] = await doc.embedFont(bytes, { subset: false });
      }
    } catch {
      embedded[key] = undefined;
    }
  }
  const fallback = !embedded.sans || !embedded.serif;
  const helvetica = fallback ? await doc.embedFont(StandardFonts.Helvetica) : undefined;
  const face = {
    sans: embedded.sans ?? (helvetica as PDFFont),
    serif: embedded.serif ?? (helvetica as PDFFont),
  };
  const measure: Record<FontKey, MeasureText> = {
    sans: measurer(face.sans, !embedded.sans),
    serif: measurer(face.serif, !embedded.serif),
  };
  return { face, measure, romanise: { sans: !embedded.sans, serif: !embedded.serif }, fallback };
}

/** Width in pt straight from the embedded metrics, so lines break as in preview. */
function measurer(font: PDFFont, romanise: boolean): MeasureText {
  return (text, sizePt) => {
    const value = romanise ? sanitizeForFallback(text) : text;
    if (!value) return 0;
    try {
      return font.widthOfTextAtSize(value, sizePt);
    } catch {
      return value.length * sizePt * 0.6;
    }
  };
}

interface DrawPageInput {
  doc: PDFDocument;
  pdfPage: PDFPage;
  page: Page;
  spec: PageSpec;
  assets: Map<string, Asset>;
  fonts: Fonts;
  profile: { dpi: number; jpegQuality: number; maxEdge: number; maxPixels: number };
  signal?: AbortSignal;
}

/** Media box in page coordinates: the trim box grown by the bleed. */
function mediaRect(spec: PageSpec): Rect {
  return {
    x: -spec.bleed,
    y: -spec.bleed,
    w: spec.trimWidth + spec.bleed * 2,
    h: spec.trimHeight + spec.bleed * 2,
  };
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return undefined;
  return { x, y, w: right - x, h: bottom - y };
}

function parseColor(value: string): ReturnType<typeof rgb> {
  const hex = value.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return rgb(1, 1, 1);
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function drawPage(input: DrawPageInput): Promise<void> {
  const { pdfPage, page, spec } = input;
  pdfPage.drawRectangle({
    x: 0,
    y: 0,
    width: pdfPage.getWidth(),
    height: pdfPage.getHeight(),
    color: parseColor(spec.background || '#ffffff'),
  });
  if (!page.isBlank) {
    for (const frame of page.frames) {
      checkAbort(input.signal);
      if (frame.kind === 'image') await drawImageFrame(input, frame);
      else drawTextFrame(input, frame);
    }
  }
  if (spec.cropMarks && spec.bleed > 0) drawCropMarks(pdfPage, spec);
}

/** Downloads a finished export without leaking the object URL. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari may start reading the blob well after the synthetic click. Revoking
  // after only four seconds can therefore produce no file at all.
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

/**
 * Rasterises exactly the visible part of the image at the target DPI and embeds
 * it as JPEG. Pre-cropping replaces clipping (pdf-lib has none) and normalises
 * exotic source formats such as HEIC/WebP in one step.
 */
async function drawImageFrame(input: DrawPageInput, frame: LayoutFrame): Promise<void> {
  const { spec, pdfPage } = input;
  const asset = frame.assetId ? input.assets.get(frame.assetId) : undefined;
  const blob = frame.assetId ? getBlob(frame.assetId) : undefined;
  if (!asset || !blob) return;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return;
  }
  try {
    const aspect = asset.visual?.aspectRatio ?? bitmap.width / bitmap.height;
    const placed = placeImage(frame, aspect, frame.fit ?? 'fill', frame.focus);
    const clipped = intersect(frame, mediaRect(spec));
    const visible = clipped ? intersect(clipped, placed) : undefined;
    if (!visible || visible.w < 0.05 || visible.h < 0.05) return;
    const jpeg = await rasterize(bitmap, placed, visible, spec, input.profile);
    if (!jpeg) return;
    const image = await input.doc.embedJpg(jpeg);
    pdfPage.drawImage(image, {
      x: mmToPt(visible.x + spec.bleed),
      y: pdfPage.getHeight() - mmToPt(visible.y + visible.h + spec.bleed),
      width: mmToPt(visible.w),
      height: mmToPt(visible.h),
    });
  } finally {
    bitmap.close();
  }
}

function canvasOf(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function canvasToJpegAtQuality(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function rasterize(
  bitmap: ImageBitmap,
  placed: Rect,
  visible: Rect,
  spec: PageSpec,
  profile = EXPORT_PROFILES.standard,
): Promise<Uint8Array | undefined> {
  const scaleX = bitmap.width / placed.w;
  const scaleY = bitmap.height / placed.h;
  const sx = (visible.x - placed.x) * scaleX;
  const sy = (visible.y - placed.y) * scaleY;
  const sw = Math.max(1, visible.w * scaleX);
  const sh = Math.max(1, visible.h * scaleY);
  const wanted = (visible.w / 25.4) * Math.min(spec.targetDpi, profile.dpi);
  // Never upscale beyond the source, and never blow past the canvas cap.
  const edgeScale = Math.min(profile.maxEdge / sw, profile.maxEdge / sh);
  const pixelScale = Math.sqrt(profile.maxPixels / (sw * sh));
  const scale = Math.min(1, wanted / sw, edgeScale, pixelScale);
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));
  const canvas = canvasOf(outW, outH);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return undefined;
  ctx.fillStyle = spec.background || '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  const blob = await canvasToJpegAtQuality(canvas, profile.jpegQuality);
  if (!blob) return undefined;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Explicitly release the backing store. Safari otherwise keeps several old
  // page canvases alive and the export dies near the final pages.
  if ('width' in canvas) {
    canvas.width = 1;
    canvas.height = 1;
  }
  return bytes;
}

function drawTextFrame(input: DrawPageInput, frame: LayoutFrame): void {
  const { spec, pdfPage, fonts } = input;
  const text = frameText(frame, input.assets);
  if (!text.trim()) return;
  const key = fontRoleKey(frame.textRole);
  const placed = placeTextFrame({ frame, spec, text, measure: fonts.measure[key] });
  const color = parseColor(frame.color ?? '#111827');
  const heightPt = pdfPage.getHeight();
  for (const line of placed.lines) {
    const value = fonts.romanise[key] ? sanitizeForFallback(line.text) : line.text;
    if (!value) continue;
    try {
      pdfPage.drawText(value, {
        x: mmToPt(line.xMm + spec.bleed),
        y: heightPt - mmToPt(line.baselineMm + spec.bleed),
        size: placed.sizePt,
        font: fonts.face[key],
        color,
      });
    } catch {
      // A character the face cannot encode must not abort the whole export.
    }
  }
}

/** Corner marks in the bleed area, aligned with the trim box. */
function drawCropMarks(pdfPage: PDFPage, spec: PageSpec): void {
  const len: Mm = Math.min(spec.bleed, 4);
  const thickness = 0.25;
  const black = rgb(0, 0, 0);
  const heightPt = pdfPage.getHeight();
  const toX = (mm: Mm) => mmToPt(mm + spec.bleed);
  const toY = (mm: Mm) => heightPt - mmToPt(mm + spec.bleed);
  const corners: Array<{ x: Mm; y: Mm; dx: number; dy: number }> = [
    { x: 0, y: 0, dx: -1, dy: -1 },
    { x: spec.trimWidth, y: 0, dx: 1, dy: -1 },
    { x: 0, y: spec.trimHeight, dx: -1, dy: 1 },
    { x: spec.trimWidth, y: spec.trimHeight, dx: 1, dy: 1 },
  ];
  for (const corner of corners) {
    pdfPage.drawLine({
      start: { x: toX(corner.x + corner.dx * len), y: toY(corner.y) },
      end: { x: toX(corner.x), y: toY(corner.y) },
      thickness,
      color: black,
    });
    pdfPage.drawLine({
      start: { x: toX(corner.x), y: toY(corner.y + corner.dy * len) },
      end: { x: toX(corner.x), y: toY(corner.y) },
      thickness,
      color: black,
    });
  }
}
