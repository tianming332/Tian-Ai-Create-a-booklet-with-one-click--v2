import type { Density } from '../../shared/types';
import type { RhythmState, TemplateDefinition } from './types';

export function initialRhythm(): RhythmState {
  return {
    recentTemplateIds: [],
    recentDensities: [],
    consecutiveText: 0,
    lastPanoramaPage: -99,
    pageIndex: 0,
  };
}

const isTextTemplate = (def: TemplateDefinition) => def.tags.includes('text') && def.maxImages === 0;

/**
 * Hard rhythm rules (spec 12.2). These veto a template outright so the book
 * never repeats the same page shape three times in a row.
 */
export function rhythmAllows(def: TemplateDefinition, state: RhythmState): boolean {
  const recent = state.recentTemplateIds;
  const lastTwoSame = recent.length >= 2 && recent[0] === def.id && recent[1] === def.id;
  if (lastTwoSame) return false;

  const denseRun = state.recentDensities.slice(0, 2).filter((d) => d >= 4).length;
  if (def.density >= 4 && denseRun >= 2) return false;

  if (def.tags.includes('panorama') && state.pageIndex - state.lastPanoramaPage <= 3) return false;

  if (isTextTemplate(def) && state.consecutiveText >= 2) return false;

  return true;
}

/** Soft preference for contrast against the previous pages, 0..1. */
export function rhythmFit(def: TemplateDefinition, state: RhythmState): number {
  const lastDensity: Density | undefined = state.recentDensities[0];
  if (lastDensity == null) {
    // Openers read better calm.
    return def.density <= 2 ? 0.9 : 0.6;
  }
  const delta = Math.abs(def.density - lastDensity);
  let fit = delta === 0 ? 0.45 : Math.min(1, 0.6 + delta * 0.18);

  if (state.recentTemplateIds[0] === def.id) fit -= 0.2;
  if (lastDensity >= 4 && def.density <= 2) fit += 0.12;
  if (state.recentTemplateIds[0] === 'T09' && (def.tags.includes('hero') || def.tags.includes('quiet'))) {
    fit += 0.15;
  }
  if (isTextTemplate(def) && state.consecutiveText >= 1) fit -= 0.25;
  return Math.max(0, Math.min(1, fit));
}

/** Repetition penalty component (spec 11.3, weight 0.05). */
export function repetitionFit(def: TemplateDefinition, state: RhythmState): number {
  const window = state.recentTemplateIds.slice(0, 4);
  const hits = window.filter((id) => id === def.id).length;
  return Math.max(0, 1 - hits * 0.45);
}

export function pushRhythm(state: RhythmState, def: TemplateDefinition, pages: number): RhythmState {
  return {
    recentTemplateIds: [def.id, ...state.recentTemplateIds].slice(0, 6),
    recentDensities: [def.density, ...state.recentDensities].slice(0, 6),
    consecutiveText: isTextTemplate(def) ? state.consecutiveText + 1 : 0,
    lastPanoramaPage: def.tags.includes('panorama') ? state.pageIndex : state.lastPanoramaPage,
    pageIndex: state.pageIndex + pages,
  };
}
