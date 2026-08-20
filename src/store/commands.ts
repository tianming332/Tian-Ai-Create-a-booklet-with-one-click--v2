import { groupAssets, markNearDuplicates, mergeGroups, splitGroup } from '../engine/grouping/group';
import { generatePages, pageNumberFrame, sideForIndex } from '../engine/layout/generate';
import {
  groupingForStyle,
  specForStyle,
  type BookStyle,
} from '../engine/layout/bookStyle';
import { frameGap, TEMPLATES, templateById } from '../engine/layout/templates';
import type { TemplateContext } from '../engine/layout/types';
import { makeId } from '../shared/ids';
import type {
  Asset,
  Focus,
  Group,
  GroupingSettings,
  LayoutFrame,
  Page,
  PageSpec,
} from '../shared/types';

/** The part of a project that edits and undo/redo operate on. */
export interface BookState {
  pageSpec: PageSpec;
  grouping: GroupingSettings;
  /** Resolved style, stored inline so a saved project is self-contained. */
  style?: BookStyle;
  assets: Asset[];
  groups: Group[];
  pages: Page[];
}

function byId(assets: Asset[]): Map<string, Asset> {
  return new Map(assets.map((a) => [a.id, a]));
}

/** Full re-run of grouping + pagination. Used after any structural change. */
export function regenerate(state: BookState): BookState {
  const assets = state.assets.map((a) => ({ ...a }));
  markNearDuplicates(assets);
  const groups = groupAssets(assets, state.grouping);
  const pages = generatePages({ spec: state.pageSpec, assets, groups, style: state.style });
  return { ...state, assets, groups, pages };
}

/**
 * Switches the book style: geometry + grouping preferences, then a full re-run.
 * `override` wins over the style's own geometry — that is how the open format
 * picked on the template screen survives the style it is combined with.
 */
export function applyStyle(
  state: BookState,
  style: BookStyle,
  override: Partial<PageSpec> = {},
): BookState {
  return regenerate({
    ...state,
    style,
    pageSpec: { ...specForStyle(style, state.pageSpec), ...override },
    grouping: groupingForStyle(style, state.grouping),
  });
}

/** Reassigns indexes, page-number frames and gutter sides after a reorder. */
export function reindexPages(pages: Page[], spec: PageSpec): Page[] {
  return pages.map((page, index) => {
    const side = sideForIndex(index);
    const frames = page.frames.filter((f) => f.textRole !== 'pageNumber');
    if (spec.showPageNumbers && index > 0 && !page.isBlank) {
      frames.push(pageNumberFrame(spec, side, index));
    }
    return { ...page, index, frames };
  });
}

export function ensureEvenPages(pages: Page[]): Page[] {
  if (pages.length % 2 === 0) return pages;
  return [
    ...pages,
    {
      id: makeId('pg'),
      index: pages.length,
      templateId: 'blank',
      density: 1 as const,
      frames: [],
      locked: false,
      isBlank: true,
    },
  ];
}

function normalize(state: BookState, pages: Page[]): BookState {
  return { ...state, pages: reindexPages(ensureEvenPages(pages), state.pageSpec) };
}

function replacePage(state: BookState, pageId: string, next: Page): BookState {
  return { ...state, pages: state.pages.map((p) => (p.id === pageId ? next : p)) };
}

export function partnerOf(pages: Page[], page: Page): Page | undefined {
  if (page.spreadPartnerOf) return pages.find((p) => p.id === page.spreadPartnerOf);
  return pages.find((p) => p.spreadPartnerOf === page.id);
}

/** Assets currently placed on a page, in frame order. */
export function pageAssets(page: Page, assets: Map<string, Asset>): { images: Asset[]; texts: Asset[] } {
  const images: Asset[] = [];
  const texts: Asset[] = [];
  for (const frame of page.frames) {
    if (frame.textRole === 'pageNumber' || !frame.assetId) continue;
    const asset = assets.get(frame.assetId);
    if (!asset) continue;
    if (frame.kind === 'image') images.push(asset);
    else texts.push(asset);
  }
  return { images, texts };
}

function contextForPage(state: BookState, page: Page, maxImages: number): TemplateContext {
  const { images, texts } = pageAssets(page, byId(state.assets));
  const chapterFrame = page.frames.find((f) => f.textRole === 'chapterTitle');
  return {
    spec: state.pageSpec,
    side: sideForIndex(page.index),
    images: images.slice(0, maxImages),
    texts,
    gap: frameGap(state.pageSpec),
    pageIndex: page.index,
    chapterTitle: chapterFrame?.textOverride,
  };
}

