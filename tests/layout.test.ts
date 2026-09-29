import { describe, expect, it, beforeEach } from 'vitest';
import { defaultGroupingSettings, defaultPageSpec, PAGE_SIZES, sizePatch } from '../src/shared/constants';
import { mediaSize, rectWithin, safeRect } from '../src/shared/geometry';
import { resetIdCounter } from '../src/shared/ids';
import { groupAssets } from '../src/engine/grouping/group';
import { chapterTitleFor, generatePages } from '../src/engine/layout/generate';
import { TEMPLATES, templateById } from '../src/engine/layout/templates';
import { parseTextDocument } from '../src/engine/text/structure';
import { fakeImage, fakeText } from './fixtures';

const spec = defaultPageSpec('A4');

function buildBook(count: number) {
  const assets = Array.from({ length: count }, (_, i) =>
    fakeImage(i, {
      aspect: i % 5 === 0 ? 0.75 : i % 7 === 0 ? 2.4 : 1.5,
      luma: 0.3 + (i % 4) * 0.15,
      takenAt: Date.UTC(2026, 4, 3, 9, i * 7),
    }),
  );
  const groups = groupAssets(assets, defaultGroupingSettings());
  return { assets, groups, pages: generatePages({ spec, assets, groups }) };
}

describe('layout engine', () => {
  beforeEach(() => resetIdCounter());

  it('places every image exactly once', () => {
    const { assets, pages } = buildBook(24);
    const placed = pages
      .flatMap((p) => p.frames)
      .filter((f) => f.kind === 'image' && f.assetId)
      .map((f) => f.assetId!);
    const unique = new Set(placed);
    for (const asset of assets) expect(unique.has(asset.id)).toBe(true);
    const coverIds = new Set(
      (pages[0]?.frames ?? []).filter((frame) => frame.kind === 'image' && frame.assetId).map((frame) => frame.assetId!),
    );
    for (const page of pages.filter((item) => item.index > 0 && !item.spreadPartnerOf)) {
      for (const frame of page.frames) {
        if (frame.kind === 'image' && frame.assetId) expect(coverIds.has(frame.assetId)).toBe(false);
      }
    }
  });

  it('keeps frames inside the media box and never emits empty frames', () => {
    const { pages } = buildBook(18);
    const media = mediaSize(spec);
    const box = { x: -spec.bleed, y: -spec.bleed, w: media.w, h: media.h };
    for (const page of pages) {
      for (const frame of page.frames) {
        expect(frame.w).toBeGreaterThan(0.5);
        expect(frame.h).toBeGreaterThan(0.5);
        if (!frame.bleedOut) expect(rectWithin(frame, box, 0.02)).toBe(true);
      }
    }
  });

  it('keeps text frames inside the safe area', () => {
    const { pages } = buildBook(12);
    for (const page of pages) {
      const live = safeRect(spec, page.index === 0 ? 'single' : page.index % 2 === 1 ? 'right' : 'left');
      for (const frame of page.frames) {
        if (frame.kind !== 'text' || frame.bleedOut) continue;
        if (frame.textRole === 'pageNumber' || frame.color === '#ffffff') continue;
        expect(frame.x).toBeGreaterThanOrEqual(live.x - 0.02);
        expect(frame.x + frame.w).toBeLessThanOrEqual(live.x + live.w + 0.02);
      }
    }
  });

  it('produces an even page count', () => {
    for (const count of [1, 5, 13, 40]) {
      expect(buildBook(count).pages.length % 2).toBe(0);
    }
  });

  it('never repeats one template three pages in a row', () => {
    const { pages } = buildBook(40);
    const content = pages.filter((p) => !p.isBlank && p.index > 0 && !p.spreadPartnerOf);
    for (let i = 2; i < content.length; i += 1) {
      const same =
        content[i].templateId === content[i - 1].templateId &&
        content[i].templateId === content[i - 2].templateId;
      expect(same).toBe(false);
    }
  });

  it('is deterministic for identical input', () => {
    resetIdCounter();
    const first = JSON.stringify(buildBook(22).pages);
    resetIdCounter();
    const second = JSON.stringify(buildBook(22).pages);
    expect(second).toBe(first);
  });

  it('lays out captions with their image', () => {
    resetIdCounter();
    const images = Array.from({ length: 6 }, (_, i) => fakeImage(i, { takenAt: Date.UTC(2026, 4, 3, 9, i) }));
    const caption = fakeText(100, '海边的早晨', images[0].id);
    const assets = [...images, caption];
    const groups = groupAssets(assets, defaultGroupingSettings());
    const pages = generatePages({ spec, assets, groups });
    const withCaption = pages.find((p) => p.frames.some((f) => f.assetId === caption.id));
    expect(withCaption).toBeDefined();
    expect(withCaption!.frames.some((f) => f.assetId === images[0].id)).toBe(true);
  });

  it('keeps multiple bound captions with their image', () => {
    const image = fakeImage(0);
    const first = fakeText(100, '她在沙滩上笑得很开心', image.id);
    const second = fakeText(101, '镰仓，下午四点', image.id);
    for (const caption of [first, second]) {
      caption.textBlock = { ...parseTextDocument(caption.text!, caption.id).blocks[0], role: 'caption' };
    }
    const assets = [image, first, second];
    const groups = [{ id: 'g-caption', assetIds: assets.map((asset) => asset.id), locked: false }];
    const pages = generatePages({ spec, assets, groups, cover: false, chapters: false });
    const page = pages.find((candidate) => candidate.frames.some((frame) => frame.assetId === image.id));
    expect(page).toBeDefined();
    expect(page!.frames.some((frame) => frame.assetId === first.id)).toBe(true);
    expect(page!.frames.some((frame) => frame.assetId === second.id)).toBe(true);
  });

  it('writes no words the user never imported', () => {
    const { pages } = buildBook(24);
    const invented = pages
      .flatMap((p) => p.frames)
      .filter((f) => f.kind === 'text' && f.textRole !== 'pageNumber');
    expect(invented).toHaveLength(0);
    // Chapter dividers used to fall back to an EXIF month, e.g. "2026年5月".
    expect(pages.some((p) => p.templateId === 'T09')).toBe(false);
  });

  it('titles a chapter from imported text only', () => {
    const images = Array.from({ length: 3 }, (_, i) => fakeImage(i, { takenAt: Date.UTC(2026, 4, 3, 9, i) }));
    const label = fakeText(200, '第一天：海');
    const byId = new Map([...images, label].map((a) => [a.id, a]));
    const ids = [...images.map((i) => i.id), label.id];
    expect(chapterTitleFor({ id: 'g1', assetIds: ids, locked: false }, byId)).toBe('第一天：海');
    // Images alone carry no words, so the divider has nothing to say.
    expect(
      chapterTitleFor({ id: 'g2', assetIds: images.map((i) => i.id), locked: false }, byId),
    ).toBeUndefined();
  });

  it('exposes ten templates with unique ids', () => {    expect(TEMPLATES).toHaveLength(10);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(10);
  });

  it('maps legacy templates to a small set of parameterised families', () => {
    expect(templateById('T01')?.family).toBe('hero');
    expect(templateById('T03')?.family).toBe('split');
    expect(['T04', 'T05', 'T06', 'T07'].map((id) => templateById(id)?.family)).toEqual(['grid', 'grid', 'grid', 'grid']);
    expect(new Set(TEMPLATES.map((template) => template.family)).size).toBeLessThan(TEMPLATES.length);
  });

  it('places a structured document into multiple semantic slots on one page', () => {
    const document = parseTextDocument('# 夏日海边\n\n地点：镰仓\n\n引言：风从海岸吹来。\n\n这是一段进入画册的正文，它应该和标题、信息、引言形成清晰层级。正文需要有足够长度，从而稳定进入正文槽位而不是被识别为一句装饰短句，并在后续页面中继续排版。', 'doc-layout');
    const texts = document.blocks.map((block, index) => {
      const asset = fakeText(100 + index, block.text);
      asset.sourceDocumentId = document.id;
      asset.textBlock = block;
      return asset;
    });
    const image = fakeImage(1);
    const def = templateById('T03')!;
    const frames = def.build({ spec, side: 'right', images: [image], texts, gap: 4, pageIndex: 1 });
    const roles = frames.filter((frame) => frame.kind === 'text').map((frame) => frame.textRole);
    expect(roles).toContain('chapterTitle');
    expect(roles).toContain('caption');
    expect(roles).toContain('sentence');
    expect(roles).toContain('body');
    expect(new Set(frames.filter((frame) => frame.kind === 'text').map((frame) => frame.assetId)).size).toBe(texts.length);
  });

  it('parameterises split image side and width without duplicating templates', () => {
    const image = fakeImage(1, { aspect: 0.75 });
    const title = fakeText(2, '海边的一天');
    title.textBlock = { ...parseTextDocument('# 海边的一天', 'split-doc').blocks[0] };
    const def = templateById('T03')!;
    const left = def.build({
      spec, side: 'right', images: [image], texts: [title], gap: 4, pageIndex: 1,
      layoutParams: { imageSide: 'left', imageRatio: 0.4 },
    });
    const right = def.build({
      spec, side: 'right', images: [image], texts: [title], gap: 4, pageIndex: 1,
      layoutParams: { imageSide: 'right', imageRatio: 0.6 },
    });
    const leftImage = left.find((frame) => frame.kind === 'image')!;
    const leftText = left.find((frame) => frame.kind === 'text')!;
    const rightImage = right.find((frame) => frame.kind === 'image')!;
    const rightText = right.find((frame) => frame.kind === 'text')!;
    expect(leftImage.x).toBeLessThan(leftText.x);
    expect(rightImage.x).toBeGreaterThan(rightText.x);
    expect(rightImage.w).toBeGreaterThan(leftImage.w);
  });

  it('moves overlay text away from detected faces for CJK profiles', () => {
    const image = fakeImage(1);
    image.faces = [{ x: 0, y: 0.72, w: 1, h: 0.28 }];
    const caption = fakeText(2, '人物图注', image.id);
    const def = templateById('T01')!;
    const frames = def.build({
      spec, side:'right', images:[image], texts:[caption], gap:4, pageIndex:1, avoidFaces:true,
    });
    const text = frames.find((frame) => frame.kind === 'text');
    expect(text).toBeDefined();
    expect(text!.y).toBeLessThan(spec.trimHeight * 0.5);
  });

  it('lets the chapter family host imported semantic text without duplicating its title', () => {
    const document = parseTextDocument('# 夏日海边\n\n地点：镰仓\n\n引言：风从海岸吹来。', 'doc-chapter');
    const texts = document.blocks.map((block, index) => {
      const asset = fakeText(300 + index, block.text);
      asset.sourceDocumentId = document.id;
      asset.textBlock = block;
      return asset;
    });
    const def = templateById('T09')!;
    const frames = def.build({
      spec, side: 'right', images: [], texts, gap: 4, pageIndex: 1, chapterTitle: '不应重复的备用标题',
    });
    const contentFrames = frames.filter((frame) => frame.kind === 'text');
    expect(contentFrames.map((frame) => frame.assetId).filter(Boolean)).toHaveLength(texts.length);
    expect(contentFrames.some((frame) => frame.textOverride === '不应重复的备用标题')).toBe(false);
  });

  it('offers every open format in both orientations', () => {
    expect(PAGE_SIZES.map((preset) => preset.id)).toEqual([
      'A4',
      'A5',
      'B5',
      'B4',
      'B3',
      'square',
      'wide',
    ]);
    for (const preset of PAGE_SIZES) {
      const portrait = sizePatch(preset.id, 'portrait');
      const landscape = sizePatch(preset.id, 'landscape');
      expect(portrait.trimWidth!).toBeLessThanOrEqual(portrait.trimHeight!);
      expect(landscape.trimWidth!).toBeGreaterThanOrEqual(landscape.trimHeight!);
      // The two orientations are the same sheet, only turned.
      expect(portrait.trimWidth).toBe(landscape.trimHeight);
      expect(portrait.sizeId).toBe(preset.id);
    }
    expect(sizePatch('custom', 'portrait')).toEqual({});
    // Layout must survive the biggest and the squarest format.
    for (const id of ['B3', 'square'] as const) {
      const pages = generatePages({
        spec: { ...spec, ...sizePatch(id, 'portrait') },
        assets: buildBook(12).assets,
        groups: groupAssets(buildBook(12).assets, defaultGroupingSettings()),
      });
      expect(pages.length).toBeGreaterThan(1);
    }
  });
});
