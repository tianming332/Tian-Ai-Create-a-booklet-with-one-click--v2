import type { TextFeatures, TextLengthClass } from '../../shared/types';

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z'’-]*|\d+(?:[.:/-]\d+)*/g;
const SPECIAL_TOKEN_RE = /\d{2,4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d+(?:\.\d+)?(?:km|m|kg|mm|°C|%)?|No\.?\d+/gi;
const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','at','is','are','was','were','be','it','this','that','with','for','as','by','from',
  '的','了','和','是','在','我','有','就','不','也','都','很','与','而','这','那','你','他','她','它','我们','他们','以及','一个',
]);

/** NFKC + whitespace collapse; structural punctuation is kept for line breaking. */
export function normalizeText(input: string): string {
  return input.normalize('NFKC').replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export function cjkRatio(text: string): number {
  if (text.length === 0) return 0;
  let cjk = 0;
  for (const ch of text) if (CJK_RE.test(ch)) cjk += 1;
  return cjk / [...text].length;
}

function segmentWords(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const seg = new Segmenter('zh-Hans', { granularity: 'word' });
    return [...seg.segment(text)]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment.toLowerCase());
  }
  return text.toLowerCase().match(LATIN_TOKEN_RE) ?? [];
}

/**
 * Short-text tokens: CJK character 2/3-grams plus latin word tokens.
 * Character n-grams beat word segmentation on 10-40 char captions.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  const tokens: string[] = [];
  const chars = [...normalized.replace(/[\s，。！？；：、（）《》【】「」『』…·,.!?;:"'()\[\]{}\-—_/]+/g, '')];
  const isCjkHeavy = cjkRatio(normalized) > 0.2;

  if (isCjkHeavy) {
    for (let n = 2; n <= 3; n += 1) {
      for (let i = 0; i + n <= chars.length; i += 1) {
        const gram = chars.slice(i, i + n).join('');
        if (CJK_RE.test(gram)) tokens.push(gram);
      }
    }
  }
  for (const word of segmentWords(normalized)) {
    if (word.length > 1 && !STOPWORDS.has(word)) tokens.push(word);
  }
  return tokens;
}

export function extractSpecialTokens(text: string): string[] {
  const matches = normalizeText(text).match(SPECIAL_TOKEN_RE) ?? [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

export function classifyLength(charCount: number): TextLengthClass {
  if (charCount <= 12) return 'label';
  if (charCount <= 45) return 'short';
  if (charCount <= 160) return 'medium';
  if (charCount <= 600) return 'long';
  return 'tooLong';
}

export interface Corpus {
  /** token -> document frequency */
  df: Map<string, number>;
  documentCount: number;
}

export function buildCorpus(documents: string[][]): Corpus {
  const df = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { df, documentCount: documents.length };
}

/** L2-normalised sparse tf-idf vector. */
export function tfidfVector(tokens: string[], corpus: Corpus): Record<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  const vector: Record<string, number> = {};
  let norm = 0;
  for (const [token, count] of tf) {
    const df = corpus.df.get(token) ?? 0;
    const idf = Math.log((1 + corpus.documentCount) / (1 + df)) + 1;
    const value = (count / tokens.length) * idf;
    vector[token] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (const key of Object.keys(vector)) vector[key] /= norm;
  return vector;
}

export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  const [small, large] = Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let sum = 0;
  for (const [token, value] of Object.entries(small)) {
    const other = large[token];
    if (other) sum += value * other;
  }
  return Math.max(0, Math.min(1, sum));
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

export function topKeywords(vector: Record<string, number>, k = 6): string[] {
  return Object.entries(vector)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, k)
    .map(([token]) => token);
}

export function analyzeText(text: string, corpus: Corpus): TextFeatures {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);
  const tfidf = tfidfVector(tokens, corpus);
  const charCount = [...normalized].length;
  return {
    normalized,
    charCount,
    lengthClass: classifyLength(charCount),
    tokens,
    tfidf,
    keywords: topKeywords(tfidf),
    specialTokens: extractSpecialTokens(normalized),
    cjkRatio: cjkRatio(normalized),
  };
}

/** Batch entry point: idf must be shared across the project's texts. */
export function analyzeTexts(texts: string[]): TextFeatures[] {
  const tokenized = texts.map((t) => tokenize(t));
  const corpus = buildCorpus(tokenized);
  return texts.map((text) => analyzeText(text, corpus));
}

function lengthSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  return 1 - Math.abs(a - b) / Math.max(a, b, 1);
}

/** Spec 6.3 weighted short-text similarity. */
export function textSimilarity(
  a: TextFeatures,
  b: TextFeatures,
  adjacency = 0,
): number {
  const special = jaccard(a.specialTokens, b.specialTokens);
  return (
    0.55 * cosine(a.tfidf, b.tfidf) +
    0.2 * jaccard(a.keywords, b.keywords) +
    0.05 * lengthSimilarity(a.charCount, b.charCount) +
    0.1 * special +
    0.1 * adjacency
  );
}
