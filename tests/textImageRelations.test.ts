import { describe, expect, it } from 'vitest';
import { buildTextImageRelations, bestRelation } from '../src/engine/relations/textImage';
import { parseTextDocument } from '../src/engine/text/structure';
import { fakeImage, fakeText } from './fixtures';

describe('text-image relation model', () => {
  it('matches literal scene/action/emotion descriptions to image semantic tags', () => {
    const beach = { ...fakeImage(1), aiSemantic: { scenes: ['沙滩'], objects: ['沙滩'], actions: ['微笑'], emotions: ['开心'] } };
    const city = { ...fakeImage(7), aiSemantic: { scenes: ['城市'], objects: ['建筑'], emotions: ['紧张'] } };
    const text = fakeText(2, '她在沙滩上笑得很开心');
    text.textBlock = parseTextDocument(text.text!, 'doc').blocks[0];
    const relations = buildTextImageRelations([beach, city, text]);
    const best = bestRelation(relations, text.id)!;
    expect(best.imageId).toBe(beach.id);
    expect(best.score).toBeGreaterThanOrEqual(0.45);
    expect(best.kind).toBe('literal');
  });

  it('uses mood and theme tags for abstract prose', () => {
    const memory = { ...fakeImage(1), aiSemantic: { moods: ['安静'], themes: ['告别', '记忆'], emotions: ['怀念'] } };
    const text = fakeText(2, '有些告别只是换一种方式留在记忆里，安静地怀念。');
    text.textBlock = parseTextDocument(text.text!, 'doc').blocks[0];
    const best = bestRelation(buildTextImageRelations([memory, text]), text.id)!;
    expect(best.imageId).toBe(memory.id);
    expect(best.reasons.join(' ')).toMatch(/情感|氛围|主题/);
  });

  it('keeps manual caption bindings locked', () => {
    const image = fakeImage(1);
    const text = fakeText(2, '图片说明', image.id);
    text.textBlock = { ...parseTextDocument(text.text!, 'doc').blocks[0], role: 'caption' };
    const best = bestRelation(buildTextImageRelations([image, text]), text.id)!;
    expect(best.score).toBe(1);
    expect(best.kind).toBe('caption');
    expect(best.locked).toBe(true);
  });
});