/** Template ids that can host exactly the assets already on the page. */
export function templateAlternatives(state: BookState, pageId: string): string[] {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page || page.isBlank) return [];
  const isSpread = Boolean(page.spreadPartnerOf) || Boolean(partnerOf(state.pages, page));
  const { images, texts } = pageAssets(page, byId(state.assets));
  const ids: string[] = [];
  for (const def of TEMPLATES) {
    if (Boolean(def.spread) !== isSpread) continue;
    if (images.length < def.minImages || images.length > def.maxImages) continue;
    if (texts.length > def.maxTexts) continue;
    const ctx = contextForPage(state, page, def.maxImages);
    if (!def.accepts(ctx)) continue;
    ids.push(def.id);
  }
  return ids;
}

/** Rebuilds a page (and its spread partner) with another template. */
export function setPageTemplate(state: BookState, pageId: string, templateId: string): BookState {
  const page = state.pages.find((p) => p.id === pageId);
  const def = templateById(templateId);
  if (!page || !def) return state;
  const partner = partnerOf(state.pages, page);
  const primary = page.spreadPartnerOf && partner ? partner : page;
  const secondary = primary === page ? partner : page;

  const rebuild = (target: Page): Page => ({
    ...target,
    templateId: def.id,
    density: def.density,
    frames: def.build(contextForPage(state, target, def.maxImages)),
  });

  let pages = state.pages.map((p) => (p.id === primary.id ? rebuild(primary) : p));
  if (secondary && def.spread) {
    pages = pages.map((p) => (p.id === secondary.id ? rebuild(secondary) : p));
  }
  return normalize(state, pages);
}

/** Turns a spread back into a single full-bleed page plus one blank page. */
export function splitSpread(state: BookState, pageId: string): BookState {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return state;
  const partner = partnerOf(state.pages, page);
  if (!partner) return state;
  const left = page.spreadPartnerOf ? partner : page;
  const right = left === page ? partner : page;
  const def = templateById('T01')!;
  const rebuilt: Page = {
    ...left,
    templateId: def.id,
    density: def.density,
    spreadPartnerOf: undefined,
    frames: def.build(contextForPage(state, left, def.maxImages)),
  };
  const pages = state.pages
    .filter((p) => p.id !== right.id)
    .map((p) => (p.id === left.id ? rebuilt : p));
  return normalize(state, pages);
}

export function setFrameFocus(
  state: BookState,
  pageId: string,
  frameId: string,
  focus: Focus,
): BookState {
  return mapFrame(state, pageId, frameId, (frame) => ({ ...frame, focus }));
}

export function setFrameFit(
  state: BookState,
  pageId: string,
  frameId: string,
  fit: LayoutFrame['fit'],
): BookState {
  return mapFrame(state, pageId, frameId, (frame) => ({ ...frame, fit }));
}

export function setFrameText(
  state: BookState,
  pageId: string,
  frameId: string,
  text: string,
): BookState {
  return mapFrame(state, pageId, frameId, (frame) => ({ ...frame, textOverride: text }));
}

export function setFrameAsset(
  state: BookState,
  pageId: string,
  frameId: string,
  assetId: string,
): BookState {
  return mapFrame(state, pageId, frameId, (frame) => ({
    ...frame,
    assetId,
    focus: { x: 0.5, y: 0.5 },
  }));
}

function mapFrame(
  state: BookState,
  pageId: string,
  frameId: string,
  fn: (frame: LayoutFrame) => LayoutFrame,
): BookState {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return state;
  return replacePage(state, pageId, {
    ...page,
    frames: page.frames.map((f) => (f.id === frameId ? fn(f) : f)),
  });
}

/** Swaps the images of two frames, possibly on different pages. */
export function swapFrames(
  state: BookState,
  a: { pageId: string; frameId: string },
  b: { pageId: string; frameId: string },
): BookState {
  const pageA = state.pages.find((p) => p.id === a.pageId);
  const pageB = state.pages.find((p) => p.id === b.pageId);
  if (!pageA || !pageB) return state;
  const frameA = pageA.frames.find((f) => f.id === a.frameId);
  const frameB = pageB.frames.find((f) => f.id === b.frameId);
  if (!frameA || !frameB || frameA.kind !== frameB.kind) return state;
  const assetA = frameA.assetId;
  const assetB = frameB.assetId;
  const pages = state.pages.map((page) => {
    if (page.id !== pageA.id && page.id !== pageB.id) return page;
    return {
      ...page,
      frames: page.frames.map((frame) => {
        if (frame.id === frameA.id) return { ...frame, assetId: assetB, focus: { x: 0.5, y: 0.5 } };
        if (frame.id === frameB.id) return { ...frame, assetId: assetA, focus: { x: 0.5, y: 0.5 } };
        return frame;
      }),
    };
  });
  return { ...state, pages };
}

