import { beforeEach, describe, expect, it } from 'vitest';
import { groupAssets } from '../src/engine/grouping/group';
import {
  BUILTIN_STYLES,
  builtinStyleById,
  defaultStyle,
  groupingForStyle,
  parseBookStyle,
  serializeStyle,
  specForStyle,
  templatePool,
  templateWeight,
} from '../src/engine/layout/bookStyle';
import { generatePages } from '../src/engine/layout/generate';
import { defaultGroupingSettings, defaultPageSpec } from '../src/shared/constants';
import { resetIdCounter } from '../src/shared/ids';
import { fakeImage } from './fixtures';

const baseSpec = defaultPageSpec('A4');
const baseGrouping = defaultGroupingSettings();

describe('book styles', () => {
  beforeEach(() => resetIdCounter());

  it('ships builtin styles with unique ids', () => {
    const ids = BUILTIN_STYLES.map((style) => style.id);
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_STYLES.every((style) => style.builtin)).toBe(true);
    expect(builtinStyleById(defaultStyle().id)?.name).toBe(defaultStyle().name);
    expect(builtinStyleById('nope')).toBeUndefined();
  });

  it('projects page geometry and grouping onto the current settings', () => {
    const cinema = builtinStyleById('cinema')!;
    const spec = specForStyle(cinema, baseSpec);
    expect(spec.trimWidth).toBe(cinema.page.trimWidth);
    expect(spec.trimHeight).toBe(cinema.page.trimHeight);
    // Unrelated print settings survive the switch.
    expect(spec.targetDpi).toBe(baseSpec.targetDpi);

    const grouping = groupingForStyle(cinema, baseGrouping);
    for (const [key, value] of Object.entries(cinema.grouping)) {
      expect(grouping[key as keyof typeof grouping]).toBe(value);
    }
  });

  it('never lets a style empty the template pool', () => {
    const narrow = { ...defaultStyle(), layout: { cover: true, chapters: false, allow: ['T04'], weights: {} } };
    const pool = templatePool(narrow, ['T01', 'T02', 'T04', 'T08']);
    expect(pool).toContain('T04');
    // Fallbacks are always available so pagination cannot drop an asset.
    expect(pool).toContain('T01');
    expect(pool).toContain('T08');
    expect(pool).not.toContain('T02');
    expect(templatePool(undefined, ['T01', 'T02'])).toEqual(['T01', 'T02']);
    expect(templateWeight(narrow, 'T04')).toBe(1);
    expect(templateWeight(undefined, 'T04')).toBe(1);
  });

  it('keeps every asset when the style bans most templates', () => {
    const assets = Array.from({ length: 14 }, (_, i) => fakeImage(i, { aspect: i % 2 ? 1.5 : 0.75 }));
    const style = {
      ...defaultStyle(),
      layout: { cover: false, chapters: false, allow: ['T02'], weights: { T02: 2 } },
    };
    const groups = groupAssets(assets, baseGrouping);
    const pages = generatePages({ spec: baseSpec, assets, groups, style });
    const placed = new Set(
      pages.flatMap((page) => page.frames.filter((f) => f.kind === 'image').map((f) => f.assetId)),
    );
    expect(placed.size).toBe(assets.length);
    expect(pages.some((page) => page.templateId === 'T09')).toBe(false);
  });

  it('round-trips an exported style', () => {
    const source = builtinStyleById('magazine')!;
    const parsed = parseBookStyle(JSON.parse(serializeStyle(source)));
    expect(parsed.builtin).toBe(false);
    expect(parsed.id.startsWith('custom:')).toBe(true);
    expect(parsed.page).toEqual(source.page);
    expect(parsed.layout.allow).toEqual(source.layout.allow);
  });

  it('sanitises hostile or sloppy template files', () => {
    const parsed = parseBookStyle({
      name: '  我的   模版  ',
      id: 'classic',
      bleed: 99,
      page: { trimWidth: 5000, trimHeight: 210, bleed: 99, safeMargin: -4, showPageNumbers: 'yes' },
      grouping: { orderMode: 'evil', maxImagesPerGroup: 500 },
      layout: { cover: 'yes', allow: ['T02', 'nope'], weights: { T02: 99, nope: 3 } },
    });
    expect(parsed.name).toBe('我的 模版');
    // A file can never impersonate a builtin id.
    expect(parsed.id).toBe('custom:classic');
    expect(parsed.page.trimWidth).toBeLessThanOrEqual(600);
    expect(parsed.page.bleed).toBeLessThanOrEqual(10);
    expect(parsed.page.safeMargin).toBeGreaterThanOrEqual(0);
    expect(parsed.page.showPageNumbers).toBe(true);
    expect(parsed.grouping.orderMode).toBeUndefined();
    expect(parsed.grouping.maxImagesPerGroup).toBeLessThanOrEqual(24);
    expect(parsed.layout.allow).toEqual(['T02']);
    expect(parsed.layout.weights).toEqual({ T02: 3 });
    expect(parsed.layout.cover).toBe(true);
  });

  it('keeps an imported preset size and falls back to custom', () => {
    const b4 = parseBookStyle({ name: 'b4', page: { sizeId: 'B4', trimWidth: 250, trimHeight: 353 } });
    expect(b4.page.sizeId).toBe('B4');
    const odd = parseBookStyle({ name: 'odd', page: { sizeId: 'A0', trimWidth: 250, trimHeight: 353 } });
    expect(odd.page.sizeId).toBe('custom');
  });

  it('rejects files that are not templates', () => {
    expect(() => parseBookStyle({ kind: 'something.else', style: { name: 'x' } })).toThrow();
    expect(() => parseBookStyle({ name: '   ' })).toThrow();
    expect(() => parseBookStyle({ name: 'x', layout: { allow: ['Z9'] } })).toThrow();
    expect(() =>
      parseBookStyle({ kind: 'autobook.template', version: 99, style: { name: 'x' } }),
    ).toThrow();
  });
});
