# My Feeds Backend

RSS Feed Reader PWA - Backend API

## Audio (TTS) cache

Generated speech is cached on disk under `audio_cache/<key[:2]>/`:

- `<key>.mp3` — the synthesized clip.
- `<key>.json` — a sidecar with ordered word timings for read-along
  highlighting: `{ "schemaVersion": 1, "voiceId": "...", "words": [ { "text",
  "startMs", "durationMs" } ] }`. Written only when the TTS engine emits word
  boundaries; absent/corrupt sidecars simply disable highlighting for that clip.

The cache key is a SHA-256 of the text, voice, format and a **cache version**.

- `AUDIO_CACHE_VERSION` (default `v2`) — bump this to rotate every cache key,
  e.g. to backfill word timings for clips generated before this feature.
  Combined with the timings-aware short-circuit (a clip is only served from
  cache when both its `.mp3` and `.json` exist) and the background job
  (which selects posts with no audio **or** `audio.has_timings = false`),
  bumping the version regenerates the back catalogue idempotently. Superseded
  old-key files are reclaimed by the periodic cache cleanup.
