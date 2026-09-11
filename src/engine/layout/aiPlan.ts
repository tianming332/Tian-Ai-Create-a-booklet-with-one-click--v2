import { makeId } from '../../shared/ids';
import type { Asset, Group, Page, PageSpec } from '../../shared/types';
import { balanceTextPages, generatePages, pageNumberFrame, sideForIndex } from './generate';
import { frameGap, templateById } from './templates';
import { templatePool, type BookStyle } from './bookStyle';
import type { TemplateContext } from './types';
import { parsePhotoName } from '../analysis/filename';
import { buildDigest, type StoryDigest } from './storyOrder';

export interface LayoutPlanPage {
  templateId: string;
  assetIds: string[];
  chapterTitle?: string | null;
}

export interface LayoutPlan {
  pages: LayoutPlanPage[];
}

export interface MaterializeResult {
  pages: Page[];
  warnings: string[];
}

const TEMPLATE_COUNTS: Record<string, { minImages: number; maxImages: number; maxTexts: number; spread?: boolean }> = {
  T01: { minImages: 1, maxImages: 1, maxTexts: 1 },
  T02: { minImages: 1, maxImages: 1, maxTexts: 1 },
  T03: { minImages: 1, maxImages: 1, maxTexts: 1 },
  T04: { minImages: 2, maxImages: 2, maxTexts: 1 },
  T05: { minImages: 3, maxImages: 3, maxTexts: 1 },
  T06: { minImages: 3, maxImages: 3, maxTexts: 1 },
  T07: { minImages: 4, maxImages: 4, maxTexts: 1 },
  T08: { minImages: 0, maxImages: 0, maxTexts: 1 },
  T09: { minImages: 0, maxImages: 1, maxTexts: 0 },
  T10: { minImages: 1, maxImages: 1, maxTexts: 0, spread: true },
};

export function digestAssets(assets: Asset[]): StoryDigest[] {
  return assets.map(buildDigest);
}

function splitAssets(ids: string[], byAsset: Map<string, Asset>): { images: Asset[]; texts: Asset[] } {
  const images: Asset[] = [];
  const texts: Asset[] = [];
  for (const id of ids) {
    const asset = byAsset.get(id);
    if (!asset) continue;
    if (asset.kind === 'image') images.push(asset);
    else texts.push(asset);
  }
  return { images, texts };
}

function fallbackId(images: number, texts: number): string {
  if (images >= 1) return 'T01';
  if (texts >= 1) return 'T08';
  return 'T09';
}

function makePage(
  index: number,
  templateId: string,
  frames: Page['frames'],
  spec: PageSpec,
  extra: Partial<Page> = {},
): Page {
  const side = sideForIndex(index);
  const all = [...frames];
  if (spec.showPageNumbers && index > 0) all.push(pageNumberFrame(spec, side, index));
  const def = templateById(templateId);
  return {
    id: makeId('pg'),
    index,
    templateId,
    density: def?.density ?? 1,
    frames: all,
    locked: false,
    ...extra,
  };
}

export function parsePlanJson(text: string): LayoutPlan {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : raw).trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('排版模型未返回 JSON');
  const parsed = JSON.parse(source.slice(start, end + 1)) as LayoutPlan;
  if (!Array.isArray(parsed.pages)) throw new Error('排版方案缺少 pages');
  return parsed;
}

