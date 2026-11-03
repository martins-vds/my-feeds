/**
 * The one definition of "how many percent" for reading progress. The UI shows
 * it and the tracker throttles on it, so they can never disagree.
 */

/** Whole percent, 0..100, rounded down. The epsilon absorbs float noise such as 0.29 * 100. */
export function wholePercent(progress: number): number {
  if (Number.isNaN(progress)) return 0;
  return Math.min(100, Math.max(0, Math.floor(progress * 100 + 1e-9)));
}

/** What the UI prints for a started article: never "0%". */
export function displayPercent(progress: number): number {
  return Math.max(1, wholePercent(progress));
}
