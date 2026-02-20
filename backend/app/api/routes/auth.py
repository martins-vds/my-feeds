"""Authentication API routes."""

from typing import Literal
from uuid import UUID

from quart import Blueprint, redirect, request, jsonify, url_for

from app.api.middleware import UnauthorizedError, ValidationError
from app.config.container import get_request_container, get_settings_instance
from app.infrastructure.oauth.oauth_service import OAuthService, OAuthError
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("auth", __name__, url_prefix="/auth")


def get_redirect_uri(provider: str) -> str:
    """Build the OAuth callback redirect URI."""
    # In production, use absolute URL from settings
    return url_for("api.auth.callback", provider=provider, _external=True)


@bp.route("/login/<provider>")
async def login(provider: str):
    """Initiate OAuth login flow.

    GET /api/auth/login/{provider}

    Redirects to OAuth provider's authorization page.
    """
    valid_providers = ("github", "google", "microsoft")

    if provider not in valid_providers:
        raise ValidationError(
            f"Invalid provider: {provider}. Must be one of: {', '.join(valid_providers)}"
        )

    oauth_service = OAuthService()
    try:
        redirect_uri = get_redirect_uri(provider)
        auth_url = await oauth_service.get_authorization_url(
            provider,  # type: ignore
            redirect_uri,
        )
        return redirect(auth_url)
    finally:
        await oauth_service.close()


@bp.route("/<provider>/callback")
async def callback(provider: str):
    """Handle OAuth callback.

    GET /api/auth/{provider}/callback

    Exchanges authorization code for user info and creates session.
    """
    valid_providers = ("github", "google", "microsoft")

    if provider not in valid_providers:
        raise ValidationError(f"Invalid provider: {provider}")

    # Check for OAuth error
    error = request.args.get("error")
    if error:
        error_description = request.args.get(
            "error_description", "Authorization denied"
        )
        raise UnauthorizedError(f"OAuth error: {error_description}")

    # Get authorization code
    code = request.args.get("code")
    if not code:
        raise ValidationError("Missing authorization code")

    container = get_request_container()
    settings = get_settings_instance()
    
    try:
        redirect_uri = get_redirect_uri(provider)

        # Exchange code for user info
        user_info = await container.oauth_service.exchange_code_for_user(
            provider,  # type: ignore
            code,
            redirect_uri,
        )

        # Get or create user
        user = await container.oauth_service.get_or_create_user(user_info)

        # Create session and redirect to frontend
        frontend_url = "/" if settings.is_production else "http://localhost:5173/"
        response = redirect(frontend_url)
        session_manager.create_session(response, user.id, provider)

        return response
    except OAuthError as e:
        raise UnauthorizedError(str(e))


@bp.route("/me")
async def me():
    """Get current authenticated user.

    GET /api/auth/me

    Returns:
        User data if authenticated, 401 otherwise.
    """
    user_id = session_manager.get_user_id(request)

    if not user_id:
        raise UnauthorizedError("Not authenticated")

    from app.config.container import create_user_repository
    container = get_request_container()
    user_repository = create_user_repository(container.session)
    user = await user_repository.get_by_id(user_id)

    if not user:
        raise UnauthorizedError("User not found")

    return jsonify(
        {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "avatarUrl": user.avatar_url,
            "provider": user.provider,
            "timezone": user.timezone,
            "notificationsEnabled": user.notifications_enabled,
        }
    )


@bp.route("/logout", methods=["POST"])
async def logout():
    """Log out current user.

    POST /api/auth/logout

    Clears the session cookie.
    """
    response = jsonify({"message": "Logged out successfully"})
    session_manager.clear_session(response)
    return response
