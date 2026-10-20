"""Environment configuration management using pydantic-settings."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Environment
    environment: Literal["development", "testing", "production"] = "development"
    debug: bool = True

    # Server
    host: str = "0.0.0.0"
    port: int = 5000

    # Database
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/myfeeds",
        description="PostgreSQL connection URL with asyncpg driver",
    )

    # Session & Security
    secret_key: str = Field(
        default="change_me_in_production",
        description="Secret key for session signing",
    )

    # OAuth Providers
    github_client_id: str = ""
    github_client_secret: str = ""
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""

    # Public URLs (browser-reachable; used for OAuth callbacks & redirects)
    oauth_redirect_base_url: str = Field(
        default="http://localhost:5000",
        description=(
            "Public base URL of the backend. OAuth callback URIs are built from "
            "it and must match the URI registered with each provider."
        ),
    )
    frontend_url: str = Field(
        default="http://localhost:5173",
        description="Public base URL of the frontend, used for post-login redirects in dev.",
    )

    # Azure Text-to-Speech
    azure_speech_key: str = ""
    azure_speech_region: str = "eastus"

    # Audio Cache
    audio_cache_dir: str = "audio_cache"
    audio_cache_provider: Literal["local", "azure_blob"] = "local"
    azure_blob_service_url: str | None = None
    azure_blob_container_name: str = "audio-cache"
    audio_max_cache_size_mb: int = 1000
    audio_cache_version: str = Field(
        default="v3",
        description=(
            "Version tag hashed into audio cache keys. Bump to rotate every key "
            "(e.g. after changing text preparation). Existing clips are "
            "regenerated lazily on next access when the stored key no longer "
            "matches the current version."
        ),
    )

    # Feed Fetching
    feed_fetch_interval_minutes: int = 15
    feed_max_retries: int = 3

    # Post Retention
    post_retention_days: int = 90

    @model_validator(mode="after")
    def validate_audio_cache_provider(self) -> "Settings":
        """Require Azure Blob configuration when that provider is selected."""
        if self.audio_cache_provider == "azure_blob" and not self.azure_blob_service_url:
            raise ValueError("AZURE_BLOB_SERVICE_URL is required for azure_blob cache")
        return self

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
