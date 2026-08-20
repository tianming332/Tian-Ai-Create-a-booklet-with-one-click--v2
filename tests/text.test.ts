import { describe, expect, it } from 'vitest';
import {
  createApproxMeasure,
  layoutText,
  segmentUnits,
  wrapUnits,
} from '../src/engine/text/textLayout';
import { defaultPageSpec } from '../src/shared/constants';

const measure = createApproxMeasure();
const spec = defaultPageSpec();

describe('segmentUnits', () => {
  it('keeps latin words atomic', () => {
    expect(segmentUnits('hello world')).toEqual(['hello ', 'world']);
  });

  it('attaches closing punctuation to the previous unit', () => {
    expect(segmentUnits('你好。')).toEqual(['你', '好。']);
  });

  it('pulls the next character in after opening punctuation', () => {
    expect(segmentUnits('「春天」')).toEqual(['「春', '天」']);
  });

  it('keeps newlines as their own unit', () => {
    expect(segmentUnits('甲\n乙')).toEqual(['甲', '\n', '乙']);
  });
});

describe('wrapUnits', () => {
  const cjk = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸';

  it('never starts a line with forbidden punctuation', () => {
    const text = '春天来了。夏天走了。秋天到了。冬天冷了。';
    const lines = wrapUnits(segmentUnits(text), 40, 10, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect('、。，！？；：）」』'.includes(line[0])).toBe(false);
    }
  });

  it('never ends a line with opening punctuation', () => {
    const text = '他说「今天天气很好」而我说「明天也许更好」再说「后天呢」';
    const lines = wrapUnits(segmentUnits(text), 50, 10, measure);
    for (const line of lines) {
      expect('（「『【([{'.includes(line[line.length - 1])).toBe(false);
    }
  });

  it('respects the width budget', () => {
    const lines = wrapUnits(segmentUnits(cjk), 50, 10, measure);
    for (const line of lines) expect(measure(line, 10)).toBeLessThanOrEqual(50);
  });

  it('hard-splits units wider than the box', () => {
    const lines = wrapUnits(segmentUnits('Unbreakablesupercalifragilistic'), 30, 10, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Unbreakablesupercalifragilistic');
  });
});

describe('layoutText', () => {
  it('fits short text without shrinking or truncating', () => {
    const res = layoutText({
      text: '一个安静的下午',
      role: 'body',
      spec,
      box: { w: 90, h: 40 },
      measure,
    });
    expect(res.lines.length).toBe(1);
    expect(res.shrunk).toBe(false);
    expect(res.truncated).toBe(false);
    expect(res.overflow).toBe(false);
  });

  it('shrinks before truncating', () => {
    const text = '这是一段稍微长一点的文字用来测试缩放行为的效果如何'.repeat(2);
    const res = layoutText({ text, role: 'body', spec, box: { w: 60, h: 18 }, measure });
    expect(res.shrunk).toBe(true);
  });

  it('truncates with an ellipsis when shrinking is not enough', () => {
    const text = '很长很长的文字'.repeat(40);
    const res = layoutText({ text, role: 'body', spec, box: { w: 50, h: 20 }, measure });
    expect(res.truncated).toBe(true);
    expect(res.overflow).toBe(true);
    expect(res.lines[res.lines.length - 1].endsWith('…')).toBe(true);
    for (const line of res.lines) expect(measure(line, res.sizePt)).toBeLessThanOrEqual(mmWidth(50));
  });

  it('reports height consistent with the line count', () => {
    const res = layoutText({
      text: '第一行文字\n第二行文字',
      role: 'body',
      spec,
      box: { w: 90, h: 40 },
      measure,
    });
    expect(res.lines.length).toBe(2);
    expect(res.heightMm).toBeCloseTo(res.lineHeightMm * 2, 6);
  });

  it('is deterministic', () => {
    const args = {
      text: '同样的输入应当得到同样的输出，这是排版引擎的基本要求。',
      role: 'sentence' as const,
      spec,
      box: { w: 70, h: 30 },
      measure,
    };
    expect(JSON.stringify(layoutText(args))).toBe(JSON.stringify(layoutText(args)));
  });
});

function mmWidth(mm: number): number {
  return (mm * 72) / 25.4 + 0.001;
}
