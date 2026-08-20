import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { MeasureText } from '../engine/text/textLayout';
import { fontRoleKey, fontUrl, type FontKey } from '../render/fonts';
import { frameText, placeTextFrame } from '../render/textBox';
import { mediaSize, placeImage, type Rect } from '../shared/geometry';
import type { Asset, LayoutFrame, Page, PageSpec } from '../shared/types';
import { mmToPt, type Mm } from '../shared/units';
import type { BookState } from '../store/commands';
import { getBlob } from '../store/media';

export interface ExportOptions {
  book: BookState;
  fileName?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

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

/** JPEG quality for rasterised page images; 0.92 keeps artefacts invisible in print. */
const JPEG_QUALITY = 0.92;
/** Hard cap on a single rasterised frame, guarding against canvas allocation failures. */
const MAX_RASTER_PX = 8192;

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
  const assets = new Map(book.assets.map((asset) => [asset.id, asset]));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(options.fileName ?? 'AutoBook');
  doc.setProducer('AutoBook 一键成册');
  doc.setCreator('AutoBook 一键成册');

  const fonts = await embedFonts(doc);
  const media = mediaSize(spec);
  const sizePt = { w: mmToPt(media.w), h: mmToPt(media.h) };
  const total = book.pages.length;

  for (let i = 0; i < total; i += 1) {
    checkAbort(options.signal);
    const page = book.pages[i];
    const pdfPage = doc.addPage([sizePt.w, sizePt.h]);
    await drawPage({ doc, pdfPage, page, spec, assets, fonts, signal: options.signal });
    options.onProgress?.(i + 1, total);
  }

  const bytes = await doc.save();
  const fileName = options.fileName ?? 'autobook.pdf';
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    fileName,
    fontFallback: fonts.fallback,
  };
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
async function embedFonts(doc: PDFDocument): Promise<Fonts> {
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

async function drawPage(input: DrawPageInput): Promise<void> {
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
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
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
    const jpeg = await rasterize(bitmap, placed, visible, spec);
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

function canvasToJpeg(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

async function rasterize(
  bitmap: ImageBitmap,
  placed: Rect,
  visible: Rect,
  spec: PageSpec,
): Promise<Uint8Array | undefined> {
  const scaleX = bitmap.width / placed.w;
  const scaleY = bitmap.height / placed.h;
  const sx = (visible.x - placed.x) * scaleX;
  const sy = (visible.y - placed.y) * scaleY;
  const sw = Math.max(1, visible.w * scaleX);
  const sh = Math.max(1, visible.h * scaleY);
  const wanted = (visible.w / 25.4) * spec.targetDpi;
  // Never upscale beyond the source, and never blow past the canvas cap.
  const scale = Math.min(1, wanted / sw, MAX_RASTER_PX / sw, MAX_RASTER_PX / sh);
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));
  const canvas = canvasOf(outW, outH);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return undefined;
  ctx.fillStyle = spec.background || '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  const blob = await canvasToJpeg(canvas);
  if (!blob) return undefined;
  return new Uint8Array(await blob.arrayBuffer());
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
