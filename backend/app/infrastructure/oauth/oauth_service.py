"""OAuth service for authentication with external providers."""

import base64
import hashlib
import secrets
from typing import Any, Literal
from urllib.parse import urlencode

import httpx

from app.domain.feed_management.entities.user import User
from app.domain.feed_management.repositories.user_repository import UserRepository
from app.infrastructure.oauth.providers import OAuthProviderConfig, get_provider_config


class OAuthError(Exception):
    """Exception raised for OAuth-related errors."""

    pass


class OAuthService:
    """Service for OAuth authentication flow."""

    def __init__(self, user_repository: UserRepository | None = None) -> None:
        """Initialize OAuth service.

        Args:
            user_repository: Repository for user persistence
        """
        self._user_repository = user_repository
        self._http_client = httpx.AsyncClient(timeout=30.0)

    async def close(self) -> None:
        """Close HTTP client."""
        await self._http_client.aclose()

    async def get_authorization_url(
        self,
        provider: Literal["github", "google", "microsoft"],
        redirect_uri: str,
        state: str | None = None,
        code_verifier: str | None = None,
    ) -> str:
        """Generate OAuth authorization URL.

        Args:
            provider: OAuth provider name
            redirect_uri: Callback URL after authorization
            state: Browser-bound state issued by SessionManager
            code_verifier: Server-held PKCE verifier for the OAuth transaction

        Returns:
            Authorization URL to redirect user to

        Raises:
            ValueError: If provider is not supported
        """
        config = get_provider_config(provider)

        if state is None:
            state = secrets.token_urlsafe(32)

        params = {
            "client_id": config.client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(config.scopes),
            "state": state,
            "response_type": "code",
        }

        if code_verifier:
            params["code_challenge"] = (
                base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
                .rstrip(b"=")
                .decode("ascii")
            )
            params["code_challenge_method"] = "S256"

        # Google requires additional parameters
        if provider == "google":
            params["access_type"] = "offline"
            params["prompt"] = "consent"

        return f"{config.authorize_url}?{urlencode(params)}"

    async def exchange_code_for_user(
        self,
        provider: Literal["github", "google", "microsoft"],
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
    ) -> dict[str, Any]:
        """Exchange OAuth code for user information.

        Args:
            provider: OAuth provider name
            code: Authorization code from callback
            redirect_uri: Same redirect URI used in authorization
            code_verifier: Verifier resolved from a consumed OAuth transaction

        Returns:
            User information dict with provider_id, email, name, avatar_url

        Raises:
            OAuthError: If token exchange or user info fetch fails
        """
        config = get_provider_config(provider)

        # Exchange code for access token
        token_data = await self._fetch_token(config, code, redirect_uri, code_verifier)
        access_token = token_data.get("access_token") if isinstance(token_data, dict) else None

        if not isinstance(access_token, str) or not access_token:
            raise OAuthError("Failed to obtain access token")

        # Fetch user info
        user_info = await self._fetch_user_info(config, access_token)

        # Normalize user info across providers
        normalized = self._normalize_user_info(provider, user_info, access_token)
        if not isinstance(normalized["email"], str) or any(
            value is not None and not isinstance(value, str)
            for value in (normalized["name"], normalized["avatar_url"])
        ):
            raise OAuthError("Invalid user info response")
        return normalized

    async def _fetch_token(
        self,
        config: OAuthProviderConfig,
        code: str,
        redirect_uri: str,
        code_verifier: str | None = None,
    ) -> dict[str, Any]:
        """Fetch access token from OAuth provider."""
        data = {
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        if code_verifier:
            data["code_verifier"] = code_verifier
        headers = {"Accept": "application/json"}

        try:
            response = await self._http_client.post(
                config.token_url,
                data=data,
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise OAuthError("Token exchange failed") from None

    async def _fetch_user_info(
        self,
        config: OAuthProviderConfig,
        access_token: str,
    ) -> dict[str, Any]:
        """Fetch user info from OAuth provider."""
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            response = await self._http_client.get(
                config.userinfo_url,
                headers=headers,
            )
            response.raise_for_status()
            user_info = response.json()
            if not isinstance(user_info, dict):
                raise OAuthError("Invalid user info response")

            # GitHub: fetch email separately if not in user info
            if config.name == "github" and not user_info.get("email"):
                emails = await self._fetch_github_emails(access_token)
                primary_email = next(
                    (e["email"] for e in emails if e.get("primary")),
                    emails[0]["email"] if emails else None,
                )
                user_info["email"] = primary_email

            return user_info
        except (httpx.HTTPError, ValueError):
            raise OAuthError("User info fetch failed") from None

    async def _fetch_github_emails(self, access_token: str) -> list[dict[str, Any]]:
        """Fetch GitHub user emails."""
        headers = {"Authorization": f"Bearer {access_token}"}
        try:
            response = await self._http_client.get(
                "https://api.github.com/user/emails",
                headers=headers,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError:
            return []

    def _normalize_user_info(
        self,
        provider: Literal["github", "google", "microsoft"],
        user_info: dict[str, Any],
        _access_token: str,
    ) -> dict[str, Any]:
        """Normalize user info from different providers."""
        if (
            not isinstance(user_info, dict)
            or type(user_info.get("id")) not in (str, int)
            or not str(user_info["id"])
        ):
            raise OAuthError("Invalid user info response")
        if provider == "github":
            return {
                "provider": provider,
                "provider_id": str(user_info["id"]),
                "email": user_info.get("email", ""),
                "name": user_info.get("name") or user_info.get("login"),
                "avatar_url": user_info.get("avatar_url"),
            }
        elif provider == "google":
            return {
                "provider": provider,
                "provider_id": str(user_info["id"]),
                "email": user_info.get("email", ""),
                "name": user_info.get("name"),
                "avatar_url": user_info.get("picture"),
            }
        elif provider == "microsoft":
            return {
                "provider": provider,
                "provider_id": str(user_info["id"]),
                "email": user_info.get("mail") or user_info.get("userPrincipalName", ""),
                "name": user_info.get("displayName"),
                "avatar_url": None,  # Microsoft requires separate call for photo
            }
        else:
            raise ValueError(f"Unknown provider: {provider}")

    async def get_or_create_user(self, user_info: dict[str, Any]) -> User:
        """Get existing user or create new one from OAuth data.

        Args:
            user_info: Normalized user info dict

        Returns:
            User entity (existing or newly created)

        Raises:
            ValueError: If user_repository is not configured
        """
        if self._user_repository is None:
            raise ValueError("UserRepository not configured")

        # Try to find existing user
        existing = await self._user_repository.get_by_provider(
            user_info["provider"],
            user_info["provider_id"],
        )

        if existing:
            return existing

        # Create new user
        user = User.from_oauth(
            provider=user_info["provider"],
            provider_id=user_info["provider_id"],
            email=user_info["email"],
            name=user_info.get("name"),
            avatar_url=user_info.get("avatar_url"),
        )
        return await self._user_repository.save(user)

    async def get_user_by_provider(
        self,
        provider: Literal["github", "google", "microsoft"],
        provider_id: str,
    ) -> User | None:
        """Look up a user by their OAuth provider and provider ID.

        Unlike get_or_create_user(), this does NOT create a new user
        if one is not found. Used during the sign-up flow to determine
        if an OAuth identity is new or returning.

        Args:
            provider: OAuth provider name
            provider_id: User ID from the OAuth provider

        Returns:
            User if found, None if no user exists with this provider identity

        Raises:
            ValueError: If user_repository is not configured
        """
        if self._user_repository is None:
            raise ValueError("UserRepository not configured")

        return await self._user_repository.get_by_provider(provider, provider_id)
