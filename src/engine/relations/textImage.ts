import type { Asset, SemanticTags, TextBlock, TextImageRelation, TextImageRelationKind } from '../../shared/types';

const norm = (value: string): string => value.trim().toLowerCase();
const terms = (values: string[] = []): Set<string> => new Set(values.map(norm).filter(Boolean));
const intersect = (a: Set<string>, b: Set<string>): string[] => [...a].filter((value) => b.has(value));

function imageSemantic(asset: Asset): SemanticTags {
  const generic = asset.aiTags ?? [];
  const haystack = `${asset.meta.fileName ?? ''} ${asset.aiCaption ?? ''}`;
  const visualTerms = ['沙滩', '海边', '海浪', '电车', '火车', '街道', '建筑', '花', '树', '天空', '云', '山', '湖', '猫', '狗']
    .filter((term) => haystack.includes(term));
  return {
    ...asset.aiSemantic,
    objects: [...(asset.aiSemantic?.objects ?? []), ...visualTerms],
    scenes: [...(asset.aiSemantic?.scenes ?? []), ...visualTerms],
    themes: [...(asset.aiSemantic?.themes ?? []), ...generic],
  };
}

function fieldMatch(block: TextBlock, image: Asset, type: keyof SemanticTags): string[] {
  const map: Partial<Record<keyof SemanticTags, string[]>> = {
    people: block.entities.filter((e) => e.type === 'person').map((e) => e.value),
    actions: block.entities.filter((e) => e.type === 'action').map((e) => e.value),
    locations: block.entities.filter((e) => e.type === 'location').map((e) => e.value),
    emotions: block.entities.filter((e) => e.type === 'emotion').map((e) => e.value),
    moods: block.entities.filter((e) => e.type === 'mood').map((e) => e.value),
    themes: block.entities.filter((e) => e.type === 'theme').map((e) => e.value),
    objects: block.entities.filter((e) => e.type === 'object').map((e) => e.value),
  };
  const textTerms = terms([...(map[type] ?? []), ...block.semanticTags]);
  const imageTerms = terms(imageSemantic(image)[type] ?? []);
  const exact = intersect(textTerms, imageTerms);
  // Chinese compounds often differ only by a suffix (海/海边, 笑/微笑).
  for (const a of textTerms) for (const b of imageTerms) {
    if (a.length >= 1 && b.length >= 1 && (a.includes(b) || b.includes(a)) && !exact.includes(a)) exact.push(a);
  }
  return exact;
}

function dateScore(block: TextBlock, image: Asset): { score: number; reason?: string } {
  if (!image.meta.takenAt) return { score: 0 };
  const year = String(new Date(image.meta.takenAt).getFullYear());
  const date = block.entities.find((entity) => entity.type === 'date');
  return date?.value.includes(year) ? { score: 0.18, reason: `时间一致：${year}` } : { score: 0 };
}

function kindFor(matches: Record<string, string[]>): TextImageRelationKind {
  if (matches.action?.length || matches.object?.length) return 'literal';
  if (matches.person?.length) return 'person';
  if (matches.location?.length) return 'location';
  if (matches.emotion?.length) return 'emotion';
  if (matches.mood?.length) return 'mood';
  if (matches.theme?.length) return 'theme';
  return 'weak';
}

export function scoreTextImage(text: Asset, image: Asset): Omit<TextImageRelation, 'id'> | undefined {
  const block = text.textBlock;
  if (!block || image.kind !== 'image') return undefined;
  if (text.boundToAssetId === image.id) return {
    textAssetId: text.id, textBlockId: block.id, imageId: image.id,
    kind: block.role === 'caption' ? 'caption' : 'manual', score: 1,
    reasons: ['用户手动绑定'], source: 'manual', locked: true,
  };
  const matches = {
    person: fieldMatch(block, image, 'people'), action: fieldMatch(block, image, 'actions'),
    location: fieldMatch(block, image, 'locations'), emotion: fieldMatch(block, image, 'emotions'),
    mood: fieldMatch(block, image, 'moods'), theme: fieldMatch(block, image, 'themes'),
    object: fieldMatch(block, image, 'objects'),
  };
  let score = 0;
  const reasons: string[] = [];
  const add = (key: keyof typeof matches, weight: number, label: string) => {
    if (matches[key].length) { score += weight; reasons.push(`${label}：${matches[key].slice(0, 3).join('、')}`); }
  };
  add('person', 0.18, '人物'); add('action', 0.24, '动作'); add('location', 0.26, '地点');
  add('object', 0.36, '画面'); add('emotion', 0.2, '情感'); add('mood', 0.15, '氛围'); add('theme', 0.12, '主题');
  const date = dateScore(block, image); score += date.score; if (date.reason) reasons.push(date.reason);
  const distance = Math.abs(text.importIndex - image.importIndex);
  const adjacency = Math.max(0, 0.12 * (1 - distance / 12));
  score += adjacency;
  if (adjacency >= 0.07) reasons.push('素材顺序相邻');
  if (!reasons.length || score < 0.16) return undefined;
  return {
    textAssetId: text.id, textBlockId: block.id, imageId: image.id,
    kind: kindFor(matches), score: Math.min(0.99, Math.round(score * 100) / 100), reasons,
    source: 'rule', locked: false,
  };
}

export function buildTextImageRelations(assets: Asset[], previous: TextImageRelation[] = []): TextImageRelation[] {
  const locked = previous.filter((relation) => relation.locked);
  const lockedText = new Set(locked.map((relation) => relation.textAssetId));
  const images = assets.filter((asset) => asset.kind === 'image');
  const texts = assets.filter((asset) => asset.kind === 'text' && asset.textBlock && !lockedText.has(asset.id));
  const generated = texts.flatMap((text) => images.flatMap((image) => {
    const relation = scoreTextImage(text, image);
    return relation ? [{ ...relation, id: `rel:${text.id}:${image.id}` }] : [];
  }));
  return [...locked, ...generated]
    .filter((relation) => assets.some((asset) => asset.id === relation.textAssetId) && assets.some((asset) => asset.id === relation.imageId))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function bestRelation(relations: TextImageRelation[], textAssetId: string): TextImageRelation | undefined {
  return relations.filter((relation) => relation.textAssetId === textAssetId).sort((a, b) => b.score - a.score)[0];
}
