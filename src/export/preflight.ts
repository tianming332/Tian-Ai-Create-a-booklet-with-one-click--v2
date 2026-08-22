import { sideForIndex } from '../engine/layout/generate';
import { createApproxMeasure, type MeasureText } from '../engine/text/textLayout';
import type { FontKey } from '../render/fonts';
import { fontRoleKey } from '../render/fonts';
import { frameText, placeTextFrame } from '../render/textBox';
import { PARAMS } from '../shared/constants';
import { bleedRect, placeImage, rectWithin, safeRect, rectsOverlap } from '../shared/geometry';
import type { Asset, LayoutFrame, Page, PageSpec, PreflightIssue } from '../shared/types';
import { effectiveDpi } from '../shared/units';
import type { BookState } from '../store/commands';

export interface PreflightInput {
  book: BookState;
  /** Text measurer per font. Defaults to the approximate metrics. */
  measure?: (key: FontKey) => MeasureText;
  /** Which faces actually loaded; a missing CJK face is reported. */
  fonts?: Record<FontKey, boolean>;
}

const approx = createApproxMeasure();

/**
 * Static checks over the finished book. Pure: same book in, same issues out,
 * so the export dialog and the tests agree.
 */
export function preflight(input: PreflightInput): PreflightIssue[] {
  const { pageSpec: spec, assets, pages } = input.book;
  const measure = input.measure ?? (() => approx);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const issues: PreflightIssue[] = [];

  if (!assets.length) {
    issues.push({ id: 'noAssets', level: 'error', code: 'noAssets', message: '还没有导入任何素材。' });
    return issues;
  }

  for (const asset of assets) {
    if (asset.analysisStatus === 'error') {
      issues.push({
        id: `decode:${asset.id}`,
        level: 'warning',
        code: 'assetDecodeFailed',
        assetId: asset.id,
        message: `${asset.meta.fileName ?? asset.id} 无法解码，已跳过。`,
      });
    }
  }

  if (input.fonts && (!input.fonts.sans || !input.fonts.serif)) {
    issues.push({
      id: 'fontMissing',
      level: 'warning',
      code: 'fontMissing',
      message: '中文字体未加载成功，导出的 PDF 将使用替代字体，字形可能缺失。',
      autoFix: 'fallbackFont',
    });
  }

  for (const page of pages) {
    checkPage(page, spec, byId, measure, issues);
  }

  if (pages.length % 4 !== 0) {
    issues.push({
      id: 'pageCount',
      level: 'warning',
      code: 'pageCountNotMultipleOfFour',
      message: `共 ${pages.length} 页，多数印厂要求 4 的倍数，建议补至 ${Math.ceil(pages.length / 4) * 4} 页。`,
      autoFix: 'addBlankPages',
    });
  }

  issues.push({
    id: 'noCmykPdfx',
    level: 'info',
    code: 'noCmykPdfx',
    message: '导出为 RGB PDF，不做 CMYK 转换与 PDF/X 校验；送印前请与印厂确认。',
  });

  return issues;
}

function checkPage(
  page: Page,
  spec: PageSpec,
  assets: Map<string, Asset>,
  measure: (key: FontKey) => MeasureText,
  issues: PreflightIssue[],
): void {
  if (page.isBlank || page.frames.every((f) => f.textRole === 'pageNumber')) {
    if (!page.isBlank) {
      issues.push({
        id: `blank:${page.id}`,
        level: 'info',
        code: 'blankPage',
        pageIndex: page.index,
        message: `第 ${page.index + 1} 页没有内容。`,
      });
    }
    return;
  }

  const side = sideForIndex(page.index);
  const safe = safeRect(spec, side);
  const bleed = bleedRect(spec);

  for (const frame of page.frames) {
    if (frame.kind === 'image') checkImageFrame(page, frame, spec, assets, bleed, issues);
    else checkTextFrame(page, frame, spec, assets, measure, safe, issues);
  }
}

