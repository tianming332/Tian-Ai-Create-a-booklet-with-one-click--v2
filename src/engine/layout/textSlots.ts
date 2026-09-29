import type { Asset, LayoutFrame, PageSpec, TextBlockRole, TextRole } from '../../shared/types';
import type { Rect } from '../../shared/geometry';
import type { AssignedTextSlot, TextSlotDefinition } from './types';
import { makeId } from '../../shared/ids';
import { textBlockHeight } from './style';

export const STRUCTURED_TEXT_SLOTS: TextSlotDefinition[] = [
  // A manually bound caption stays closest to its image. In mixed image/text
  // families this slot is therefore laid out before document-level metadata.
  { id: 'caption', accepts: ['caption'], maxBlocks: 3, maxChars: 320, typography: 'caption', overflow: 'shrink' },
  { id: 'meta', accepts: ['metadata'], maxBlocks: 2, maxChars: 60, typography: 'caption', overflow: 'switchTemplate' },
  { id: 'title', accepts: ['heading1', 'heading2', 'heading3'], maxBlocks: 1, maxChars: 56, typography: 'chapterTitle', overflow: 'switchTemplate' },
  { id: 'lead', accepts: ['lead', 'quote', 'shortSentence'], maxBlocks: 1, maxChars: 180, typography: 'sentence', overflow: 'shrink' },
  { id: 'body', accepts: ['body'], maxBlocks: 3, typography: 'body', overflow: 'continue' },
  { id: 'credit', accepts: ['credit'], maxBlocks: 1, maxChars: 40, typography: 'caption', align: 'right', overflow: 'switchTemplate' },
];

const fallbackRole = (asset: Asset): TextBlockRole => {
  const cls = asset.textFeatures?.lengthClass;
  return cls === 'label' || cls === 'short' ? 'shortSentence' : 'body';
};

export function blockRole(asset: Asset): TextBlockRole {
  return asset.textBlock?.role ?? fallbackRole(asset);
}

/** Deterministic role-aware assignment. Every asset is used at most once. */
export function assignTextSlots(texts: Asset[], definitions: TextSlotDefinition[]): AssignedTextSlot[] {
  const unused = new Set(texts);
  return definitions.map((definition) => {
    const assets: Asset[] = [];
    for (const asset of texts) {
      if (!unused.has(asset) || !definition.accepts.includes(blockRole(asset))) continue;
      const chars = assets.reduce((sum, item) => sum + [...(item.text ?? '')].length, 0);
      if (definition.maxChars && chars + [...(asset.text ?? '')].length > definition.maxChars && assets.length) continue;
      assets.push(asset);
      unused.delete(asset);
      if (assets.length >= definition.maxBlocks) break;
    }
    return { definition, assets };
  });
}

export function slotCoverage(texts: Asset[], definitions: TextSlotDefinition[]): number {
  if (!texts.length) return 1;
  const assigned = assignTextSlots(texts, definitions).reduce((sum, slot) => sum + slot.assets.length, 0);
  return assigned / texts.length;
}

function preferredLines(role: TextRole, asset: Asset): number {
  const chars = [...(asset.text ?? '')].length;
  if (role === 'chapterTitle') return chars > 18 ? 2 : 1;
  if (role === 'sentence') return chars > 70 ? 4 : chars > 36 ? 3 : 2;
  if (role === 'caption') return chars > 32 ? 2 : 1;
  return Math.max(2, Math.min(12, Math.ceil(chars / 28)));
}

/** Builds a collapsing vertical stack. Display slots receive their preferred
 * height; body receives all remaining room and can later continue on a page. */
export function buildTextSlotFrames(
  spec: PageSpec,
  area: Rect,
  gap: number,
  assigned: AssignedTextSlot[],
): LayoutFrame[] {
  const populated = assigned.filter((slot) => slot.assets.length);
  if (!populated.length) return [];
  const entries = populated.flatMap((slot) => slot.assets.map((asset) => ({ slot, asset })));
  const interGap = Math.max(1.8, gap * 0.65);
  const gapTotal = interGap * Math.max(0, entries.length - 1);
  const preferred = entries.map(({ slot, asset }) =>
    slot.definition.typography === 'body'
      ? 0
      : textBlockHeight(spec, slot.definition.typography, preferredLines(slot.definition.typography, asset)),
  );
  const bodies = entries.filter(({ slot }) => slot.definition.typography === 'body').length;
  const fixed = preferred.reduce((sum, height) => sum + height, 0);
  const available = Math.max(1, area.h - gapTotal);
  const scale = fixed > available * (bodies ? 0.62 : 1) ? (available * (bodies ? 0.62 : 1)) / Math.max(1, fixed) : 1;
  const bodyHeight = bodies ? Math.max(textBlockHeight(spec, 'body', 3), (available - fixed * scale) / bodies) : 0;
  let y = area.y;
  return entries.map(({ slot, asset }, index) => {
    const h = slot.definition.typography === 'body' ? bodyHeight : preferred[index] * scale;
    const frame: LayoutFrame = {
      id: makeId('frm'), kind: 'text', x: area.x, y, w: area.w, h,
      assetId: asset.id, textRole: slot.definition.typography,
      align: slot.definition.align ?? (slot.definition.typography === 'chapterTitle' ? 'left' : 'left'),
    };
    y += h + interGap;
    return frame;
  });
}

/** Selects a coherent bundle: the anchor's source document first, then other
 * role-compatible blocks in reading order. */
export function selectTextBundle(texts: Asset[], definitions: TextSlotDefinition[], maxTexts: number): Asset[] {
  if (!texts.length) return [];
  const anchor = texts[0];
  const sameDocument = anchor.sourceDocumentId
    ? texts.filter((asset) => asset.sourceDocumentId === anchor.sourceDocumentId)
    : [anchor];
  const ordered = [...sameDocument, ...texts.filter((asset) => !sameDocument.includes(asset))];
  const assigned = assignTextSlots(ordered, definitions).flatMap((slot) => slot.assets);
  return assigned.slice(0, maxTexts);
}
