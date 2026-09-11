import { PARAMS } from '../../shared/constants';
import { makeId } from '../../shared/ids';
import type { Asset, Group, GroupingSettings, LabColor } from '../../shared/types';
import { deltaE76 } from '../analysis/color';
import { hashDistance } from '../analysis/hash';
import { imageSimilarity, mixedSimilarity } from './similarity';

function weightsFrom(settings: GroupingSettings) {
  const rest = 1 - settings.colorWeight - settings.timeWeight;
  const share = Math.max(0, rest) / 3;
  return {
    color: settings.colorWeight,
    time: settings.timeWeight,
    perceptual: share,
    aspect: share,
    adjacency: share,
  };
}

function groupCentroid(assets: Asset[]): LabColor | undefined {
  const colors = assets.flatMap((a) => a.visual?.dominantColors ?? []);
  if (colors.length === 0) return undefined;
  let l = 0;
  let a = 0;
  let b = 0;
  let weight = 0;
  for (const color of colors) {
    l += color.lab.l * color.weight;
    a += color.lab.a * color.weight;
    b += color.lab.b * color.weight;
    weight += color.weight;
  }
  return weight === 0 ? undefined : { l: l / weight, a: a / weight, b: b / weight };
}

/** Stable base ordering. Ties always fall back to importIndex for determinism. */
export function orderAssets(assets: Asset[], settings: GroupingSettings): Asset[] {
  const list = [...assets];
  switch (settings.orderMode) {
    case 'original':
      return list.sort((a, b) => a.importIndex - b.importIndex);
    case 'time':
    case 'standardSmart':
      return list.sort(
        (a, b) =>
          (a.meta.takenAt ?? Number.MAX_SAFE_INTEGER) - (b.meta.takenAt ?? Number.MAX_SAFE_INTEGER) ||
          a.importIndex - b.importIndex,
      );
    case 'colorFlow':
      return list.sort((a, b) => (a.visual?.luma ?? 1) - (b.visual?.luma ?? 1) || a.importIndex - b.importIndex);
    case 'shuffleRhythm':
      // Groups stay intact; only orientation/brightness alternation is applied later.
      return list.sort((a, b) => a.importIndex - b.importIndex);
    default:
      return list;
  }
}

/** Marks near-duplicates without deleting anything (spec 18.2). */
export function markNearDuplicates(assets: Asset[]): void {
  const images = assets.filter((a) => a.kind === 'image' && a.visual);
  for (let i = 0; i < images.length; i += 1) {
    for (let j = i + 1; j < images.length; j += 1) {
      if (images[j].nearDuplicateOf) continue;
      const distance = hashDistance(images[i].visual!.dHash, images[j].visual!.dHash);
      if (distance <= PARAMS.nearDuplicateHashDistance) {
        images[j].nearDuplicateOf = images[i].id;
        if (!images[j].warnings.includes('疑似重复素材')) images[j].warnings.push('疑似重复素材');
      }
    }
  }
}

interface Segment {
  assets: Asset[];
  reason: string;
}

/**
 * Similarity graph over a local window + continuity and size constraints
 * (spec 7.4). Deterministic: same input + settings ⇒ same output.
 */
export function groupAssets(assets: Asset[], settings: GroupingSettings): Group[] {
  const ordered = orderAssets(
    assets.filter((a) => a.kind === 'image'),
    settings,
  );
  const strong = PARAMS.groupStrongThreshold / settings.groupStrength;
  const weak = PARAMS.groupWeakThreshold / settings.groupStrength;
  const weights = weightsFrom(settings);
  const hardMax = Math.min(PARAMS.groupHardMax, Math.max(2, settings.maxImagesPerGroup + 2));

  const segments: Segment[] = [];
  let current: Asset[] = [];
  let reason = 'start';

  const flush = (nextReason: string) => {
    if (current.length) segments.push({ assets: current, reason });
    current = [];
    reason = nextReason;
  };

  for (let i = 0; i < ordered.length; i += 1) {
    const asset = ordered[i];
    if (current.length === 0) {
      current.push(asset);
      continue;
    }
    const previous = current[current.length - 1];
    const similarity = imageSimilarity(previous, asset, weights, settings.windowSize);
    const timeGapMs = Math.abs((asset.meta.takenAt ?? 0) - (previous.meta.takenAt ?? 0));
    const bigTimeJump =
      previous.meta.takenAt != null && asset.meta.takenAt != null && timeGapMs > 3 * 60 * 60 * 1000;

    if (current.length >= hardMax) {
      flush('组已达硬上限');
      current.push(asset);
      continue;
    }
    if (bigTimeJump && current.length >= 2) {
      flush('时间跳变');
      current.push(asset);
      continue;
    }
    if (similarity >= strong) {
      current.push(asset);
      continue;
    }
    if (similarity >= weak && current.length < settings.maxImagesPerGroup) {
      current.push(asset);
      continue;
    }
    flush(similarity < weak ? '相似度低于弱阈值' : '组大小约束');
    current.push(asset);
  }
  flush('end');

  // Groups of 1 are re-attached to the more similar neighbour (spec 7.4.4).
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].assets.length >= 2) continue;
    const orphan = segments[i].assets[0];
    const before = segments[i - 1];
    const after = segments[i + 1];
    const scoreBefore = before
      ? imageSimilarity(before.assets[before.assets.length - 1], orphan, weights, settings.windowSize)
      : -1;
    const scoreAfter = after ? imageSimilarity(orphan, after.assets[0], weights, settings.windowSize) : -1;
    if (scoreBefore < 0 && scoreAfter < 0) continue;
    if (scoreBefore >= scoreAfter && before && before.assets.length < hardMax) {
      before.assets.push(orphan);
      segments.splice(i, 1);
      i -= 1;
    } else if (after && after.assets.length < hardMax) {
      after.assets.unshift(orphan);
      segments.splice(i, 1);
      i -= 1;
    }
  }

  let groups: Group[] = segments.map((segment) => ({
    id: makeId('grp'),
    assetIds: segment.assets.map((a) => a.id),
    locked: false,
    boundaryReason: segment.reason,
  }));

  if (settings.orderMode === 'colorFlow' || settings.orderMode === 'standardSmart') {
    groups = orderGroupsByColorFlow(groups, assets);
  }

  attachTextAssets(groups, assets, settings);
  return groups;
}

