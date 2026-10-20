"""Audio API routes for TTS operations."""

import re
from uuid import UUID

from quart import Blueprint, Response, jsonify, request

from app.api.middleware import UnauthorizedError
from app.application.services.audio_service import AudioStatus
from app.config.container import get_request_container
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("audio", __name__)

# Cache keys are SHA-256 hex digests (see AudioCacheManager.generate_cache_key).
# Validating the shape before the key is joined into a filesystem path prevents
# path-traversal via a crafted key on the public /audio/<cache_key> route.
_CACHE_KEY_RE = re.compile(r"^[0-9a-f]{64}$")


def get_current_user_id() -> UUID:
    """Get the current authenticated user's ID from session.

    Returns:
        The user's UUID

    Raises:
        UnauthorizedError: If not authenticated
    """
    user_id = session_manager.get_current_user_id()
    if user_id is None:
        raise UnauthorizedError("Authentication required")
    return user_id


@bp.route("/posts/<uuid:post_id>/audio", methods=["GET"])
async def get_post_audio(post_id: UUID):
    """Get or generate audio for a post.

    GET /api/posts/{postId}/audio

    Returns:
        200: Audio ready - { postId, status: "ready", url, durationSeconds, format }
        202: Audio generating - { postId, status: "generating", estimatedSeconds }
        401: Unauthorized
        404: Post not found or not accessible
    """
    user_id = get_current_user_id()
    container = get_request_container()
    audio_service = container.audio_service

    try:
        result = await audio_service.get_or_generate_audio(post_id, user_id)

        if result.status == AudioStatus.READY:
            body = {
                "postId": str(post_id),
                "status": "ready",
                "url": result.url,
                "durationSeconds": result.duration_seconds,
                "format": "mp3",
            }
            # Include ordered word timings only when a valid sidecar exists;
            # omit the field entirely otherwise (never null/[]).
            if result.word_timings:
                body["wordTimings"] = result.word_timings
            return jsonify(body), 200

        elif result.status == AudioStatus.GENERATING:
            return jsonify(
                {
                    "postId": str(post_id),
                    "status": "generating",
                    "estimatedSeconds": result.estimated_seconds or 5,
                }
            ), 202

        else:  # ERROR
            return jsonify(
                {
                    "error": result.error or "Audio generation failed",
                }
            ), 500

    except ValueError:
        return jsonify({"error": "Post not found"}), 404


@bp.route("/audio/<cache_key>", methods=["GET"])
async def stream_audio(cache_key: str):
    """Stream audio file with range request support.

    GET /api/audio/{cacheKey}

    Headers:
        Range: bytes=0-1023 (optional, for partial content)

    Returns:
        200: Full audio file (audio/mpeg)
        206: Partial content with Content-Range header
        404: Audio not found
    """
    # Cache keys are always SHA-256 hex; reject anything else up front so a
    # crafted key cannot escape the cache directory (path traversal) when it is
    # joined into the on-disk file path.
    if not _CACHE_KEY_RE.fullmatch(cache_key):
        return jsonify({"error": "Audio not found"}), 404

    container = get_request_container()
    audio_service = container.audio_service

    audio_data = await audio_service.get_audio_stream_data(cache_key)
    if audio_data is None:
        return jsonify({"error": "Audio not found"}), 404

    # Check for Range header
    range_header = request.headers.get("Range")
    if range_header:
        return _handle_range_request(audio_data, range_header)

    return Response(
        audio_data,
        mimetype="audio/mpeg",
        headers={"Accept-Ranges": "bytes"},
    )


def _handle_range_request(audio_data: bytes, range_header: str) -> Response:
    """Handle HTTP range request for partial content.

    Args:
        audio_data: Complete audio file
        range_header: Range header value (e.g., "bytes=0-1023")

    Returns:
        206 Partial Content response
    """
    file_size = len(audio_data)

    # Parse range header
    try:
        range_spec = range_header.replace("bytes=", "")
        start_str, end_str = range_spec.split("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
    except (ValueError, IndexError):
        # Invalid range format, return full file
        return Response(audio_data, mimetype="audio/mpeg")

    # Validate range
    if start >= file_size:
        return Response(
            "Range not satisfiable",
            status=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    end = min(end, file_size - 1)
    length = end - start + 1

    data = audio_data[start : end + 1]

    # Build response
    response = Response(
        data,
        status=206,
        mimetype="audio/mpeg",
    )
    response.headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    response.headers["Content-Length"] = str(length)
    response.headers["Accept-Ranges"] = "bytes"

    return response
