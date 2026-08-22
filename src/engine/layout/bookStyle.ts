import { A4, A5, pageSizePreset } from '../../shared/constants';
import type { GroupingSettings, OrderMode, PageSpec } from '../../shared/types';
import { templateById } from './templates';

/**
 * A book style ("模版") is the reusable part of a book's look: page geometry,
 * grouping preferences and which page templates the composer may use. It is
 * plain JSON so a style can be exported, shared and imported again.
 *
 * The remaining PageSpec fields (targetDpi, background, cropMarks) stay under
 * user control and are never overwritten by a style.
 */
export interface StylePage {
  sizeId: PageSpec['sizeId'];
  trimWidth: number;
  trimHeight: number;
  orientation: PageSpec['orientation'];
  bleed: number;
  safeMargin: number;
  gutter: number;
  showPageNumbers: boolean;
}

export interface StyleLayout {
  /** Emit a full-bleed cover as page 0. */
  cover: boolean;
  /** Emit generated chapter dividers between groups. */
  chapters: boolean;
  /** Template ids the style may use; empty means all of them. */
  allow: string[];
  /** Score multipliers per template id; missing entries count as 1. */
  weights: Record<string, number>;
}

export interface BookStyle {
  id: string;
  name: string;
  latin: string;
  blurb: string;
  builtin: boolean;
  page: StylePage;
  grouping: Partial<GroupingSettings>;
  layout: StyleLayout;
}

function page(patch: Partial<StylePage>): StylePage {
  return {
    sizeId: 'A4',
    trimWidth: A4.trimWidth,
    trimHeight: A4.trimHeight,
    orientation: 'portrait',
    bleed: 3,
    safeMargin: A4.safeMargin,
    gutter: A4.gutter,
    showPageNumbers: true,
    ...patch,
  };
}

/** T01 (one image) and T08 (one text) are always available as a fallback, so
 *  a narrow allow-list can never leave an asset unplaced. */
export const FALLBACK_TEMPLATES = ['T01', 'T08'] as const;

const CLASSIC: BookStyle = {
  id: 'classic',
  name: '经典画册',
  latin: 'classic album',
  blurb: '主图、图文、双图与网格交替，节奏平稳，适合大多数照片集。',
  builtin: true,
  page: page({}),
  grouping: {},
  layout: { cover: true, chapters: true, allow: [], weights: {} },
};

const GALLERY: BookStyle = {
  id: 'gallery',
  name: '美术馆留白',
  latin: 'gallery',
  blurb: '大留白、单图为主，图片不裁切，适合作品集与安静的影像。',
  builtin: true,
  page: page({ safeMargin: 24, gutter: 18 }),
  grouping: { maxImagesPerGroup: 6, groupStrength: 1.1 },
  layout: {
    cover: true,
    chapters: true,
    allow: ['T01', 'T02', 'T03', 'T04', 'T08', 'T09'],
    weights: { T02: 1.4, T08: 1.2, T03: 1.1, T01: 0.8 },
  },
};

const MAGAZINE: BookStyle = {
  id: 'magazine',
  name: '杂志编排',
  latin: 'magazine',
  blurb: '窄边距、多图并置，一页信息量更大，适合旅行与活动记录。',
  builtin: true,
  page: page({ safeMargin: 10, gutter: 12 }),
  grouping: { maxImagesPerGroup: 12 },
  layout: {
    cover: true,
    chapters: true,
    allow: [],
    weights: { T05: 1.3, T06: 1.25, T07: 1.3, T03: 1.1, T02: 0.7 },
  },
};

const CINEMA: BookStyle = {
  id: 'cinema',
  name: '满版影像',
  latin: 'cinema',
  blurb: '横开本、满版与跨页全景优先，不排页码，像放映一样一页一张。',
  builtin: true,
  page: page({
    orientation: 'landscape',
    trimWidth: A4.trimHeight,
    trimHeight: A4.trimWidth,
    safeMargin: 9,
    gutter: 10,
    showPageNumbers: false,
  }),
  grouping: { maxImagesPerGroup: 8, allowSpreads: true },
  layout: {
    cover: true,
    chapters: false,
    allow: ['T01', 'T02', 'T04', 'T08', 'T09', 'T10'],
    weights: { T01: 1.5, T10: 1.6, T04: 1.05 },
  },
};

