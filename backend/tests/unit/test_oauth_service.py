"""Unit tests for OAuth service.

TDD: Written FIRST - must FAIL until implementation is complete.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


class TestOAuthService:
    """Tests for OAuthService class."""

    @pytest.mark.asyncio
    async def test_get_authorization_url_github(self):
        """Should generate GitHub authorization URL with correct parameters."""
        # Import will fail until implementation exists
        from app.infrastructure.oauth.oauth_service import OAuthService

        service = OAuthService()
        url = await service.get_authorization_url(
            "github", "http://localhost:5000/api/auth/github/callback"
        )

        assert "github.com" in url
        assert "client_id" in url
        assert "redirect_uri" in url
        assert "scope" in url

    @pytest.mark.asyncio
    async def test_get_authorization_url_google(self):
        """Should generate Google authorization URL with correct parameters."""
        from app.infrastructure.oauth.oauth_service import OAuthService

        service = OAuthService()
        url = await service.get_authorization_url(
            "google", "http://localhost:5000/api/auth/google/callback"
        )

        assert "accounts.google.com" in url or "googleapis.com" in url
        assert "client_id" in url

    @pytest.mark.asyncio
    async def test_get_authorization_url_microsoft(self):
        """Should generate Microsoft authorization URL with correct parameters."""
        from app.infrastructure.oauth.oauth_service import OAuthService

        service = OAuthService()
        url = await service.get_authorization_url(
            "microsoft", "http://localhost:5000/api/auth/microsoft/callback"
        )

        assert "login.microsoftonline.com" in url or "microsoft" in url.lower()
        assert "client_id" in url

    @pytest.mark.asyncio
    async def test_get_authorization_url_invalid_provider_raises(self):
        """Should raise ValueError for invalid provider."""
        from app.infrastructure.oauth.oauth_service import OAuthService

        service = OAuthService()

        with pytest.raises(ValueError, match="Invalid provider"):
            await service.get_authorization_url(
                "invalid", "http://localhost:5000/callback"
            )

    @pytest.mark.asyncio
    async def test_exchange_code_for_user_github(self):
        """Should exchange OAuth code for user info from GitHub."""
        from app.infrastructure.oauth.oauth_service import OAuthService

        service = OAuthService()

        # Mock the HTTP client
        with patch.object(
            service, "_fetch_token", new_callable=AsyncMock
        ) as mock_token:
            with patch.object(
                service, "_fetch_user_info", new_callable=AsyncMock
            ) as mock_user:
                mock_token.return_value = {"access_token": "test_token"}
                mock_user.return_value = {
                    "id": "12345",
                    "email": "test@example.com",
                    "name": "Test User",
                    "avatar_url": "https://example.com/avatar.png",
                }

                user_info = await service.exchange_code_for_user(
                    "github",
                    "test_code",
                    "http://localhost:5000/api/auth/github/callback",
                )

                assert user_info["provider_id"] == "12345"
                assert user_info["email"] == "test@example.com"
                assert user_info["name"] == "Test User"

    @pytest.mark.asyncio
    async def test_exchange_code_invalid_code_raises(self):
        """Should raise exception for invalid OAuth code."""
        from app.infrastructure.oauth.oauth_service import OAuthService, OAuthError

        service = OAuthService()

        with patch.object(
            service, "_fetch_token", new_callable=AsyncMock
        ) as mock_token:
            mock_token.side_effect = OAuthError("Invalid code")

            with pytest.raises(OAuthError):
                await service.exchange_code_for_user(
                    "github",
                    "invalid_code",
                    "http://localhost:5000/api/auth/github/callback",
                )


class TestUserFromOAuth:
    """Tests for creating/updating users from OAuth data."""

    @pytest.mark.asyncio
    async def test_creates_new_user_if_not_exists(self):
        """Should create a new user if provider_id doesn't exist."""
        from app.infrastructure.oauth.oauth_service import OAuthService
        from app.domain.feed_management.repositories.user_repository import (
            UserRepository,
        )

        mock_repo = AsyncMock(spec=UserRepository)
        mock_repo.get_by_provider.return_value = None
        mock_repo.save.return_value = MagicMock(id=uuid4())

        service = OAuthService(user_repository=mock_repo)

        user = await service.get_or_create_user(
            {
                "provider": "github",
                "provider_id": "12345",
                "email": "new@example.com",
                "name": "New User",
                "avatar_url": None,
            }
        )

        mock_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_existing_user_if_exists(self):
        """Should return existing user if provider_id matches."""
        from app.infrastructure.oauth.oauth_service import OAuthService
        from app.domain.feed_management.repositories.user_repository import (
            UserRepository,
        )

        existing_user = MagicMock(id=uuid4(), email="existing@example.com")
        mock_repo = AsyncMock(spec=UserRepository)
        mock_repo.get_by_provider.return_value = existing_user

        service = OAuthService(user_repository=mock_repo)

        user = await service.get_or_create_user(
            {
                "provider": "github",
                "provider_id": "12345",
                "email": "existing@example.com",
                "name": "Existing User",
                "avatar_url": None,
            }
        )

        assert user == existing_user
        mock_repo.save.assert_not_called()
