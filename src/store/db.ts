import type { BookState } from './commands';

/**
 * Minimal IndexedDB layer. Project documents (state) and pixels (blobs) are
 * stored separately so a project can be listed without loading megabytes.
 */
const DB_NAME = 'autobook';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'blobs';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  book: BookState;
  /** Denormalised for the restore list. */
  assetCount: number;
  pageCount: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  assetCount: number;
  pageCount: number;
}

export interface StoredPixels {
  assetId: string;
  blob?: Blob;
  thumb?: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pixelKey(projectId: string, assetId: string): string {
  return `${projectId}:${assetId}`;
}

/** Available in browsers only; tests and SSR skip persistence entirely. */
export function persistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  tx.objectStore(STORE_PROJECTS).put(record);
  await done(tx);
}

export async function savePixels(
  projectId: string,
  items: { assetId: string; blob?: Blob; thumb?: Blob }[],
): Promise<void> {
  if (items.length === 0) return;
  const db = await open();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  const store = tx.objectStore(STORE_BLOBS);
  for (const item of items) {
    store.put({
      key: pixelKey(projectId, item.assetId),
      projectId,
      assetId: item.assetId,
      blob: item.blob,
      thumb: item.thumb,
    });
  }
  await done(tx);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await open();
  const tx = db.transaction(STORE_PROJECTS, 'readonly');
  const all = await request(tx.objectStore(STORE_PROJECTS).getAll() as IDBRequest<ProjectRecord[]>);
  return all
    .map(({ id, name, createdAt, updatedAt, assetCount, pageCount }) => ({
      id,
      name,
      createdAt,
      updatedAt,
      assetCount,
      pageCount,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(
  id: string,
): Promise<{ record: ProjectRecord; pixels: StoredPixels[] } | undefined> {
  const db = await open();
  const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readonly');
  const record = await request(
    tx.objectStore(STORE_PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>,
  );
  if (!record) return undefined;
  const rows = await request(
    tx.objectStore(STORE_BLOBS).getAll() as IDBRequest<
      { projectId: string; assetId: string; blob?: Blob; thumb?: Blob }[]
    >,
  );
  const pixels = rows
    .filter((row) => row.projectId === id)
    .map(({ assetId, blob, thumb }) => ({ assetId, blob, thumb }));
  return { record, pixels };
}

export async function deleteProject(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readwrite');
  tx.objectStore(STORE_PROJECTS).delete(id);
  const blobs = tx.objectStore(STORE_BLOBS);
  const keys = await request(blobs.getAllKeys() as IDBRequest<IDBValidKey[]>);
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith(`${id}:`)) blobs.delete(key);
  }
  await done(tx);
}

export async function deletePixels(projectId: string, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const db = await open();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  const store = tx.objectStore(STORE_BLOBS);
  for (const assetId of assetIds) store.delete(pixelKey(projectId, assetId));
  await done(tx);
}

/** Wipes every stored project and its pixels. Used by "清除本地缓存". */
export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction([STORE_PROJECTS, STORE_BLOBS], 'readwrite');
  tx.objectStore(STORE_PROJECTS).clear();
  tx.objectStore(STORE_BLOBS).clear();
  await done(tx);
}
