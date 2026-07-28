# Contract: Audio API (word timings)

**Feature**: `003-read-along-highlight` | Endpoint owner: [backend/app/api/routes/audio.py](../../../backend/app/api/routes/audio.py)

This feature extends the **existing** audio metadata endpoint. Only the additive change is normative here; all other behavior (auth, 202 generating, streaming, range requests) is unchanged (NFR-003).

---

## GET `/api/posts/{postId}/audio`

Get or generate audio for a post. **Additive change**: the `ready` response MAY include an ordered `wordTimings` array.

### Request
- Path: `postId` (UUID).
- Auth: session required (unchanged). `401` if unauthenticated.

### Responses

**200 — ready** (augmented):
```json
{
  "postId": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "status": "ready",
  "url": "/api/audio/9f86d0818988...<64 hex>",
  "durationSeconds": 123.4,
  "format": "mp3",
  "wordTimings": [
    { "text": "Hello", "startMs": 120, "durationMs": 300 },
    { "text": "world", "startMs": 430, "durationMs": 280 }
  ]
}
```

Rules for `wordTimings`:
1. **Present** only when a valid timings sidecar exists for the clip's `cache_key`.
2. **Omitted entirely** when timings are missing, empty, unparseable, or non-conforming (client treats omission as "highlighting disabled"). The server MUST NOT emit `null` or an empty array to signal "unusable".
3. Order is spoken order: title words first, then body words.
4. Each entry conforms to [word-timings.schema.json](word-timings.schema.json) `words[]` (`text: string`, `startMs: integer ≥ 0`, `durationMs: integer ≥ 0`).
5. Adding this field MUST NOT meaningfully slow the response for typical articles (NFR-004) — it is a single small sidecar read.

**202 — generating**, **401**, **404**, **500**: unchanged from current behavior.

### Contract tests (backend, `tests/contract/test_audio.py`)
- READY response includes `wordTimings` (ordered, correct shape) when a sidecar is present.
- READY response **omits** `wordTimings` when no sidecar / corrupt sidecar exists (never `null`/`[]`).
- Existing assertions still hold: `status`, `url`, `postId`, `durationSeconds`, `format`; `401` without auth; `404` for unknown post.
- Response time for a large-timing clip stays within the existing latency envelope (smoke assertion for NFR-004).

---

## GET `/api/audio/{cacheKey}` (unchanged)

Streams the MP3 with range support. **No change** in this feature.

---

## Alternative (documented, not implemented): GET `/api/audio/{cacheKey}/timings`

The spec permits an adjacent endpoint keyed by cache key returning `{ words: [...] }` (the sidecar body). Not implemented now (inline delivery chosen — see [research.md](../research.md) §3). If added later: `200` with the sidecar JSON when present, `404` when absent; no auth coupling to post ownership beyond what streaming already assumes.