const ZINE: BookStyle = {
  id: 'zine',
  name: '方形小册',
  latin: 'square zine',
  blurb: '190mm 方形开本，网格与满版混排，页数少而紧凑。',
  builtin: true,
  page: page({ sizeId: 'custom', trimWidth: 190, trimHeight: 190, safeMargin: 11, gutter: 12 }),
  grouping: { maxImagesPerGroup: 9, groupStrength: 0.9 },
  layout: {
    cover: true,
    chapters: false,
    allow: ['T01', 'T02', 'T04', 'T06', 'T07', 'T08'],
    weights: { T07: 1.3, T04: 1.15, T01: 1.1 },
  },
};

const POCKET: BookStyle = {
  id: 'pocket',
  name: 'A5 手账',
  latin: 'pocket book',
  blurb: 'A5 小开本，图文成对出现，适合配文字较多的日记式相册。',
  builtin: true,
  page: page({
    sizeId: 'A5',
    trimWidth: A5.trimWidth,
    trimHeight: A5.trimHeight,
    safeMargin: A5.safeMargin,
    gutter: A5.gutter,
  }),
  grouping: { maxImagesPerGroup: 6 },
  layout: {
    cover: true,
    chapters: true,
    allow: ['T01', 'T02', 'T03', 'T04', 'T06', 'T08', 'T09'],
    weights: { T03: 1.45, T08: 1.15, T02: 1.1 },
  },
};

export const BUILTIN_STYLES: BookStyle[] = [CLASSIC, GALLERY, MAGAZINE, CINEMA, ZINE, POCKET];

export function defaultStyle(): BookStyle {
  return CLASSIC;
}

export function builtinStyleById(id: string): BookStyle | undefined {
  return BUILTIN_STYLES.find((style) => style.id === id);
}

/** Page geometry of the style, keeping the user's dpi / crop-mark choices. */
export function specForStyle(style: BookStyle, base: PageSpec): PageSpec {
  return { ...base, ...style.page };
}

export function groupingForStyle(style: BookStyle, base: GroupingSettings): GroupingSettings {
  return { ...base, ...style.grouping };
}

/** Template ids the style allows, always including the fallbacks. */
export function templatePool(style: BookStyle | undefined, ids: string[]): string[] {
  if (!style || style.layout.allow.length === 0) return ids;
  const allow = new Set([...style.layout.allow, ...FALLBACK_TEMPLATES]);
  return ids.filter((id) => allow.has(id));
}

export function templateWeight(style: BookStyle | undefined, templateId: string): number {
  const weight = style?.layout.weights[templateId];
  return typeof weight === 'number' && weight > 0 ? weight : 1;
}

export const STYLE_FILE_KIND = 'autobook.template';
export const STYLE_FILE_VERSION = 1;

/** JSON payload written by 导出模版 and accepted by 导入模版. */
export function serializeStyle(style: BookStyle): string {
  return JSON.stringify(
    { kind: STYLE_FILE_KIND, version: STYLE_FILE_VERSION, style: { ...style, builtin: false } },
    null,
    2,
  );
}

const ORDER_MODES: OrderMode[] = ['original', 'time', 'colorFlow', 'standardSmart', 'shuffleRhythm'];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

