"""Conditional-GET (ETag) helpers for JSON read endpoints.

`conditional_json` attaches a strong ETag to a freshly-built JSON body and
returns 304 Not Modified when the caller's If-None-Match already matches, so
unchanged responses are not re-transferred. `Cache-Control: private, no-cache`
means the browser stores the representation but always revalidates.
"""

import hashlib
import json
from typing import Any, Awaitable, Callable

from quart import Response, request

CACHE_CONTROL = "private, no-cache"


def _canonical(body: Any) -> bytes:
    """Deterministic JSON bytes (sorted keys, compact) for stable hashing."""
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()


def _strong_etag(payload: bytes) -> str:
    return '"' + hashlib.sha256(payload).hexdigest()[:16] + '"'


def _json_response(payload: bytes, etag: str) -> Response:
    resp = Response(payload, status=200, content_type="application/json")
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = CACHE_CONTROL
    return resp


def _not_modified(etag: str) -> Response:
    resp = Response(b"", status=304)
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = CACHE_CONTROL
    return resp


async def conditional_json(build_body: Callable[[], Awaitable[Any]]) -> Response:
    """Build a JSON body, attach a strong ETag, and 304 when If-None-Match matches.

    Args:
        build_body: async callable returning a JSON-serializable object.

    Returns:
        A 200 response with the canonical JSON body + ETag, or a 304 with an
        empty body when the request's If-None-Match equals the current ETag.
    """
    body = await build_body()
    payload = _canonical(body)
    etag = _strong_etag(payload)
    if request.headers.get("If-None-Match") == etag:
        return _not_modified(etag)
    return _json_response(payload, etag)
