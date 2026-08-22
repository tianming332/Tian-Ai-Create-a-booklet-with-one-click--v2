import { create } from 'zustand';
import { AnalyzerPool } from '../engine/analysis/pool';
import { analyzeTexts } from '../engine/analysis/text';
import { defaultGroupingSettings, defaultPageSpec, PARAMS } from '../shared/constants';
import { makeId } from '../shared/ids';
import type { AssetError, Focus, GroupingSettings, LayoutFrame, PageSpec } from '../shared/types';
import { defaultStyle, type BookStyle } from '../engine/layout/bookStyle';
import type { PreviewOverlays } from '../render/preview';
import * as cmd from './commands';
import type { BookState } from './commands';
import { importFiles, textAsset } from './importFiles';
import { getBlob, putThumb, releaseAll } from './media';

export type ProjectStatus = 'empty' | 'importing' | 'analyzing' | 'ready';

export interface Selection {
  pageId?: string;
  frameId?: string;
  assetId?: string;
}

export interface ViewState {
  /**
   * The three screens of the flow: pick a template, look at the finished book,
   * or tune it page by page. Both flows start at 'compose'.
   */
  stage: 'compose' | 'preview' | 'edit';
  /** Index of the left page of the visible spread; 0 shows the cover alone. */
  spreadIndex: number;
  zoom: number;
  overlays: PreviewOverlays;
  selection: Selection;
  settingsOpen: boolean;
}

export interface Progress {
  done: number;
  total: number;
  label: string;
}

export interface ProjectStore extends BookState {
  id: string;
  name: string;
  /** Always resolved in the live store, unlike the persisted book. */
  style: BookStyle;
  createdAt: number;
  updatedAt: number;
  errors: AssetError[];
  status: ProjectStatus;
  progress: Progress | null;
  past: BookState[];
  future: BookState[];
  view: ViewState;
  toast: string | null;

