import { describe, expect, it } from 'vitest';
import { parseTextDocument } from '../src/engine/text/structure';
import { textAssetsFromRaw } from '../src/store/importFiles';

describe('structured text parser', () => {
  it('recognises headings, lead, metadata, body, quote and credit', () => {
    const doc = parseTextDocument(`# 夏日海边\n\n引言：风吹过旧车站。\n\n地点：镰仓沙滩\n\n下午四点，我们沿着海岸一直往前走。她在沙滩上笑得很开心。\n\n> 有些地方只要记得就够了。\n\n——田江明`, 'doc1');
    expect(doc.blocks.map((block) => block.role)).toEqual([
      'heading1', 'lead', 'metadata', 'shortSentence', 'quote', 'credit',
    ]);
    const body = doc.blocks.find((block) => block.role === 'shortSentence')!;
    expect(body.entities.some((entity) => entity.type === 'action' && entity.value === '笑')).toBe(true);
    expect(body.entities.some((entity) => entity.type === 'emotion' && entity.value === '开心')).toBe(true);
  });

  it('splits very long body copy without losing text', () => {
    const text = '这是一段需要排到画册中的正文。'.repeat(80);
    const doc = parseTextDocument(text, 'doc2');
    expect(doc.blocks.length).toBeGreaterThan(1);
    expect(doc.blocks.every((block) => block.role === 'body' && block.allowSplit)).toBe(true);
    expect(doc.blocks.map((block) => block.text).join('')).toBe(text);
  });

  it('turns every semantic block into a placeable asset from one document', () => {
    const assets = textAssetsFromRaw('# 标题\n\n引言：一段导语。\n\n正文需要进入画册。', 5, 'story.md');
    expect(assets).toHaveLength(3);
    expect(new Set(assets.map((asset) => asset.sourceDocumentId)).size).toBe(1);
    expect(assets.map((asset) => asset.textBlock?.role)).toEqual(['heading1', 'lead', 'shortSentence']);
    expect(assets.map((asset) => asset.importIndex)).toEqual([5, 6, 7]);
  });
});
