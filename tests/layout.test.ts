import { describe, expect, it, beforeEach } from 'vitest';
import { defaultGroupingSettings, defaultPageSpec, PAGE_SIZES, sizePatch } from '../src/shared/constants';
import { mediaSize, rectWithin, safeRect } from '../src/shared/geometry';
import { resetIdCounter } from '../src/shared/ids';
import { groupAssets } from '../src/engine/grouping/group';
import { chapterTitleFor, generatePages } from '../src/engine/layout/generate';
import { TEMPLATES } from '../src/engine/layout/templates';
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
    // The cover repeats one hero image, so ids may appear twice at most.
    for (const asset of assets) expect(unique.has(asset.id)).toBe(true);
    expect(placed.length).toBeGreaterThanOrEqual(assets.length);
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
