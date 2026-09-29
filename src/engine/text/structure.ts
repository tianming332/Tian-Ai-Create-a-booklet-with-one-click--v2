import { makeId } from '../../shared/ids';
import type { TextBlock, TextBlockRole, TextDocument, TextEntity, TextEntityType } from '../../shared/types';

const DATE_RE = /(?:19|20)\d{2}(?:[年/.\-]\d{1,2})?(?:[月/.\-]\d{1,2}日?)?|\d{1,2}月\d{1,2}日/g;
const TIME_RE = /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:清晨|早晨|上午|中午|下午|傍晚|晚上|深夜)/g;
const LOCATION_RE = /([\u4e00-\u9fff]{2,10})(?:省|市|县|区|镇|村|岛|山|湖|河|海|湾|沙滩|车站|机场|公园|街|路)/g;
const PERSON_RE = /(?:人物|摄影|作者|出镜|与|和)[：:\s]*([\u4e00-\u9fff]{2,4})/g;

const LEXICON: Array<[TextEntityType, RegExp, string[]]> = [
  ['action', /笑|微笑|奔跑|走|看|拥抱|跳|坐|站|回头|挥手/g, ['笑', '微笑', '奔跑', '行走', '凝望', '拥抱']],
  ['emotion', /开心|快乐|幸福|悲伤|难过|孤独|平静|自由|温暖|怀念|怀旧|紧张|浪漫/g, ['开心', '快乐', '幸福', '悲伤', '孤独', '平静', '自由', '温暖', '怀念', '浪漫']],
  ['mood', /安静|热闹|明亮|阴郁|轻松|梦幻|朦胧|治愈|夏日|冬日/g, ['安静', '热闹', '明亮', '阴郁', '轻松', '梦幻', '朦胧', '治愈', '夏日', '冬日']],
  ['theme', /告别|记忆|成长|旅程|旅行|相遇|重逢|青春|家庭|故乡|爱|时间/g, ['告别', '记忆', '成长', '旅程', '旅行', '相遇', '重逢', '青春', '家庭', '故乡', '爱', '时间']],
  ['object', /沙滩|海边|海浪|电车|火车|街道|建筑|花|树|天空|云|山|湖|食物|猫|狗/g, ['沙滩', '海边', '海浪', '电车', '火车', '街道', '建筑', '花', '树', '天空', '云', '山', '湖', '食物', '猫', '狗']],
];

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function entitiesOf(text: string): TextEntity[] {
  const out: TextEntity[] = [];
  const add = (type: TextEntityType, value: string, confidence: number) => {
    const clean = value.trim();
    if (clean && !out.some((item) => item.type === type && item.value === clean)) {
      out.push({ type, value: clean, normalizedValue: clean.toLowerCase(), confidence });
    }
  };
  for (const value of text.match(DATE_RE) ?? []) add('date', value, 0.98);
  for (const value of text.match(TIME_RE) ?? []) add('time', value, 0.92);
  for (const match of text.matchAll(LOCATION_RE)) add('location', match[1] + match[0].slice(match[1].length), 0.78);
  for (const match of text.matchAll(PERSON_RE)) add('person', match[1], 0.72);
  for (const [type, pattern, terms] of LEXICON) {
    pattern.lastIndex = 0;
    for (const term of terms) if (text.includes(term)) add(type, term, 0.78);
  }
  return out;
}

function stripMarkup(raw: string): { text: string; explicit?: TextBlockRole } {
  const line = raw.trim();
  if (/^###\s+/.test(line)) return { text: line.replace(/^###\s+/, ''), explicit: 'heading3' };
  if (/^##\s+/.test(line)) return { text: line.replace(/^##\s+/, ''), explicit: 'heading2' };
  if (/^#\s+/.test(line)) return { text: line.replace(/^#\s+/, ''), explicit: 'heading1' };
  if (/^>\s?/.test(line)) return { text: line.replace(/^>\s?/, ''), explicit: 'quote' };
  if (/^(引言|导语|前言)[：:]\s*/.test(line)) return { text: line.replace(/^(引言|导语|前言)[：:]\s*/, ''), explicit: 'lead' };
  if (/^(地点|时间|日期|人物|出镜|摄影)[：:]/.test(line)) return { text: line, explicit: 'metadata' };
  if (/^(——|—\s|--\s)/.test(line)) return { text: line.replace(/^(——|—\s|--\s)/, ''), explicit: 'credit' };
  return { text: line };
}

function inferredRole(text: string, index: number, total: number): TextBlockRole {
  const chars = [...text].length;
  if (DATE_RE.test(text) && chars <= 36) { DATE_RE.lastIndex = 0; return 'metadata'; }
  DATE_RE.lastIndex = 0;
  if (/^[“「『\"].+[”」』\"]$/.test(text) && chars <= 120) return 'quote';
  if (index === 0 && chars <= 24 && !/[。！？!?]$/.test(text)) return 'heading1';
  if (chars <= 18 && !/[。！？!?]$/.test(text)) return total > 1 ? 'heading2' : 'shortSentence';
  if (chars <= 56) return 'shortSentence';
  return 'body';
}

function sentenceChunks(text: string, limit = 420): string[] {
  if ([...text].length <= limit) return [text];
  const sentences = text.split(/(?<=[。！？!?；;])\s*/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences.length ? sentences : [text]) {
    if (current && [...current + sentence].length > limit) {
      chunks.push(current.trim());
      current = '';
    }
    if ([...sentence].length > limit) {
      for (let at = 0; at < sentence.length; at += limit) chunks.push(sentence.slice(at, at + limit));
    } else current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function parseTextDocument(raw: string, documentId = makeId('doc')): TextDocument {
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  const units = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const blocks: TextBlock[] = [];
  units.forEach((unit, unitIndex) => {
    const marked = stripMarkup(unit);
    const baseRole = marked.explicit ?? inferredRole(marked.text, unitIndex, units.length);
    const pieces = baseRole === 'body' ? sentenceChunks(marked.text) : [marked.text];
    pieces.forEach((text, pieceIndex) => {
      const role = baseRole;
      const entities = entitiesOf(text);
      blocks.push({
        id: makeId('blk'), sourceDocumentId: documentId, role, text,
        order: blocks.length, importance: role === 'heading1' ? 1 : role === 'lead' || role === 'quote' ? 0.9 : role === 'body' ? 0.65 : 0.75,
        decorative: ['heading1', 'heading2', 'heading3', 'lead', 'quote', 'shortSentence'].includes(role),
        allowOverlay: ['heading1', 'heading2', 'lead', 'quote', 'shortSentence', 'caption'].includes(role),
        allowSplit: role === 'body', continuation: pieceIndex > 0,
        entities,
        semanticTags: unique(entities.filter((item) => ['object', 'action', 'emotion', 'mood', 'theme', 'location', 'person'].includes(item.type)).map((item) => item.value)),
        parser: 'rule',
      });
    });
  });
  return { id: documentId, blocks, parser: 'rule', version: 1 };
}

export function roleLabel(role: TextBlockRole): string {
  return ({ heading1: '一级标题', heading2: '二级标题', heading3: '三级标题', lead: '引言', body: '正文', shortSentence: '短句', quote: '引语', caption: '图片说明', metadata: '信息', credit: '署名' })[role];
}

export const TEXT_BLOCK_ROLES: TextBlockRole[] = ['heading1', 'heading2', 'heading3', 'lead', 'body', 'shortSentence', 'quote', 'caption', 'metadata', 'credit'];

