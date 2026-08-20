import { PARAMS } from '../../shared/constants';
import { mediaSize, rectWithin } from '../../shared/geometry';
import type { Asset, LayoutFrame } from '../../shared/types';
import { meanCropLoss } from './templates';
import { repetitionFit, rhythmAllows, rhythmFit } from './rhythm';
import type { RhythmState, TemplateContext, TemplateDefinition, TemplateScore } from './types';

export const SCORE_WEIGHTS = {
  assetCount: 0.3,
  aspectRatio: 0.25,
  text: 0.15,
  rhythm: 0.15,
  cropLoss: 0.1,
  repetition: 0.05,
} as const;

export interface EvaluateOptions {
  /** Images still waiting to be placed, including the ones in this context. */
  remainingImages: number;
  /** Texts still waiting, including the ones in this context. */
  remainingTexts: number;
  byId: Map<string, Asset>;
  rhythm: RhythmState;
  /** Style preference multiplier for this template; defaults to 1. */
  weight?: number;
}

export interface Candidate {
  def: TemplateDefinition;
  frames: LayoutFrame[];
  score: TemplateScore;
}

/** Frames must stay inside the media box unless they are explicitly bleed-out. */
function geometryValid(frames: LayoutFrame[], ctx: TemplateContext): boolean {
  const media = mediaSize(ctx.spec);
  const box = { x: -ctx.spec.bleed, y: -ctx.spec.bleed, w: media.w, h: media.h };
  return frames.every((frame) => {
    if (frame.w <= 0.5 || frame.h <= 0.5) return false;
    if (frame.bleedOut) return true;
    return rectWithin(frame, box, 0.02);
  });
}

function assetCountFit(used: number, remaining: number): number {
  if (used === 0) return remaining === 0 ? 1 : 0.5;
  const leftover = remaining - used;
  if (leftover === 0) return 1;
  if (leftover === 1) return 0.68;
  if (leftover === 2) return 0.88;
  return 0.95;
}

function textFit(ctx: TemplateContext, def: TemplateDefinition, remainingTexts: number): number {
  const hosted = ctx.texts.length;
  if (hosted > 0) return def.maxTexts >= hosted ? 1 : 0.3;
  if (remainingTexts > 0) return def.maxTexts > 0 ? 0.6 : 0.45;
  return 0.85;
}

/** Full scoring of one template against one page context (spec 11.3). */
export function evaluateTemplate(
  def: TemplateDefinition,
  ctx: TemplateContext,
  opts: EvaluateOptions,
): Candidate | undefined {
  if (ctx.images.length < def.minImages || ctx.images.length > def.maxImages) return undefined;
  if (ctx.texts.length > def.maxTexts) return undefined;
  if (!def.accepts(ctx)) return undefined;
  if (!rhythmAllows(def, opts.rhythm)) return undefined;

  const frames = def.build(ctx);
  if (!geometryValid(frames, ctx)) return undefined;

  const crop = meanCropLoss(frames, opts.byId);
  if (crop > PARAMS.cropLossHardReject) return undefined;

  const components = {
    assetCountFit: assetCountFit(ctx.images.length, opts.remainingImages),
    aspectRatioFit: Math.max(0, Math.min(1, def.aspectFit(ctx))),
    textFit: textFit(ctx, def, opts.remainingTexts),
    rhythmFit: rhythmFit(def, opts.rhythm),
    cropLossFit: Math.max(0, 1 - crop - (crop > PARAMS.cropLossStrongPenalty ? 0.35 : 0)),
    repetitionFit: repetitionFit(def, opts.rhythm),
  };

  const total =
    (components.assetCountFit * SCORE_WEIGHTS.assetCount +
      components.aspectRatioFit * SCORE_WEIGHTS.aspectRatio +
      components.textFit * SCORE_WEIGHTS.text +
      components.rhythmFit * SCORE_WEIGHTS.rhythm +
      components.cropLossFit * SCORE_WEIGHTS.cropLoss +
      components.repetitionFit * SCORE_WEIGHTS.repetition) *
    (opts.weight ?? 1);

  return { def, frames, score: { templateId: def.id, total, ...components } };
}

/** Highest score wins; ties break on template id so output stays deterministic. */
export function bestCandidate(candidates: Candidate[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (
      !best ||
      candidate.score.total > best.score.total + 1e-9 ||
      (Math.abs(candidate.score.total - best.score.total) <= 1e-9 && candidate.def.id < best.def.id)
    ) {
      best = candidate;
    }
  }
  return best;
}
