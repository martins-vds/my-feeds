"""Authentication API routes."""

from typing import Literal
from uuid import UUID
from zoneinfo import available_timezones

from quart import Blueprint, jsonify, redirect, request, url_for
from sqlalchemy.exc import IntegrityError

from app.api.middleware import ConflictError, UnauthorizedError, ValidationError
from app.config.container import get_request_container, get_settings_instance
from app.domain.feed_management.entities.user import User
from app.infrastructure.oauth.oauth_service import OAuthError, OAuthService
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("auth", __name__, url_prefix="/auth")

# Cache available timezones as a frozenset for fast lookup
_VALID_TIMEZONES: frozenset[str] = available_timezones()


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

    Exchanges authorization code for user info. If the user exists in
    the database, sets a full session (returning user). If not, sets
    a pending sign-up session cookie with the OAuth data.
    """
    valid_providers = ("github", "google", "microsoft")

    if provider not in valid_providers:
        raise ValidationError(f"Invalid provider: {provider}")

    # Check for OAuth error
    error = request.args.get("error")
    if error:
        error_description = request.args.get("error_description", "Authorization denied")
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

        # Check if user already exists (no auto-creation)
        existing_user = await container.oauth_service.get_user_by_provider(
            user_info["provider"],
            user_info["provider_id"],
        )

        frontend_url = "/" if settings.is_production else "http://localhost:5173/"
        response = redirect(frontend_url)

        if existing_user:
            # Returning user — set full session
            session_manager.create_session(response, existing_user.id, provider)
        else:
            # New user — set pending sign-up session
            email = user_info.get("email", "")
            if not email:
                raise UnauthorizedError(
                    "OAuth provider did not return an email address. "
                    "Please ensure your email is public or use a different provider."
                )
            session_manager.create_pending_session(
                response=response,
                provider=user_info["provider"],
                provider_id=user_info["provider_id"],
                email=email,
                name=user_info.get("name"),
                avatar_url=user_info.get("avatar_url"),
            )

        return response
    except OAuthError as e:
        raise UnauthorizedError(str(e))


@bp.route("/complete-signup", methods=["POST"])
async def complete_signup():
    """Complete sign-up after first OAuth login.

    POST /api/auth/complete-signup

    Reads pending OAuth data from the session cookie, validates the
    submitted name and timezone, creates the user record, and
    establishes a full session.
    """
    # Read pending sign-up data from cookie
    pending = session_manager.get_pending_signup(request)
    if not pending:
        raise UnauthorizedError("No pending sign-up session. Please sign in again.")

    # Parse and validate request body
    body = await request.get_json()
    if not body:
        raise ValidationError("Request body is required")

    # Validate name
    name = (body.get("name") or "").strip()
    if not name:
        raise ValidationError("Display name is required")
    if len(name) > 255:
        raise ValidationError("Display name must be 255 characters or fewer")

    # Validate timezone
    timezone = body.get("timezone", "")
    if not timezone or timezone not in _VALID_TIMEZONES:
        raise ValidationError("Invalid timezone")

    # Validate pending data has required OAuth fields
    email = pending.get("email")
    if not email:
        raise UnauthorizedError("Pending sign-up session is missing email. Please sign in again.")

    container = get_request_container()

    # Check for existing user (race condition / duplicate tab)
    existing = await container.oauth_service.get_user_by_provider(
        pending["provider"],
        pending["provider_id"],
    )
    if existing:
        raise ConflictError("Account already exists. Redirecting to sign-in.")

    # Create user via repository
    from app.config.container import create_user_repository

    user_repository = create_user_repository(container.session)
    user = User.from_oauth(
        provider=pending["provider"],
        provider_id=pending["provider_id"],
        email=email,
        name=name,
        avatar_url=pending.get("avatar_url"),
    )
    user.timezone = timezone

    try:
        saved_user = await user_repository.save(user)
        await container.session.commit()
    except IntegrityError:
        await container.session.rollback()
        raise ConflictError("Account already exists. Redirecting to sign-in.")

    # Replace pending cookie with full session
    response_data = {
        "authenticated": True,
        "user": {
            "id": str(saved_user.id),
            "email": saved_user.email,
            "name": saved_user.name,
            "avatarUrl": saved_user.avatar_url,
            "provider": saved_user.provider,
            "timezone": saved_user.timezone,
        },
    }

    response = jsonify(response_data)
    response.status_code = 201
    session_manager.create_session(response, saved_user.id, pending["provider"])

    return response


@bp.route("/me")
async def me():
    """Get current authenticated user or pending sign-up status.

    GET /api/auth/me

    Returns one of three states:
    - Fully authenticated: {authenticated: true, user: {...}}
    - Pending sign-up: {pending_signup: true, profile: {...}}
    - No session: 401
    """
    # Check for pending sign-up first
    pending = session_manager.get_pending_signup(request)
    if pending:
        return jsonify(
            {
                "pending_signup": True,
                "profile": {
                    "email": pending.get("email", ""),
                    "name": pending.get("name"),
                    "avatarUrl": pending.get("avatar_url"),
                    "provider": pending.get("provider", ""),
                },
            }
        )

    # Check for fully authenticated session
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