function checkImageFrame(
  page: Page,
  frame: LayoutFrame,
  spec: PageSpec,
  assets: Map<string, Asset>,
  bleed: { x: number; y: number; w: number; h: number },
  issues: PreflightIssue[],
): void {
  const asset = frame.assetId ? assets.get(frame.assetId) : undefined;
  const visual = asset?.visual;
  if (!visual) return;

  const placed = placeImage(frame, visual.aspectRatio, frame.fit ?? 'fill', frame.focus);
  const dpi = effectiveDpi(visual.widthPx, visual.heightPx, placed.w, placed.h);
  const label = asset?.meta.fileName ?? '图片';
  if (dpi < PARAMS.dpiError) {
    issues.push({
      id: `dpi:${page.id}:${frame.id}`,
      level: 'error',
      code: 'lowDpi',
      pageIndex: page.index,
      frameId: frame.id,
      assetId: asset?.id,
      message: `第 ${page.index + 1} 页「${label}」有效分辨率约 ${Math.round(dpi)} DPI，低于 ${PARAMS.dpiError}，印刷会明显模糊。`,
      autoFix: 'shrinkFrame',
    });
  } else if (dpi < PARAMS.dpiStrongWarning) {
    issues.push({
      id: `dpi:${page.id}:${frame.id}`,
      level: 'warning',
      code: 'lowDpi',
      pageIndex: page.index,
      frameId: frame.id,
      assetId: asset?.id,
      message: `第 ${page.index + 1} 页「${label}」约 ${Math.round(dpi)} DPI，建议缩小画框或换图。`,
      autoFix: 'shrinkFrame',
    });
  } else if (dpi < spec.targetDpi) {
    issues.push({
      id: `dpi:${page.id}:${frame.id}`,
      level: 'info',
      code: 'lowDpi',
      pageIndex: page.index,
      frameId: frame.id,
      assetId: asset?.id,
      message: `第 ${page.index + 1} 页「${label}」约 ${Math.round(dpi)} DPI，未达目标 ${spec.targetDpi} DPI。`,
    });
  }

  if (frame.bleedOut && spec.bleed > 0 && !rectWithin(bleed, placed)) {
    issues.push({
      id: `bleed:${page.id}:${frame.id}`,
      level: 'warning',
      code: 'bleedNotCovered',
      pageIndex: page.index,
      frameId: frame.id,
      message: `第 ${page.index + 1} 页的满版图没有铺满出血区，裁切后可能露白。`,
      autoFix: 'extendBleed',
    });
  }
}

function checkTextFrame(
  page: Page,
  frame: LayoutFrame,
  spec: PageSpec,
  assets: Map<string, Asset>,
  measure: (key: FontKey) => MeasureText,
  safe: { x: number; y: number; w: number; h: number },
  issues: PreflightIssue[],
): void {
  const text = frameText(frame, assets);
  if (!text.trim()) return;
  const placed = placeTextFrame({ frame, spec, text, measure: measure(fontRoleKey(frame.textRole)) });
  if (placed.overflow || placed.truncated) {
    issues.push({
      id: `text:${page.id}:${frame.id}`,
      level: placed.truncated ? 'error' : 'warning',
      code: 'textOverflow',
      pageIndex: page.index,
      frameId: frame.id,
      message: placed.truncated
        ? `第 ${page.index + 1} 页文字超出文本框，已被截断。`
        : `第 ${page.index + 1} 页文字接近溢出，建议缩短或换模板。`,
      autoFix: placed.truncated ? 'switchTemplate' : 'shrinkFrame',
    });
  }
  if (frame.textRole !== 'pageNumber' && !rectsOverlap(frame, safe)) {
    issues.push({
      id: `outside:${page.id}:${frame.id}`,
      level: 'warning',
      code: 'textOverflow',
      pageIndex: page.index,
      frameId: frame.id,
      message: `第 ${page.index + 1} 页有文字完全落在安全区之外。`,
    });
  }
}

/** Groups issues for the UI summary badge. */
export function countIssues(issues: PreflightIssue[]): {
  error: number;
  warning: number;
  info: number;
} {
  return {
    error: issues.filter((i) => i.level === 'error').length,
    warning: issues.filter((i) => i.level === 'warning').length,
    info: issues.filter((i) => i.level === 'info').length,
  };
}
