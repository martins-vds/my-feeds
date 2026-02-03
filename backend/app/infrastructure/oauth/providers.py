"""OAuth provider configurations."""

from dataclasses import dataclass
from typing import Literal

from app.config.settings import get_settings


@dataclass
class OAuthProviderConfig:
    """Configuration for an OAuth provider."""

    name: Literal["github", "google", "microsoft"]
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    scopes: list[str]


def get_github_config() -> OAuthProviderConfig:
    """Get GitHub OAuth configuration."""
    settings = get_settings()
    return OAuthProviderConfig(
        name="github",
        client_id=settings.github_client_id,
        client_secret=settings.github_client_secret,
        authorize_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        userinfo_url="https://api.github.com/user",
        scopes=["read:user", "user:email"],
    )


def get_google_config() -> OAuthProviderConfig:
    """Get Google OAuth configuration."""
    settings = get_settings()
    return OAuthProviderConfig(
        name="google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
        token_url="https://oauth2.googleapis.com/token",
        userinfo_url="https://www.googleapis.com/oauth2/v2/userinfo",
        scopes=["openid", "email", "profile"],
    )


def get_microsoft_config() -> OAuthProviderConfig:
    """Get Microsoft OAuth configuration."""
    settings = get_settings()
    return OAuthProviderConfig(
        name="microsoft",
        client_id=settings.microsoft_client_id,
        client_secret=settings.microsoft_client_secret,
        authorize_url="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
        userinfo_url="https://graph.microsoft.com/v1.0/me",
        scopes=["openid", "email", "profile", "User.Read"],
    )


def get_provider_config(
    provider: Literal["github", "google", "microsoft"],
) -> OAuthProviderConfig:
    """Get OAuth configuration for the specified provider.

    Args:
        provider: The OAuth provider name

    Returns:
        Provider configuration

    Raises:
        ValueError: If provider is not supported
    """
    configs = {
        "github": get_github_config,
        "google": get_google_config,
        "microsoft": get_microsoft_config,
    }

    if provider not in configs:
        raise ValueError(f"Invalid provider: {provider}")

    return configs[provider]()
