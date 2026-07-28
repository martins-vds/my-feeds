# Contract: TTS Service (timing capture) & generation path

**Feature**: `003-read-along-highlight`
**Owners**: [tts_service.py](../../../backend/app/domain/audio/services/tts_service.py) (ABC), [edge_tts_service.py](../../../backend/app/infrastructure/tts/edge_tts_service.py), [azure_tts.py](../../../backend/app/infrastructure/tts/azure_tts.py), [mock_tts.py](../../../backend/app/infrastructure/tts/mock_tts.py), [audio_service.py](../../../backend/app/application/services/audio_service.py), [cache_manager.py](../../../backend/app/infrastructure/tts/cache_manager.py), [audio_generation.py](../../../backend/app/infrastructure/jobs/audio_generation.py)

---

## 1. `TTSService` ABC — new capability

Add one abstract method that synthesizes **and** returns ordered timings. The existing `synthesize(text, output_path) -> None` remains (delegates to the new method, discarding timings) so any other caller is unaffected.

```python
class TTSService(ABC):
    @abstractmethod
    async def synthesize_with_timings(
        self, text: str, output_path: Path
    ) -> list[WordTiming]:
        """Synthesize `text` to an MP3 at `output_path` and return ordered
        WordTiming value objects (title-then-body spoken order).

        - Returns an empty list if the engine emits no word boundaries.
        - Raises TTSError if synthesis fails or produces no audio (unchanged).
        - `WordTiming.text` is the engine source token; offsets/durations in ms.
        """
```

`strip_html` change (FR-026): replace each tag with a **single space** before collapsing whitespace, so `for<code>x</code>loop` → `for x loop`.

### Implementations
| Impl              | Timing source                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EdgeTTSService`  | Iterate `communicate.stream()`; write `chunk["data"]` for `type == "audio"`; collect `type == "WordBoundary"` → `WordTiming(text=chunk["text"], start_ms=chunk["offset"]//10_000, duration_ms=chunk["duration"]//10_000)`. Preserve the "produced no audio" empty-file guard. |
| `AzureTTSService` | Register `synthesizer.synthesis_word_boundary` handler; collect events into `WordTiming` (Azure offsets are 100-ns ticks → ms). Keep parity so a keyed Azure deployment also yields timings.                                                                                  |
| `MockTTSService`  | Produce **deterministic** synthetic timings from the cleaned tokens (e.g. 300 ms/word, 50 ms gaps) so unit/contract tests can assert exact values; still writes a decodable silent MP3.                                                                                       |

### Unit tests (`tests/unit/test_tts_service.py`)
- edge-tts stream parsing maps `WordBoundary` → ordered `WordTiming` with source-token text and ms offsets (mock the `edge_tts.Communicate.stream` async iterator).
- Empty/whitespace text → `TTSError` (unchanged); zero boundaries → empty list, MP3 still written.
- `strip_html` inserts a space at tag boundaries (no `forxloop`) and collapses runs of whitespace.
- Mock returns deterministic, ordered, non-overlapping timings.

---

## 2. Generation path — capture, persist, timings-aware short-circuit

### `AudioCacheManager` (sidecar I/O)
Add sidecar helpers that mirror the MP3 path (`.json` extension):
```
get_timings_path(cache_key) -> Path            # <dir>/<key[:2]>/<key>.json
save_timings(cache_key, payload: dict) -> None # atomic write (temp + rename)
load_timings(cache_key) -> dict | None         # None on missing/invalid JSON/shape
exists_timings(cache_key) -> bool
delete_timings(cache_key) -> bool
```
- Construct `payload` as `{ "schemaVersion": 1, "voiceId": <voice>, "words": [ {text,startMs,durationMs}... ] }` (see [word-timings.schema.json](word-timings.schema.json)).
- Cleanup (`cleanup_old_files` / orphan reclamation) also removes `.json` files with no live clip, in lockstep with `.mp3`.

### Cache version
- Add `audio_cache_version: str = "v2"` to settings; `create_cache_manager` passes it into `AudioCacheManager(cache_version=...)` (today the `"v1"` default is never overridden). Bumping the value rotates every deterministic cache key.

### `AudioService._generate_audio`
1. `text = f"{title}. {content or ''}".strip()` (unchanged).
2. `cache_key = cache.generate_cache_key(text, tts.voice_id)` (now version-aware).
3. `timings = await tts.synthesize_with_timings(text, output_path)`.
4. If `timings` non-empty: `cache.save_timings(cache_key, payload)` and set `audio.has_timings = True`; else `has_timings = False`.
5. Persist the audio row (replace existing row for the post, as today).

### Timings-aware short-circuit (`get_or_generate_audio`, `generate_for_post`)
Return the cached READY result **only when** `existing_audio and cache.exists(existing_audio.cache_key) and cache.exists_timings(existing_audio.cache_key)`. Otherwise fall through and regenerate (this is what forces backfill after the version bump, since the stored key's MP3 alone would otherwise short-circuit).

### Background job (`audio_generation.py`)
Broaden selection to include timing-less clips and preserve idempotency:
```sql
-- before: WHERE audio.id IS NULL
-- after:  WHERE audio.id IS NULL OR audio.has_timings = false
```
Keep content-non-empty filter, batch size, per-post commit, and `published_at DESC` ordering. Clips with `has_timings = true` are skipped (idempotent re-runs).

### Tests
- **Unit `test_word_timings_store`** (new): save/load/exists/delete sidecar; path derivation; corrupt JSON → `load_timings` returns `None`; orphan `.json` cleanup.
- **Unit/integration `audio_service`**: `_generate_audio` writes sidecar + sets `has_timings`; short-circuit regenerates when sidecar missing but returns cached when present; version bump yields a different `cache_key`.
- **Unit `test_audio_generation_job`** (extend): selects audio-less **and** `has_timings=false` posts; skips `has_timings=true`; re-running is idempotent (no duplicate rows/files); never disrupts a working clip.
- **Migration**: applying the Alembic revision adds `has_timings` (default false) and existing rows become backfill-eligible.
