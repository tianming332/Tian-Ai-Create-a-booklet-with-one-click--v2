let counter = 0;

/**
 * Deterministic-ish id. Randomness is avoided so that regenerating a layout
 * from identical input produces stable ids within a session (spec 22.1).
 */
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}`;
}

export function resetIdCounter(value = 0): void {
  counter = value;
}
