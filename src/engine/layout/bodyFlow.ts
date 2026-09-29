import { createApproxMeasure, flowBodyText } from '../text/textLayout';
import type { Asset, Page, PageSpec } from '../../shared/types';
import { makeId } from '../../shared/ids';
import { safeRect } from '../../shared/geometry';
import { textBlockHeight } from './style';
import { frameGap, templateById } from './templates';
import type { TemplateContext } from './types';

const sideForIndex = (index: number): 'left' | 'right' | 'single' =>
  index === 0 ? 'single' : index % 2 === 1 ? 'right' : 'left';

function pageNumberFrame(spec: PageSpec, index: number) {
  const side = sideForIndex(index);
  const live = safeRect(spec, side);
  return {
    id: makeId('frm'), kind: 'text' as const, x: live.x,
    y: spec.trimHeight - spec.safeMargin + Math.max(1, spec.safeMargin * 0.15),
    w: live.w, h: textBlockHeight(spec, 'pageNumber', 1), textRole: 'pageNumber' as const,
    textOverride: String(index), align: side === 'left' ? 'left' as const : 'right' as const,
  };
}

/** Expands overflowing body frames into measured continuation text pages.
 * Approximate bundled-font metrics are deterministic and close to the actual
 * Noto metrics; preview/PDF still use their exact shared renderer afterward. */
export function paginateBodyFlows(pages: Page[], spec: PageSpec, assets: Asset[]): Page[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const measure = createApproxMeasure();
  const output: Page[] = [];
  for (const original of pages) {
    const page = { ...original, frames: original.frames.map((frame) => ({ ...frame })) };
    output.push(page);
    for (const frame of page.frames) {
      if (frame.kind !== 'text' || frame.textRole !== 'body' || !frame.assetId || frame.textRange) continue;
      const asset = byId.get(frame.assetId);
      if (!asset?.text) continue;
      const first = flowBodyText({ text: asset.text, spec, boxes: [{ w: frame.w, h: frame.h }], measure });
      const fragment = first.fragments[0];
      if (!fragment) continue;
      frame.textRange = { start: fragment.start, end: fragment.end };
      if (!first.overflow) continue;
      let offset = fragment.end;
      let guard = 0;
      while (offset < asset.text.trim().length && guard++ < 200) {
        const index = output.length;
        const def = templateById('T08')!;
        const ctx: TemplateContext = {
          spec, side: sideForIndex(index), images: [], texts: [asset], gap: frameGap(spec), pageIndex: index,
        };
        const continuation = def.build(ctx).find((candidate) => candidate.kind === 'text' && candidate.textRole === 'body');
        if (!continuation) break;
        const flowed = flowBodyText({
          text: asset.text.slice(offset), spec,
          boxes: [{ w: continuation.w, h: continuation.h }], measure,
        });
        const next = flowed.fragments[0];
        if (!next) break;
        continuation.textRange = { start: offset + next.start, end: offset + next.end };
        const frames = [continuation];
        if (spec.showPageNumbers && index > 0) frames.push(pageNumberFrame(spec, index));
        output.push({
          id: makeId('pg'), index, templateId: 'T08', density: def.density, frames,
          groupId: page.groupId, locked: false,
        });
        offset += next.end;
      }
    }
  }
  return output.map((page, index) => {
    const frames = page.frames.filter((frame) => frame.textRole !== 'pageNumber');
    if (spec.showPageNumbers && index > 0 && !page.isBlank) frames.push(pageNumberFrame(spec, index));
    return { ...page, index, frames };
  });
}
