/**
 * Read-along alignment: normalize tokens and sequence-align the spoken
 * (timing) tokens to the displayed words so the highlighter knows which word
 * maps to each timing entry. Decided up-front with a >=90% gate so highlighting
 * is either on for the whole post or silently disabled (no flicker).
 */

export interface AlignmentResult {
    /** True iff >=90% of spoken tokens aligned in order and no over-long mismatch run. */
    enabled: boolean;
    /** For each timing index, the display-word index to highlight (-1 if unmapped). */
    timingToDisplay: Int32Array;
    /** Fraction of (non-empty) spoken tokens that aligned. */
    matchedRatio: number;
}

// Bounded forward look-ahead on the display side (lets us skip a few
// non-spoken/punctuation display tokens without an expensive full DP).
const LOOKAHEAD = 12;
// A run of this many consecutive unmatched spoken tokens means the sequences
// have diverged structurally — disable highlighting even if the ratio is high.
const MAX_MISS_RUN = 8;

/**
 * Normalize a word for comparison: lowercase, strip leading/trailing
 * punctuation, but keep internal apostrophes/hyphens and digits (so
 * ``don't``, ``well-known`` and ``2024`` compare correctly).
 */
export function normalizeToken(raw: string): string {
    return raw
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * Greedy linear alignment of spoken tokens to display tokens. The display side
 * may skip non-spoken tokens (punctuation nodes normalized to ""); the spoken
 * side advances one token at a time.
 *
 * @param spoken  Normalized timing tokens, in spoken order.
 * @param display Normalized display tokens (title words then body words).
 */
export function alignSpokenToDisplay(
    spoken: string[],
    display: string[]
): AlignmentResult {
    const timingToDisplay = new Int32Array(spoken.length).fill(-1);
    let d = 0;
    let matched = 0;
    let spokenCount = 0;
    let missRun = 0;
    let diverged = false;

    for (let s = 0; s < spoken.length; s++) {
        const token = spoken[s];
        if (!token) continue; // empty spoken token — never emitted, ignore
        spokenCount++;

        let found = -1;
        const limit = Math.min(display.length, d + LOOKAHEAD + 1);
        for (let scan = d; scan < limit; scan++) {
            if (display[scan] === token) {
                found = scan;
                break;
            }
        }

        if (found >= 0) {
            timingToDisplay[s] = found;
            d = found + 1;
            matched++;
            missRun = 0;
        } else {
            missRun++;
            if (missRun >= MAX_MISS_RUN) diverged = true;
        }
    }

    const matchedRatio = spokenCount > 0 ? matched / spokenCount : 0;
    const enabled = matchedRatio >= 0.9 && !diverged;
    return { enabled, timingToDisplay, matchedRatio };
}
