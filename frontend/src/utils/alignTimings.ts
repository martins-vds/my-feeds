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

// Re-anchor tuning. Greedy matching can overshoot on repeated phrases (a common
// word matches a later coincidental copy, stranding the real words behind the
// pointer). Once misses pile up we look for a high-confidence resync: a run of
// RESYNC_ANCHOR consecutive exact matches, searched in a bounded window around
// the (overshot) pointer. Only fires while already diverging, so aligned clips
// are never touched.
const RESYNC_AFTER_MISSES = 6;
const RESYNC_ANCHOR = 3;
const RESYNC_BACK = 100;
const RESYNC_FORWARD = 300;

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
 * A spoken token must be at least this many characters before it may match a
 * *sub-word* of a compound display token. Short tokens ("at", "e", "in") occur
 * as substrings of many URLs/symbols and would otherwise match spuriously and
 * drag the alignment forward; requiring length >=3 keeps only high-signal parts
 * (domain names, "www", "com", path segments) — measured to fix hundreds of
 * clips with zero regressions on the current corpus.
 */
const MIN_COMPOUND_MATCH_LEN = 3;

/**
 * Split one displayed word into the sub-words a TTS engine pronounces
 * separately. A bare URL (``www.foo.com/bar``) or a token glued by a symbol
 * (``DALL•E``) renders as a single on-screen word but is spoken as several
 * tokens. Apostrophes and hyphens are kept (internal to ``don't``/``well-known``),
 * matching {@link normalizeToken}, so ordinary words yield just themselves.
 */
function subWords(token: string): string[] {
    return token.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
}

/**
 * Search for a high-confidence resync point: the nearest display index ``p``
 * (in a bounded window around the current pointer ``d``) where ``RESYNC_ANCHOR``
 * consecutive display words exactly equal the next spoken words starting at
 * ``s``. Returns ``p`` (where ``spoken[s]`` re-aligns) or ``-1`` if none.
 *
 * The window reaches *behind* ``d`` because overshoot leaves the real words
 * behind the pointer. Requiring several consecutive matches makes an accidental
 * re-anchor (which would highlight the wrong words) vanishingly unlikely.
 */
function findResyncAnchor(
    spoken: string[],
    display: string[],
    s: number,
    d: number
): number {
    const lo = Math.max(0, d - RESYNC_BACK);
    const hi = Math.min(display.length - RESYNC_ANCHOR, d + RESYNC_FORWARD);
    for (let p = lo; p <= hi; p++) {
        let ok = true;
        for (let k = 0; k < RESYNC_ANCHOR; k++) {
            if (display[p + k] !== spoken[s + k]) {
                ok = false;
                break;
            }
        }
        if (ok) return p;
    }
    return -1;
}

/**
 * Greedy linear alignment of spoken tokens to display tokens. The display side
 * may skip non-spoken tokens (punctuation nodes normalized to ""); the spoken
 * side advances one token at a time.
 *
 * A spoken token first tries an exact display match within the look-ahead
 * window. Failing that, it may match a *compound* display word (a URL or a
 * symbol-glued token like ``DALL•E``) that contains it as a sub-word — the
 * pointer then holds on that word so its remaining spoken parts map to it too.
 * This recovers clips where one on-screen word is spoken as several tokens,
 * without expanding the scan (which would overflow the window when the engine
 * skips a long URL). Ordinary words have no sub-words, so 1:1 posts are
 * unchanged.
 *
 * When misses still pile up (greedy overshoot on repeated phrases), it attempts
 * a bounded, high-confidence re-anchor before giving up, so one bad jump doesn't
 * disable read-along for the whole clip.
 *
 * @param spoken  Normalized timing tokens, in spoken order.
 * @param display Normalized display tokens (title words then body words).
 */
export function alignSpokenToDisplay(
    spoken: string[],
    display: string[]
): AlignmentResult {
    // Precompute the sub-word set for each compound display word (null for
    // ordinary words), so the fallback is O(1) per scan and ordinary posts pay
    // nothing.
    const compoundParts: (Set<string> | null)[] = display.map((tok) => {
        const parts = subWords(tok);
        return parts.length > 1 ? new Set(parts) : null;
    });

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
        let compound = -1;
        const limit = Math.min(display.length, d + LOOKAHEAD + 1);
        for (let i = d; i < limit; i++) {
            if (display[i] === token) {
                found = i;
                break; // exact match wins, nearest first
            }
            if (
                compound < 0 &&
                token.length >= MIN_COMPOUND_MATCH_LEN &&
                compoundParts[i]?.has(token)
            ) {
                compound = i; // remember the first compound sub-word match
            }
        }

        if (found >= 0) {
            timingToDisplay[s] = found;
            d = found + 1;
            matched++;
            missRun = 0;
        } else if (compound >= 0) {
            // Hold on the compound word: later parts of the same URL/name still
            // fall within the window and map here too.
            timingToDisplay[s] = compound;
            d = compound;
            matched++;
            missRun = 0;
        } else {
            missRun++;
            // Try to recover from a greedy overshoot before hard-disabling.
            if (missRun >= RESYNC_AFTER_MISSES && s + RESYNC_ANCHOR <= spoken.length) {
                const anchor = findResyncAnchor(spoken, display, s, d);
                if (anchor >= 0) {
                    timingToDisplay[s] = anchor;
                    d = anchor + 1;
                    matched++;
                    missRun = 0;
                    continue;
                }
            }
            if (missRun >= MAX_MISS_RUN) diverged = true;
        }
    }

    const matchedRatio = spokenCount > 0 ? matched / spokenCount : 0;
    const enabled = matchedRatio >= 0.9 && !diverged;
    return { enabled, timingToDisplay, matchedRatio };
}