export function togglePageLock(state: BookState, pageId: string): BookState {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return state;
  return replacePage(state, pageId, { ...page, locked: !page.locked });
}

/** Moves a page; spread halves move together and never split. */
export function movePage(state: BookState, pageId: string, toIndex: number): BookState {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page || page.index === 0) return state;
  const partner = partnerOf(state.pages, page);
  const moving = partner ? [page, partner].sort((x, y) => x.index - y.index) : [page];
  const rest = state.pages.filter((p) => !moving.includes(p));
  const target = Math.max(1, Math.min(rest.length, toIndex));
  const pages = [...rest.slice(0, target), ...moving, ...rest.slice(target)];
  return normalize(state, pages);
}

export function deletePage(state: BookState, pageId: string): BookState {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page || page.index === 0) return state;
  const partner = partnerOf(state.pages, page);
  const drop = new Set([page.id, partner?.id]);
  return normalize(
    state,
    state.pages.filter((p) => !drop.has(p.id)),
  );
}

export function insertBlankPage(state: BookState, afterIndex: number): BookState {
  const blank: Page = {
    id: makeId('pg'),
    index: afterIndex + 1,
    templateId: 'blank',
    density: 1,
    frames: [],
    locked: false,
    isBlank: true,
  };
  const pages = [...state.pages];
  pages.splice(afterIndex + 1, 0, blank);
  return normalize(state, pages);
}

/** Removes an asset from the book and re-runs pagination. */
export function removeAssets(state: BookState, assetIds: string[]): BookState {
  const drop = new Set(assetIds);
  const assets = state.assets
    .filter((a) => !drop.has(a.id))
    .map((a) => (a.boundToAssetId && drop.has(a.boundToAssetId) ? { ...a, boundToAssetId: undefined } : a));
  return regenerate({ ...state, assets });
}

/** Manual asset ordering: rewrites importIndex and switches to original order. */
export function reorderAsset(state: BookState, assetId: string, toIndex: number): BookState {
  const ordered = [...state.assets].sort((a, b) => a.importIndex - b.importIndex);
  const from = ordered.findIndex((a) => a.id === assetId);
  if (from < 0) return state;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(Math.max(0, Math.min(ordered.length, toIndex)), 0, moved);
  const assets = ordered.map((asset, index) => ({ ...asset, importIndex: index }));
  return regenerate({ ...state, assets, grouping: { ...state.grouping, orderMode: 'original' } });
}

export function setAssetText(state: BookState, assetId: string, text: string): BookState {
  const assets = state.assets.map((a) => (a.id === assetId ? { ...a, text } : a));
  const pages = state.pages.map((page) => ({
    ...page,
    frames: page.frames.map((frame) =>
      frame.assetId === assetId && frame.kind === 'text'
        ? { ...frame, textOverride: undefined }
        : frame,
    ),
  }));
  return { ...state, assets, pages };
}

export function setPageSpec(state: BookState, patch: Partial<PageSpec>): BookState {
  return regenerate({ ...state, pageSpec: { ...state.pageSpec, ...patch } });
}

export function setGrouping(state: BookState, patch: Partial<GroupingSettings>): BookState {
  return regenerate({ ...state, grouping: { ...state.grouping, ...patch } });
}

export function mergeWithNext(state: BookState, groupId: string): BookState {
  const at = state.groups.findIndex((g) => g.id === groupId);
  if (at < 0 || at + 1 >= state.groups.length) return state;
  const groups = mergeGroups(state.groups, groupId, state.groups[at + 1].id);
  return {
    ...state,
    groups,
    pages: generatePages({ spec: state.pageSpec, assets: state.assets, groups, style: state.style }),
  };
}

export function splitGroupAt(state: BookState, groupId: string, atIndex: number): BookState {
  const groups = splitGroup(state.groups, groupId, atIndex);
  return {
    ...state,
    groups,
    pages: generatePages({ spec: state.pageSpec, assets: state.assets, groups, style: state.style }),
  };
}
