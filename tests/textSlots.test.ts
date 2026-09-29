import { describe, expect, it } from 'vitest';
import { assignTextSlots, selectTextBundle, STRUCTURED_TEXT_SLOTS } from '../src/engine/layout/textSlots';
import { parseTextDocument } from '../src/engine/text/structure';
import { fakeText } from './fixtures';

function documentAssets(raw: string) {
  const document = parseTextDocument(raw, 'doc-slots');
  return document.blocks.map((block, index) => {
    const asset = fakeText(index, block.text);
    asset.sourceDocumentId = document.id;
    asset.textBlock = block;
    return asset;
  });
}

describe('semantic text slots', () => {
  it('assigns roles without using one block twice', () => {
    const assets = documentAssets('# 标题\n\n地点：东京\n\n引言：一段导语。\n\n这是一段较长的正文，用来测试正文槽位和其他层级可以在同一页面上共同出现。文字需要保持完整层次，并为后续的连续页面预留可靠的数据结构和排版空间。');
    const slots = assignTextSlots(assets, STRUCTURED_TEXT_SLOTS);
    const assigned = slots.flatMap((slot) => slot.assets);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(slots.find((slot) => slot.definition.id === 'title')?.assets).toHaveLength(1);
    expect(slots.find((slot) => slot.definition.id === 'meta')?.assets).toHaveLength(1);
    expect(slots.find((slot) => slot.definition.id === 'lead')?.assets).toHaveLength(1);
    expect(slots.find((slot) => slot.definition.id === 'body')?.assets).toHaveLength(1);
  });

  it('selects blocks from the same source document as one bundle', () => {
    const first = documentAssets('# 标题\n\n引言：导语。\n\n这是一段较长正文，需要作为正文而不是短句进入正文槽位继续排版。');
    const unrelated = fakeText(99, '另一个文档');
    unrelated.sourceDocumentId = 'other';
    const selected = selectTextBundle([...first, unrelated], STRUCTURED_TEXT_SLOTS, 6);
    expect(selected.slice(0, first.length).every((asset) => asset.sourceDocumentId === 'doc-slots')).toBe(true);
  });

  it('keeps a bound caption in a dedicated caption slot', () => {
    const caption = fakeText(1, '海边的早晨', 'img1');
    caption.textBlock = { ...parseTextDocument(caption.text!, 'caption-doc').blocks[0], role: 'caption' };
    const slot = assignTextSlots([caption], STRUCTURED_TEXT_SLOTS).find((item) => item.definition.id === 'caption');
    expect(slot?.assets.map((asset) => asset.id)).toEqual([caption.id]);
  });

  it('places a bound caption before document metadata in a mixed stack', () => {
    const caption = fakeText(1, '海边的早晨', 'img1');
    caption.textBlock = { ...parseTextDocument(caption.text!, 'caption-doc').blocks[0], role: 'caption' };
    const metadata = fakeText(2, '地点：镰仓');
    metadata.textBlock = { ...parseTextDocument(metadata.text!, 'meta-doc').blocks[0], role: 'metadata' };
    const assigned = assignTextSlots([metadata, caption], STRUCTURED_TEXT_SLOTS).filter((slot) => slot.assets.length);
    expect(assigned.map((slot) => slot.definition.id)).toEqual(['caption', 'meta']);
  });
});
