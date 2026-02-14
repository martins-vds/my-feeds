"""Audio API routes for TTS operations."""

import mimetypes
from pathlib import Path
from uuid import UUID

from quart import Blueprint, jsonify, request, Response, send_file

from app.api.middleware import UnauthorizedError, ValidationError
from app.application.services.audio_service import AudioStatus
from app.config.container import get_request_container
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("audio", __name__)


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
            return jsonify({
                "postId": str(post_id),
                "status": "ready",
                "url": result.url,
                "durationSeconds": result.duration_seconds,
                "format": "mp3",
            }), 200

        elif result.status == AudioStatus.GENERATING:
            return jsonify({
                "postId": str(post_id),
                "status": "generating",
                "estimatedSeconds": result.estimated_seconds or 5,
            }), 202

        else:  # ERROR
            return jsonify({
                "error": result.error or "Audio generation failed",
            }), 500

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
    container = get_request_container()
    audio_service = container.audio_service

    # Get file path
    file_path = await audio_service.get_audio_stream_path(cache_key)
    if not file_path or not file_path.exists():
        return jsonify({"error": "Audio not found"}), 404

    file_size = file_path.stat().st_size

    # Check for Range header
    range_header = request.headers.get("Range")
    if range_header:
        return await _handle_range_request(file_path, file_size, range_header)

    # Full file response
    return await send_file(
        file_path,
        mimetype="audio/mpeg",
        as_attachment=False,
    )


async def _handle_range_request(
    file_path: Path,
    file_size: int,
    range_header: str,
) -> Response:
    """Handle HTTP range request for partial content.

    Args:
        file_path: Path to audio file
        file_size: Total file size in bytes
        range_header: Range header value (e.g., "bytes=0-1023")

    Returns:
        206 Partial Content response
    """
    # Parse range header
    try:
        range_spec = range_header.replace("bytes=", "")
        start_str, end_str = range_spec.split("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
    except (ValueError, IndexError):
        # Invalid range format, return full file
        return await send_file(file_path, mimetype="audio/mpeg")

    # Validate range
    if start >= file_size:
        return Response(
            "Range not satisfiable",
            status=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    end = min(end, file_size - 1)
    length = end - start + 1

    # Read partial content
    with open(file_path, "rb") as f:
        f.seek(start)
        data = f.read(length)

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