  addFiles: (files: File[]) => Promise<void>;
  addText: (text: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** Coalesces a burst of edits (e.g. a focus drag) into one undo step. */
  beginTransient: () => void;
  endTransient: () => void;
  reset: () => void;
  hydrate: (book: BookState, meta: { id: string; name: string; createdAt: number }) => void;
  setToast: (message: string | null) => void;

  setPageTemplate: (pageId: string, templateId: string) => void;
  splitSpread: (pageId: string) => void;
  setFrameFocus: (pageId: string, frameId: string, focus: Focus) => void;
  setFrameFit: (pageId: string, frameId: string, fit: LayoutFrame['fit']) => void;
  setFrameText: (pageId: string, frameId: string, text: string) => void;
  setFrameAsset: (pageId: string, frameId: string, assetId: string) => void;
  swapFrames: (
    a: { pageId: string; frameId: string },
    b: { pageId: string; frameId: string },
  ) => void;
  togglePageLock: (pageId: string) => void;
  movePage: (pageId: string, toIndex: number) => void;
  deletePage: (pageId: string) => void;
  insertBlankPage: (afterIndex: number) => void;
  removeAssets: (assetIds: string[]) => void;
  reorderAsset: (assetId: string, toIndex: number) => void;
  setAssetText: (assetId: string, text: string) => void;
  bindCaption: (textAssetId: string, imageAssetId: string | undefined) => void;
  setPageSpec: (patch: Partial<PageSpec>) => void;
  setGrouping: (patch: Partial<GroupingSettings>) => void;

  select: (selection: Selection) => void;
  setStage: (stage: ViewState['stage']) => void;
  /** Lays the whole book out with the style, then shows preview or editor. */
  applyStyle: (
    style: BookStyle,
    target?: ViewState['stage'],
    override?: Partial<PageSpec>,
  ) => void;
  showSpread: (index: number) => void;
  setZoom: (zoom: number) => void;
  toggleOverlay: (key: keyof PreviewOverlays) => void;
  setSettingsOpen: (open: boolean) => void;
}

function emptyBook(): BookState & { style: BookStyle } {
  const style = defaultStyle();
  return {
    pageSpec: defaultPageSpec('A4'),
    grouping: defaultGroupingSettings(),
    style,
    assets: [],
    groups: [],
    pages: [],
  };
}

function snapshot(state: ProjectStore): BookState {
  return {
    pageSpec: state.pageSpec,
    grouping: state.grouping,
    style: state.style,
    assets: state.assets,
    groups: state.groups,
    pages: state.pages,
  };
}

const initialView: ViewState = {
  stage: 'preview',
  spreadIndex: 0,
  zoom: 1,
  overlays: { bleed: false, safeArea: false, frames: false },
  selection: {},
  settingsOpen: false,
};

export const useProject = create<ProjectStore>()((set, get) => {
  /** While true, edits mutate the current undo step instead of adding one. */
  let transient = false;

  /** Applies a pure book transform with undo bookkeeping. */
  const apply = (fn: (book: BookState) => BookState) => {
    const state = get();
    const before = snapshot(state);
    const after = fn(before);
    if (after === before) return;
    if (transient) {
      set({ ...after, updatedAt: Date.now() });
      return;
    }
    set({
      ...after,
      past: [...state.past, before].slice(-PARAMS.undoDepth),
      future: [],
      updatedAt: Date.now(),
    });
  };

  return {
    id: makeId('prj'),
    name: '未命名相册',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    errors: [],
    status: 'empty',
    progress: null,
    past: [],
    future: [],
    view: initialView,
    toast: null,
    ...emptyBook(),

    addFiles: async (files) => {
      const state = get();
      const first = state.pages.length === 0;
      set({ status: 'importing', progress: { done: 0, total: files.length, label: '读取文件' } });
      const result = await importFiles(files, state.assets.length, state.assets.length);
      const errors = [...state.errors, ...result.errors];
      if (result.capped) {
        errors.push({
          fileName: '',
          reason: `一次最多导入 ${PARAMS.hardMaxAssets} 个素材，超出的已忽略`,
          level: 'assetError',
        });
      }
      const assets = [...state.assets, ...result.assets];
      set({ assets, errors });
      await runAnalysis(set, get);
      // The first import always lands on the template picker: both flows start there.
      if (first) set({ view: { ...get().view, stage: 'compose' } });
    },

    addText: async (text) => {
      const state = get();
      const first = state.pages.length === 0;
      const asset = textAsset(text, state.assets.length);
      set({ assets: [...state.assets, asset] });
      await runAnalysis(set, get);
      if (first) set({ view: { ...get().view, stage: 'compose' } });
    },

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return;
      set({
        ...previous,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, PARAMS.undoDepth),
        updatedAt: Date.now(),
      });
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;
      set({
        ...next,
        past: [...state.past, snapshot(state)].slice(-PARAMS.undoDepth),
        future: state.future.slice(1),
        updatedAt: Date.now(),
      });
    },

    beginTransient: () => {
      if (transient) return;
      const state = get();
      transient = true;
      set({
        past: [...state.past, snapshot(state)].slice(-PARAMS.undoDepth),
        future: [],
      });
    },

    endTransient: () => {
      transient = false;
    },

    reset: () => {
      releaseAll();
      set({
        id: makeId('prj'),
        name: '未命名相册',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        errors: [],
        status: 'empty',
        progress: null,
        past: [],
        future: [],
        view: initialView,
        toast: null,
        ...emptyBook(),
      });
    },

    hydrate: (book, meta) => {
      set({
        ...book,
        style: book.style ?? defaultStyle(),
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: Date.now(),
        past: [],
        future: [],
        errors: [],
        progress: null,
        status: book.pages.length ? 'ready' : 'empty',
        view: initialView,
      });
    },

    setToast: (message) => set({ toast: message }),

    setPageTemplate: (pageId, templateId) =>
      apply((book) => cmd.setPageTemplate(book, pageId, templateId)),
    splitSpread: (pageId) => apply((book) => cmd.splitSpread(book, pageId)),
    setFrameFocus: (pageId, frameId, focus) =>
      apply((book) => cmd.setFrameFocus(book, pageId, frameId, focus)),
    setFrameFit: (pageId, frameId, fit) =>
      apply((book) => cmd.setFrameFit(book, pageId, frameId, fit)),
    setFrameText: (pageId, frameId, text) =>
      apply((book) => cmd.setFrameText(book, pageId, frameId, text)),
    setFrameAsset: (pageId, frameId, assetId) =>
      apply((book) => cmd.setFrameAsset(book, pageId, frameId, assetId)),
    swapFrames: (a, b) => apply((book) => cmd.swapFrames(book, a, b)),
    togglePageLock: (pageId) => apply((book) => cmd.togglePageLock(book, pageId)),
    movePage: (pageId, toIndex) => apply((book) => cmd.movePage(book, pageId, toIndex)),
    deletePage: (pageId) => apply((book) => cmd.deletePage(book, pageId)),
    insertBlankPage: (afterIndex) => apply((book) => cmd.insertBlankPage(book, afterIndex)),
    removeAssets: (assetIds) => apply((book) => cmd.removeAssets(book, assetIds)),
    reorderAsset: (assetId, toIndex) => apply((book) => cmd.reorderAsset(book, assetId, toIndex)),
    setAssetText: (assetId, text) => apply((book) => cmd.setAssetText(book, assetId, text)),
    bindCaption: (textAssetId, imageAssetId) =>
      apply((book) =>
        cmd.regenerate({
          ...book,
          assets: book.assets.map((a) =>
            a.id === textAssetId ? { ...a, boundToAssetId: imageAssetId } : a,
          ),
        }),
      ),
    setPageSpec: (patch) => apply((book) => cmd.setPageSpec(book, patch)),
    setGrouping: (patch) => apply((book) => cmd.setGrouping(book, patch)),

    select: (selection) => set({ view: { ...get().view, selection } }),
    setStage: (stage) => set({ view: { ...get().view, stage } }),
    applyStyle: (style, target = 'preview', override) => {
      apply((book) => cmd.applyStyle(book, style, override));
      set({ view: { ...get().view, stage: target, spreadIndex: 0, selection: {} } });
    },
    showSpread: (index) => set({ view: { ...get().view, spreadIndex: Math.max(0, index) } }),
    setZoom: (zoom) => set({ view: { ...get().view, zoom: Math.max(0.25, Math.min(3, zoom)) } }),
    toggleOverlay: (key) => {
      const view = get().view;
      set({ view: { ...view, overlays: { ...view.overlays, [key]: !view.overlays[key] } } });
    },
    setSettingsOpen: (open) => set({ view: { ...get().view, settingsOpen: open } }),
  };
});

