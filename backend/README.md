# My Feeds Backend

RSS Feed Reader PWA - Backend API

## Audio (TTS) cache

Generated speech uses a selectable cache provider. `AUDIO_CACHE_PROVIDER`
defaults to `local`, which caches under `AUDIO_CACHE_DIR` (default
`audio_cache/<key[:2]>/`):

- `<key>.mp3` — the synthesized clip.
- `<key>.json` — a sidecar with ordered word timings for read-along
  highlighting: `{ "schemaVersion": 1, "voiceId": "...", "words": [ { "text",
  "startMs", "durationMs" } ] }`. An empty `words` array is also stored when
  synthesis returns no timing boundaries.

Set `AUDIO_CACHE_PROVIDER=azure_blob` to store these objects in Azure Blob
Storage instead. Configure `AZURE_BLOB_SERVICE_URL` with the account endpoint
(for example `https://<account>.blob.core.windows.net`) and
`AZURE_BLOB_CONTAINER_NAME` (default `audio-cache`). Blob keys preserve the
same `<key[:2]>/<key>.mp3` and `.json` layout.

Azure authentication uses `DefaultAzureCredential`: assign the App Service
managed identity the **Storage Blob Data Contributor** role on the cache
container, and use `az login` locally for development. No account key or Azure
Files mount is needed. Audio is staged in a temporary local directory for TTS,
then uploaded; playback reads bytes from the configured provider.

The cache key is a SHA-256 of the text, voice, format and a **cache version**.

- `AUDIO_CACHE_VERSION` (default `v2`) — bump this to rotate every cache key,
  e.g. to backfill word timings for clips generated before this feature.
  Combined with the timings-aware short-circuit (a clip is only served from
  cache when both its `.mp3` and `.json` exist) and the background job
  (which selects posts with no audio **or** `audio.has_timings = false`),
  bumping the version regenerates the back catalogue idempotently. Superseded
  old-key files are reclaimed by the periodic cache cleanup.
