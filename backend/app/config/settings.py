"""Environment configuration management using pydantic-settings."""

from functools import lru_cache
from ipaddress import ip_network
from typing import Literal
from urllib.parse import urlsplit

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
    debug: bool = False
    allow_external_images: bool = False
    trusted_proxy_networks: list[str] = Field(default_factory=list, max_length=16)

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

    # Text-to-Speech
    tts_provider: Literal["edge", "azure"] = "edge"
    azure_speech_endpoint: str = ""
    external_tts_enabled: bool = False

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

    @model_validator(mode="after")
    def validate_trusted_proxies(self) -> "Settings":
        for value in self.trusted_proxy_networks:
            network = ip_network(value)
            if network.prefixlen == 0:
                raise ValueError("Trusted proxies must not include the entire Internet")
        return self

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.is_production:
            if self.debug:
                raise ValueError("DEBUG must be false in production")
            if len(self.secret_key) < 32 or self.secret_key == "change_me_in_production":
                raise ValueError(
                    "Production SECRET_KEY must be a random secret of at least 32 characters"
                )
            for name in ("oauth_redirect_base_url", "frontend_url"):
                url = urlsplit(getattr(self, name))
                if (
                    url.scheme != "https"
                    or not url.hostname
                    or url.username is not None
                    or url.query
                    or url.fragment
                ):
                    raise ValueError(f"Production {name} must be an absolute HTTPS public URL")
        return self

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