type Setter = (partial: Partial<ProjectStore>) => void;

/**
 * Analyses every pending asset, then rebuilds the book. Image work runs in
 * workers; text work is cheap and stays on the main thread.
 */
async function runAnalysis(set: Setter, get: () => ProjectStore): Promise<void> {
  const pendingImages = get().assets.filter((a) => a.kind === 'image' && a.analysisStatus !== 'done');
  const total = pendingImages.length;
  set({ status: 'analyzing', progress: { done: 0, total, label: '分析素材' } });

  if (total > 0) {
    const pool = new AnalyzerPool();
    const jobs = pendingImages
      .map((asset) => ({ id: asset.id, blob: getBlob(asset.id) }))
      .filter((job): job is { id: string; blob: Blob } => Boolean(job.blob));
    const outcomes = await pool.run(jobs, (done) => {
      set({ progress: { done, total, label: '分析素材' } });
    });
    const byId = new Map(outcomes.map((o) => [o.id, o]));
    const assets = get().assets.map((asset) => {
      const outcome = byId.get(asset.id);
      if (!outcome) return asset;
      if (outcome.error || !outcome.visual) {
        return { ...asset, analysisStatus: 'error' as const, warnings: [outcome.error ?? '解码失败'] };
      }
      if (outcome.thumb) putThumb(asset.id, outcome.thumb);
      return {
        ...asset,
        visual: outcome.visual,
        thumbKey: outcome.thumb ? asset.id : undefined,
        analysisStatus: 'done' as const,
        warnings: outcome.warnings,
        meta: {
          ...asset.meta,
          widthPx: outcome.visual.widthPx,
          heightPx: outcome.visual.heightPx,
        },
      };
    });
    set({ assets });
  }

  const texts = get().assets.filter((a) => a.kind === 'text');
  if (texts.length) {
    const features = analyzeTexts(texts.map((a) => a.text ?? ''));
    const featureById = new Map(texts.map((asset, i) => [asset.id, features[i]]));
    set({
      assets: get().assets.map((asset) => {
        const f = featureById.get(asset.id);
        return f ? { ...asset, textFeatures: f, analysisStatus: 'done' as const } : asset;
      }),
    });
  }

  set({ progress: { done: total, total, label: '排版' } });
  const book = cmd.regenerate({
    pageSpec: get().pageSpec,
    grouping: get().grouping,
    style: get().style,
    assets: get().assets,
    groups: get().groups,
    pages: get().pages,
  });
  const failed = book.assets.filter((a) => a.analysisStatus === 'error');
  set({
    ...book,
    status: 'ready',
    progress: null,
    past: [],
    future: [],
    errors: [
      ...get().errors,
      ...failed.map((asset) => ({
        fileName: asset.meta.fileName ?? asset.id,
        reason: asset.warnings[0] ?? '分析失败',
        level: 'assetError' as const,
      })),
    ],
  });
}
