/** Supported audio playback speeds, shared by the inline and floating players. */
export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 1, 1.2, 1.5, 2, 2.5, 3];

/** Silent-reading paces (words per minute) offered by the pacer's speed menu. */
export const WPM_OPTIONS: readonly number[] = [150, 200, 250, 300, 400];

/**
 * Pace a reader starts at, and always one of `WPM_OPTIONS`. It is the user's default, not
 * the pace word timings are built at: that is `BASE_WPM` in `utils/pacedTimings.ts`.
 */
export const DEFAULT_WPM = 250;
