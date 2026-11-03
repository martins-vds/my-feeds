import type { WordTiming } from "../types";

/** The speed (words per minute) the synthetic timings are built at; the pacer's rate scales it. */
export const BASE_WPM = 250;

const MIN_LENGTH_FACTOR = 0.5;
const MAX_LENGTH_FACTOR = 2.5;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:\u2014\u2013]["'”’)\]]*$/;

/** 1 for a five-letter word; shorter words go quicker and longer ones slower, within bounds. */
function lengthFactor(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  return Math.min(MAX_LENGTH_FACTOR, Math.max(MIN_LENGTH_FACTOR, 0.4 + 0.6 * (letters / 5)));
}

/** Extra beats spent after the word: a full beat after a sentence, half a beat after a clause. */
function pauseBeats(word: string): number {
  if (SENTENCE_END.test(word)) return 1;
  if (CLAUSE_END.test(word)) return 0.5;
  return 0;
}

/**
 * Synthetic, contiguous word timings for silent reading, so the read-along
 * highlighter can run without audio. Each word gets one beat (60000 / baseWpm ms)
 * scaled by its length, plus a pause after sentence and clause punctuation.
 * `words` are the whitespace-delimited tokens from `collectWords`.
 */
export function buildPacedTimings(words: readonly string[], baseWpm: number): WordTiming[] {
  const beatMs = 60000 / baseWpm;
  let startMs = 0;
  return words.map((text) => {
    const durationMs = Math.round(beatMs * (lengthFactor(text) + pauseBeats(text)));
    const timing = { text, startMs, durationMs };
    startMs += durationMs;
    return timing;
  });
}