/** Nearest-neighbour path over Lab group centroids (spec 7.5 Color Flow). */
export function orderGroupsByColorFlow(groups: Group[], assets: Asset[]): Group[] {
  if (groups.length <= 2) return groups;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const centroids = groups.map((g) => groupCentroid(g.assetIds.map((id) => byId.get(id)!).filter(Boolean)));
  const remaining = new Set(groups.keys());
  const path: Group[] = [];
  let currentIndex = 0;
  remaining.delete(0);
  path.push(groups[0]);

  while (remaining.size > 0) {
    const from = centroids[currentIndex];
    let best = -1;
    let bestDistance = Infinity;
    for (const index of remaining) {
      const to = centroids[index];
      const distance = from && to ? deltaE76(from, to) : index; // no colour info ⇒ keep order
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    remaining.delete(best);
    path.push(groups[best]);
    currentIndex = best;
  }
  return path;
}

/** Bound captions follow their image; free texts join the best-scoring group. */
function attachTextAssets(groups: Group[], assets: Asset[], settings: GroupingSettings): void {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const groupOf = new Map<string, Group>();
  const textCount = new Map<string, number>();
  for (const group of groups) for (const id of group.assetIds) groupOf.set(id, group);

  for (const asset of assets) {
    if (asset.kind !== 'text') continue;
    if (asset.boundToAssetId) {
      const target = groupOf.get(asset.boundToAssetId);
      if (target && !target.assetIds.includes(asset.id)) {
        const at = target.assetIds.indexOf(asset.boundToAssetId);
        target.assetIds.splice(at + 1, 0, asset.id);
        groupOf.set(asset.id, target);
      }
      continue;
    }
    let best: Group | undefined;
    let bestScore = 0.28; // below this a text becomes its own quote page
    for (const group of groups) {
      const members = group.assetIds.map((id) => byId.get(id)!).filter(Boolean);
      const score = mixedSimilarity(asset, members, { window: settings.windowSize });
      if (score > bestScore) {
        bestScore = score;
        best = group;
      }
    }
    if (best) {
      best.assetIds.push(asset.id);
      groupOf.set(asset.id, best);
      textCount.set(best.id, (textCount.get(best.id) ?? 0) + 1);
    } else {
      // If photos exist, spread unmatched prose evenly across photo groups.
      // Keeping every unmatched paragraph in its own group caused all quote
      // pages to collect at the end of the book.
      const visualGroups = groups.filter((group) =>
        group.assetIds.some((id) => byId.get(id)?.kind === 'image'),
      );
      const fallback = visualGroups.sort(
        (a, b) =>
          (textCount.get(a.id) ?? 0) - (textCount.get(b.id) ?? 0) ||
          groups.indexOf(a) - groups.indexOf(b),
      )[0];
      if (fallback) {
        fallback.assetIds.push(asset.id);
        groupOf.set(asset.id, fallback);
        textCount.set(fallback.id, (textCount.get(fallback.id) ?? 0) + 1);
      } else {
        const solo: Group = {
          id: makeId('grp'),
          assetIds: [asset.id],
          locked: false,
          boundaryReason: '独立文字组',
        };
        groups.push(solo);
        groupOf.set(asset.id, solo);
      }
    }
  }
}

export function mergeGroups(groups: Group[], aId: string, bId: string): Group[] {
  const a = groups.find((g) => g.id === aId);
  const b = groups.find((g) => g.id === bId);
  if (!a || !b || a === b) return groups;
  return groups
    .map((g) => (g.id === aId ? { ...g, assetIds: [...a.assetIds, ...b.assetIds] } : g))
    .filter((g) => g.id !== bId);
}

export function splitGroup(groups: Group[], groupId: string, atIndex: number): Group[] {
  const index = groups.findIndex((g) => g.id === groupId);
  if (index < 0) return groups;
  const group = groups[index];
  if (atIndex <= 0 || atIndex >= group.assetIds.length) return groups;
  const first: Group = { ...group, assetIds: group.assetIds.slice(0, atIndex) };
  const second: Group = {
    id: makeId('grp'),
    assetIds: group.assetIds.slice(atIndex),
    locked: false,
    boundaryReason: '手动拆分',
  };
  return [...groups.slice(0, index), first, second, ...groups.slice(index + 1)];
}

/** Orientation/brightness alternation inside groups (Shuffle Rhythm mode). */
export function shuffleWithinGroups(groups: Group[], assets: Asset[]): Group[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  return groups.map((group) => {
    const members = group.assetIds.map((id) => byId.get(id)).filter((a): a is Asset => Boolean(a));
    const landscape = members.filter((a) => (a.visual?.aspectRatio ?? 1) >= 1);
    const portrait = members.filter((a) => (a.visual?.aspectRatio ?? 1) < 1);
    const interleaved: Asset[] = [];
    while (landscape.length || portrait.length) {
      if (landscape.length) interleaved.push(landscape.shift()!);
      if (portrait.length) interleaved.push(portrait.shift()!);
    }
    return { ...group, assetIds: interleaved.map((a) => a.id) };
  });
}
