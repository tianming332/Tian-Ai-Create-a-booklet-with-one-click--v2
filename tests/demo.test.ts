import { describe, expect, it } from 'vitest';
import { buildDemoFiles, DEMO_TEXT_BLOCKS, LONG_EDGE, SCENES } from '../src/demo/sample';
import { countIssues, preflight } from '../src/export/preflight';
import { groupAssets } from '../src/engine/grouping/group';
import { generatePages } from '../src/engine/layout/generate';
import { defaultGroupingSettings, defaultPageSpec, PARAMS } from '../src/shared/constants';
import type { Asset } from '../src/shared/types';
import { fakeImage, fakeText } from './fixtures';

const BASE = new Date(2026, 6, 11, 7, 0, 0).getTime();

/** Rough brightness per scene kind, so colour grouping behaves like the real thing. */
const LUMA: Record<string, number> = {
  sea: 0.48,
  sky: 0.7,
  forest: 0.3,
  mountain: 0.66,
  city: 0.24,
  food: 0.34,
  desert: 0.72,
  portrait: 0.5,
  texture: 0.62,
};

/** 15 hex chars + a per-photo nibble = a 16-char dHash like the analyser emits. */
const HASH_SEED: Record<string, string> = {
  sea: 'c3c3c3c3c3c3c3c',
  sky: 'ff00ff00ff00ff0',
  forest: '3c3c3c3c3c3c3c3',
  mountain: 'f0f0f0f0f0f0f0f',
  city: '0f0f0f0f0f0f0f0',
  food: 'a5a5a5a5a5a5a5a',
  desert: '5a5a5a5a5a5a5a5',
  portrait: '969696969696969',
  texture: '696969696969696',
};

/** Mirrors what the painted demo photos analyse to, without needing a canvas. */
function demoAssets(): Asset[] {
  return SCENES.map((scene, index) => {
    const widthPx = scene.aspect >= 1 ? LONG_EDGE : Math.round(LONG_EDGE * scene.aspect);
    const heightPx = scene.aspect >= 1 ? Math.round(LONG_EDGE / scene.aspect) : LONG_EDGE;
    const base = fakeImage(index, {
      aspect: scene.aspect,
      luma: LUMA[scene.kind],
      takenAt: BASE + scene.at * 60_000,
      dHash: `${HASH_SEED[scene.kind]}${(index % 16).toString(16)}`,
      lab: { l: LUMA[scene.kind] * 100, a: index % 5, b: -6 + (index % 7) },
    });
    return {
      ...base,
      visual: { ...base.visual!, widthPx, heightPx },
      meta: { ...base.meta, widthPx, heightPx },
    };
  });
}

function buildBook(assets: Asset[]) {
  const pageSpec = defaultPageSpec('A4');
  const grouping = defaultGroupingSettings();
  const groups = groupAssets(assets, grouping);
  return { pageSpec, grouping, assets, groups, pages: generatePages({ spec: pageSpec, assets, groups }) };
}

describe('demo project', () => {
  it('sits inside the documented asset range', () => {
    expect(SCENES.length).toBeGreaterThanOrEqual(20);
    expect(SCENES.length).toBeLessThanOrEqual(PARAMS.maxAssets);
    expect(DEMO_TEXT_BLOCKS.length).toBeGreaterThanOrEqual(4);
  });

  it('has a monotonic capture timeline with real gaps', () => {
    const times = SCENES.map((scene) => scene.at);
    for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeGreaterThan(times[i - 1]);
    const jumps = times.filter((at, i) => i > 0 && at - times[i - 1] > 180);
    expect(jumps.length).toBeGreaterThanOrEqual(3);
  });

  it('covers portrait, landscape and panorama shapes', () => {
    const aspects = SCENES.map((scene) => scene.aspect);
    expect(aspects.some((a) => a < 0.87)).toBe(true);
    expect(aspects.some((a) => a > 1.15)).toBe(true);
    expect(aspects.some((a) => a === 1)).toBe(true);
  });

  it('groups into several chapters within the size limits', () => {
    const grouping = defaultGroupingSettings();
    const groups = groupAssets(demoAssets(), grouping);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) {
      expect(group.assetIds.length).toBeLessThanOrEqual(PARAMS.groupHardMax);
    }
  });

  it('lays out and passes preflight without errors', () => {
    const assets = [
      ...demoAssets(),
      ...DEMO_TEXT_BLOCKS.map((text, i) => fakeText(SCENES.length + i, text)),
    ];
    const book = buildBook(assets);
    expect(book.pages.length).toBeGreaterThan(0);
    const issues = preflight({ book, fonts: { sans: true, serif: true } });
    const counts = countIssues(issues);
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([]);
    expect(counts.error).toBe(0);
  });

  it('is deterministic for the same assets', () => {
    const assets = demoAssets();
    const first = buildBook(assets);
    const second = buildBook(assets);
    expect(first.pages.length).toBe(second.pages.length);
    expect(JSON.stringify(preflight({ book: first }).map((i) => i.code))).toBe(
      JSON.stringify(preflight({ book: second }).map((i) => i.code)),
    );
  });
});

/** Records the 2D calls the painters make, so they can run without a real canvas. */
class FakeContext {
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 0;
  fills = 0;
  private gradient = { addColorStop: () => undefined };
  createLinearGradient = () => this.gradient;
  createRadialGradient = () => this.gradient;
  fillRect = () => {
    this.fills += 1;
  };
  fill = () => {
    this.fills += 1;
  };
  stroke = () => undefined;
  beginPath = () => undefined;
  closePath = () => undefined;
  moveTo = () => undefined;
  lineTo = () => undefined;
  quadraticCurveTo = () => undefined;
  arc = () => undefined;
  ellipse = () => undefined;
}

describe('demo file generation', () => {
  it('paints one JPEG per scene plus the text document', async () => {
    const context = new FakeContext();
    class FakeOffscreenCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return context;
      }
      convertToBlob() {
        return Promise.resolve(new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }));
      }
    }
    const globals = globalThis as unknown as { OffscreenCanvas?: unknown };
    const previous = globals.OffscreenCanvas;
    globals.OffscreenCanvas = FakeOffscreenCanvas;
    try {
      const seen: number[] = [];
      const files = await buildDemoFiles((done) => seen.push(done));
      expect(files.length).toBe(SCENES.length + 1);
      expect(seen.length).toBe(SCENES.length);
      expect(context.fills).toBeGreaterThan(SCENES.length * 3);

      const images = files.slice(0, -1);
      expect(images.every((file) => file.type === 'image/jpeg')).toBe(true);
      expect(new Set(images.map((file) => file.name)).size).toBe(images.length);
      for (let i = 1; i < images.length; i += 1) {
        expect(images[i].lastModified).toBeGreaterThan(images[i - 1].lastModified);
      }

      const doc = files[files.length - 1];
      expect(doc.name.endsWith('.txt')).toBe(true);
      expect(await doc.text()).toContain(DEMO_TEXT_BLOCKS[0]);
    } finally {
      globals.OffscreenCanvas = previous;
    }
  });
});
