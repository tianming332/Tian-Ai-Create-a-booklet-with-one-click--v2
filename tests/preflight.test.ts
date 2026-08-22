import { beforeEach, describe, expect, it } from 'vitest';
import { groupAssets } from '../src/engine/grouping/group';
import { generatePages } from '../src/engine/layout/generate';
import { preflight, countIssues } from '../src/export/preflight';
import { defaultGroupingSettings, defaultPageSpec } from '../src/shared/constants';
import { resetIdCounter } from '../src/shared/ids';
import type { Asset } from '../src/shared/types';
import { fakeImage } from './fixtures';

const spec = defaultPageSpec('A4');
const grouping = defaultGroupingSettings();

function buildBook(assets: Asset[]) {
  const groups = groupAssets(assets, grouping);
  return { pageSpec: spec, grouping, assets, groups, pages: generatePages({ spec, assets, groups }) };
}

describe('preflight', () => {
  beforeEach(() => resetIdCounter());

  it('reports an empty project and stops', () => {
    const issues = preflight({ book: buildBook([]) });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('noAssets');
  });

  it('is clean apart from the RGB notice for high-resolution photos', () => {
    const assets = Array.from({ length: 12 }, (_, i) =>
      fakeImage(i, { aspect: i % 3 === 0 ? 0.75 : 1.5, takenAt: Date.UTC(2026, 4, 3, 9, i * 6) }),
    );
    const issues = preflight({ book: buildBook(assets) });
    expect(issues.some((i) => i.code === 'lowDpi' && i.level === 'error')).toBe(false);
    expect(issues.some((i) => i.code === 'noCmykPdfx')).toBe(true);
  });

  it('flags images whose effective resolution is too low', () => {
    const assets = Array.from({ length: 8 }, (_, i) =>
      fakeImage(i, { takenAt: Date.UTC(2026, 4, 3, 9, i) }),
    ).map((asset) => ({
      ...asset,
      visual: { ...asset.visual!, widthPx: 480, heightPx: 320 },
      meta: { ...asset.meta, widthPx: 480, heightPx: 320 },
    }));
    const issues = preflight({ book: buildBook(assets) });
    const low = issues.filter((i) => i.code === 'lowDpi' && i.level === 'error');
    expect(low.length).toBeGreaterThan(0);
    expect(low[0].autoFix).toBe('shrinkFrame');
  });

  it('reports decode failures and missing fonts', () => {
    const assets = [fakeImage(0), { ...fakeImage(1), analysisStatus: 'error' as const }];
    const issues = preflight({ book: buildBook(assets), fonts: { sans: true, serif: false } });
    expect(issues.some((i) => i.code === 'assetDecodeFailed')).toBe(true);
    expect(issues.some((i) => i.code === 'fontMissing' && i.autoFix === 'fallbackFont')).toBe(true);
  });

  it('warns when the page count is not a multiple of four', () => {
    const assets = Array.from({ length: 3 }, (_, i) => fakeImage(i));
    const book = buildBook(assets);
    const issues = preflight({ book });
    const expected = book.pages.length % 4 !== 0;
    expect(issues.some((i) => i.code === 'pageCountNotMultipleOfFour')).toBe(expected);
  });

  it('is deterministic and countable', () => {
    const assets = Array.from({ length: 10 }, (_, i) => fakeImage(i));
    const book = buildBook(assets);
    const a = preflight({ book });
    const b = preflight({ book });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const counts = countIssues(a);
    expect(counts.error + counts.warning + counts.info).toBe(a.length);
  });
});