/** Imported ids are namespaced so a shared file can never shadow a builtin. */
function customId(raw: unknown, name: string): string {
  const source = typeof raw === 'string' && raw.trim() ? raw.trim() : name;
  const slug = source
    .toLowerCase()
    .replace(/^custom:/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `custom:${slug || 'style'}`;
}

function parsePage(raw: unknown): StylePage {
  const source = record(raw);
  const base = page({});
  const trimWidth = clamp(source.trimWidth, 50, 600, base.trimWidth);
  const trimHeight = clamp(source.trimHeight, 50, 600, base.trimHeight);
  const sizeId =
    typeof source.sizeId === 'string' && pageSizePreset(source.sizeId as PageSpec['sizeId'])
      ? (source.sizeId as PageSpec['sizeId'])
      : 'custom';
  const orientation =
    source.orientation === 'portrait' || source.orientation === 'landscape'
      ? source.orientation
      : trimWidth > trimHeight
        ? 'landscape'
        : 'portrait';
  const shortSide = Math.min(trimWidth, trimHeight);
  return {
    sizeId,
    trimWidth,
    trimHeight,
    orientation,
    bleed: clamp(source.bleed, 0, 10, base.bleed),
    safeMargin: clamp(source.safeMargin, 0, shortSide / 3, base.safeMargin),
    gutter: clamp(source.gutter, 0, shortSide / 3, base.gutter),
    showPageNumbers: flag(source.showPageNumbers, base.showPageNumbers),
  };
}

function parseGrouping(raw: unknown): Partial<GroupingSettings> {
  const source = record(raw);
  const out: Partial<GroupingSettings> = {};
  if (ORDER_MODES.includes(source.orderMode as OrderMode)) {
    out.orderMode = source.orderMode as OrderMode;
  }
  if (source.groupStrength !== undefined) out.groupStrength = clamp(source.groupStrength, 0.4, 2, 1);
  if (source.colorWeight !== undefined) out.colorWeight = clamp(source.colorWeight, 0, 1, 0.5);
  if (source.timeWeight !== undefined) out.timeWeight = clamp(source.timeWeight, 0, 1, 0.2);
  if (source.maxImagesPerGroup !== undefined) {
    out.maxImagesPerGroup = Math.round(clamp(source.maxImagesPerGroup, 2, 24, 10));
  }
  if (source.windowSize !== undefined) {
    out.windowSize = Math.round(clamp(source.windowSize, 2, 16, 8));
  }
  if (typeof source.allowSpreads === 'boolean') out.allowSpreads = source.allowSpreads;
  return out;
}

function parseLayout(raw: unknown): StyleLayout {
  const source = record(raw);
  const allow = Array.isArray(source.allow)
    ? source.allow.filter((id): id is string => typeof id === 'string' && !!templateById(id))
    : [];
  if (Array.isArray(source.allow) && source.allow.length > 0 && allow.length === 0) {
    throw new Error('模版文件中的版式编号无法识别。');
  }
  const weights: Record<string, number> = {};
  for (const [id, value] of Object.entries(record(source.weights))) {
    if (!templateById(id)) continue;
    weights[id] = clamp(value, 0.1, 3, 1);
  }
  return {
    cover: flag(source.cover, true),
    chapters: flag(source.chapters, true),
    allow: [...new Set(allow)],
    weights,
  };
}

/**
 * Accepts either the wrapped export payload or a bare style object, and returns
 * a sanitised, non-builtin style. Throws a user-facing Chinese error otherwise.
 */
export function parseBookStyle(input: unknown): BookStyle {
  const outer = record(input);
  const wrapped = outer.style !== undefined || outer.kind !== undefined;
  if (wrapped && outer.kind !== undefined && outer.kind !== STYLE_FILE_KIND) {
    throw new Error('这不是「一键成册」的模版文件。');
  }
  if (wrapped && typeof outer.version === 'number' && outer.version > STYLE_FILE_VERSION) {
    throw new Error('模版文件版本过新，请升级后再导入。');
  }
  const source = wrapped ? record(outer.style) : outer;
  const name = text(source.name, '', 24);
  if (!name) throw new Error('模版缺少名称。');
  return {
    id: customId(source.id, name),
    name,
    latin: text(source.latin, 'imported style', 32),
    blurb: text(source.blurb, '导入的模版。', 60),
    builtin: false,
    page: parsePage(source.page),
    grouping: parseGrouping(source.grouping),
    layout: parseLayout(source.layout),
  };
}
