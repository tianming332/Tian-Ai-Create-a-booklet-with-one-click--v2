import { PARAMS } from '../shared/constants';
import { makeId } from '../shared/ids';
import type { Asset, AssetError } from '../shared/types';
import { readExif } from '../engine/analysis/exif';
import { parseTextDocument } from '../engine/text/structure';
import { putBlob } from './media';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

const TEXT_PATTERN = /\.(txt|md|markdown)$/i;

export interface ImportResult {
  assets: Asset[];
  errors: AssetError[];
  /** True when the import was cut short by the hard asset cap. */
  capped: boolean;
}

function isImage(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name);
}

/** Splits a pasted or uploaded text document into paragraph-sized assets. */
export function splitTextBlocks(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Validates and ingests dropped files. Images are stored as blobs and tagged
 * with EXIF time; text documents become one asset per paragraph.
 * Nothing is uploaded — every step runs in the page.
 */
export async function importFiles(
  files: File[],
  startIndex: number,
  existingCount: number,
): Promise<ImportResult> {
  const assets: Asset[] = [];
  const errors: AssetError[] = [];
  let index = startIndex;
  let capped = false;

  for (const file of files) {
    if (existingCount + assets.length >= PARAMS.hardMaxAssets) {
      capped = true;
      break;
    }
    if (isImage(file)) {
      if (file.size > PARAMS.maxFileBytes) {
        errors.push({
          fileName: file.name,
          reason: `文件超过 ${Math.round(PARAMS.maxFileBytes / 1024 / 1024)}MB 上限`,
          level: 'assetError',
        });
        continue;
      }
      const exif = await readExif(file);
      const asset: Asset = {
        id: makeId('ast'),
        kind: 'image',
        importIndex: index,
        meta: {
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          byteSize: file.size,
          takenAt: exif.takenAt,
          takenAtSource: exif.takenAtSource,
          exifOrientation: exif.orientation,
        },
        blobKey: '',
        analysisStatus: 'pending',
        warnings: [],
      };
      asset.blobKey = asset.id;
      putBlob(asset.id, file);
      assets.push(asset);
      index += 1;
      continue;
    }

    if (TEXT_PATTERN.test(file.name) || file.type.startsWith('text/')) {
      const raw = await file.text();
      const textAssets = textAssetsFromRaw(raw, index, file.name);
      if (textAssets.length === 0) {
        errors.push({ fileName: file.name, reason: '文本内容为空', level: 'assetError' });
        continue;
      }
      for (const asset of textAssets) {
        if (existingCount + assets.length >= PARAMS.hardMaxAssets) {
          capped = true;
          break;
        }
        assets.push(asset);
        index += 1;
      }
      continue;
    }

    errors.push({
      fileName: file.name,
      reason: '不支持的格式，仅支持 JPG/PNG/WebP/HEIC 与 TXT/Markdown',
      level: 'assetError',
    });
  }

  return { assets, errors, capped };
}

/** Creates one compatible Asset per semantic block while retaining a shared
 * document id. This lets the existing paginator place every long-form fragment. */
export function textAssetsFromRaw(raw: string, startIndex: number, fileName?: string): Asset[] {
  const document = parseTextDocument(raw);
  return document.blocks.map((block, offset) =>
    textAsset(block.text, startIndex + offset, fileName, block, document.id),
  );
}

export function textAsset(
  text: string,
  importIndex: number,
  fileName?: string,
  block?: Asset['textBlock'],
  sourceDocumentId?: string,
): Asset {
  const document = block ? undefined : parseTextDocument(text);
  const parsed = block ?? document?.blocks[0];
  return {
    id: makeId('ast'),
    kind: 'text',
    importIndex,
    meta: { fileName, mimeType: 'text/plain', byteSize: text.length },
    text,
    textBlock: parsed,
    sourceDocumentId: sourceDocumentId ?? document?.id,
    analysisStatus: 'pending',
    warnings: [],
  };
}
