import * as db from './db';
import { getBlob, getThumb, putBlob, putThumb } from './media';
import { useProject } from './useProject';

const SAVE_DEBOUNCE_MS = 900;

/** Asset ids whose pixels are already in IndexedDB for `projectId`. */
let persisted = new Set<string>();
let projectId = '';
let saving = false;
let quotaWarned = false;

/**
 * Autosaves the current project after edits settle. Blobs are written once per
 * asset; the document is rewritten on every flush (it is small).
 */
export function startAutosave(): () => void {
  if (!db.persistenceAvailable()) return () => {};
  let timer = 0;
  const unsubscribe = useProject.subscribe((state) => {
    if (state.status !== 'ready') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  });
  return () => {
    window.clearTimeout(timer);
    unsubscribe();
  };
}

async function flush(): Promise<void> {
  if (saving) return;
  const state = useProject.getState();
  if (state.status !== 'ready') return;
  if (state.id !== projectId) {
    projectId = state.id;
    persisted = new Set();
  }
  saving = true;
  try {
    const live = new Set(state.assets.map((asset) => asset.id));
    const pending = state.assets
      .filter((asset) => asset.kind === 'image' && !persisted.has(asset.id))
      .map((asset) => ({ assetId: asset.id, blob: getBlob(asset.id), thumb: getThumb(asset.id) }))
      .filter((item) => item.blob || item.thumb);
    await db.savePixels(state.id, pending);
    for (const item of pending) persisted.add(item.assetId);

    const orphans = [...persisted].filter((id) => !live.has(id));
    if (orphans.length) {
      await db.deletePixels(state.id, orphans);
      for (const id of orphans) persisted.delete(id);
    }

    await db.saveProject({
      id: state.id,
      name: state.name,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      assetCount: state.assets.length,
      pageCount: state.pages.length,
      book: {
        pageSpec: state.pageSpec,
        grouping: state.grouping,
        style: state.style,
        assets: state.assets,
        groups: state.groups,
        pages: state.pages,
      },
    });
  } catch (error) {
    if (!quotaWarned) {
      quotaWarned = true;
      useProject.getState().setToast(`本地保存失败：${(error as Error).message ?? '存储不可用'}`);
    }
  } finally {
    saving = false;
  }
}

/** Rehydrates the media registry and the store from a stored project. */
export async function restoreProject(id: string): Promise<boolean> {
  if (!db.persistenceAvailable()) return false;
  const loaded = await db.loadProject(id);
  if (!loaded) return false;
  for (const item of loaded.pixels) {
    if (item.blob) putBlob(item.assetId, item.blob);
    if (item.thumb) putThumb(item.assetId, item.thumb);
  }
  projectId = loaded.record.id;
  persisted = new Set(loaded.pixels.map((item) => item.assetId));
  useProject.getState().hydrate(loaded.record.book, {
    id: loaded.record.id,
    name: loaded.record.name,
    createdAt: loaded.record.createdAt,
  });
  return true;
}

export async function listProjects(): Promise<db.ProjectSummary[]> {
  if (!db.persistenceAvailable()) return [];
  try {
    return await db.listProjects();
  } catch {
    return [];
  }
}

export async function dropProject(id: string): Promise<void> {
  if (!db.persistenceAvailable()) return;
  await db.deleteProject(id);
  if (projectId === id) {
    projectId = '';
    persisted = new Set();
  }
}

/**
 * Deletes every locally stored project. Callers should reset the live store
 * first so the pending autosave has nothing left to write back.
 */
export async function clearAllProjects(): Promise<void> {
  if (!db.persistenceAvailable()) return;
  await db.clearAll();
  projectId = '';
  persisted = new Set();
  quotaWarned = false;
}