export function materializeAiPlan(
  spec: PageSpec,
  assets: Asset[],
  groups: Group[],
  style: BookStyle | undefined,
  plan: LayoutPlan,
): MaterializeResult {
  const byAsset = new Map(assets.map((asset) => [asset.id, asset]));
  const pool = new Set(templatePool(style, Object.keys(TEMPLATE_COUNTS)));
  const used = new Set<string>();
  const warnings: string[] = [];
  const pages: Page[] = [];
  const wantCover = style ? style.layout.cover : true;

  const pushFrom = (templateId: string, ids: string[], chapterTitle?: string | null) => {
    const available = [...new Set((ids || []).filter((id) => byAsset.has(id) && !used.has(id)))];
    let id = pool.has(templateId) ? templateId : fallbackId(
      splitAssets(available, byAsset).images.length,
      splitAssets(available, byAsset).texts.length,
    );
    if (id === 'T10' && sideForIndex(pages.length) !== 'left' && pages.length !== 0) {
      warnings.push('跨页全景不在左页，已改为满版');
      id = 'T01';
    }
    const counts = TEMPLATE_COUNTS[id] ?? TEMPLATE_COUNTS.T01;
    const split = splitAssets(available, byAsset);
    const images = split.images.slice(0, Math.max(counts.maxImages, 1));
    const texts = split.texts.slice(0, Math.max(counts.maxTexts, 1));
    if (images.length === 0 && texts.length === 0 && id !== 'T09') return;
    if (images.length < (counts.minImages || 0) && id !== 'T09') {
      id = fallbackId(images.length, texts.length);
    }
    const def = templateById(id);
    if (!def) {
      warnings.push(`未知模板 ${templateId}`);
      return;
    }
    const ctx: TemplateContext = {
      spec,
      side: sideForIndex(pages.length),
      images,
      texts,
      gap: frameGap(spec),
      pageIndex: pages.length,
      chapterTitle: chapterTitle || undefined,
    };
    if (!def.accepts(ctx) && id !== 'T09') {
      const fallback = templateById(fallbackId(images.length, texts.length));
      if (!fallback) return;
      id = fallback.id;
    }
    const builder = templateById(id) ?? def;
    const built = builder.build({
      ...ctx,
      side: sideForIndex(pages.length),
      pageIndex: pages.length,
    });
    pages.push(makePage(pages.length, id, built, spec));
    for (const frame of built) {
      if (frame.assetId) used.add(frame.assetId);
    }
    if (TEMPLATE_COUNTS[id]?.spread) {
      const partnerCtx: TemplateContext = {
        ...ctx,
        side: sideForIndex(pages.length),
        pageIndex: pages.length,
      };
      const partner = makePage(pages.length, id, builder.build(partnerCtx), spec, {
        spreadPartnerOf: pages[pages.length - 1].id,
      });
      pages.push(partner);
    }
  };

  let start = 0;
  const first = plan.pages[0];
  const firstAsset = first ? byAsset.get(first.assetIds?.[0] || '') : undefined;
  const firstIsCover = first?.templateId === 'T01' && firstAsset?.kind === 'image' && !parsePhotoName(firstAsset.meta.fileName).screenshot;
  if (wantCover && !firstIsCover) {
    const hero = assets.find((asset) => asset.kind === 'image' && asset.visual && !parsePhotoName(asset.meta.fileName).screenshot);
    if (hero) {
      pushFrom('T01', [hero.id]);
      warnings.push('已补封面');
    }
  } else if (firstIsCover) {
    pushFrom('T01', first.assetIds, first.chapterTitle);
    start = 1;
  }

  for (const page of plan.pages.slice(start)) {
    const id = String(page.templateId || '');
    if (!TEMPLATE_COUNTS[id]) {
      warnings.push(`忽略未知模板 ${id}`);
      continue;
    }
    pushFrom(id, page.assetIds || [], page.chapterTitle);
  }

  const leftover = assets.filter((asset) => !used.has(asset.id) && (asset.kind === 'image' || asset.kind === 'text'));
  if (leftover.length) {
    const leftoverGroups: Group[] = leftover.some((asset) => asset.kind === 'image')
      ? [{ id: 'leftover', assetIds: leftover.map((asset) => asset.id), locked: false }]
      : [{ id: 'leftover-text', assetIds: leftover.map((asset) => asset.id), locked: false }];
    const extra = generatePages({
      spec,
      assets: leftover,
      groups: leftoverGroups.length ? leftoverGroups : groups,
      style,
      cover: false,
      chapters: false,
    }).filter((page) => !page.isBlank);
    for (const page of extra) {
      pages.push({ ...page, index: pages.length, id: makeId('pg') });
    }
    if (extra.length) warnings.push(`有 ${leftover.length} 张素材已按规则补页`);
  }

  const balanced = balanceTextPages(pages, spec);
  if (balanced.length % 2 === 1) {
    balanced.push({
      id: makeId('pg'),
      index: balanced.length,
      templateId: 'blank',
      density: 1,
      frames: [],
      locked: false,
      isBlank: true,
    });
  }
  const reindexed = balanced.map((page, index) => ({ ...page, index }));
  return { pages: reindexed, warnings };
}
