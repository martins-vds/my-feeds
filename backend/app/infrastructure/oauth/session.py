"""Opaque, server-held identity credentials with persistent revocation."""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from quart import Request, Response, has_request_context
from quart import request as current_request
from sqlalchemy import delete, select

from app.config.settings import get_settings
from app.infrastructure.persistence.database import get_session_factory
from app.infrastructure.persistence.models.identity_session import IdentitySessionModel
from app.infrastructure.persistence.models.user import UserModel

_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
_PROVIDERS = frozenset(("github", "google", "microsoft"))


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class SessionManager:
    """Keep only a random bearer credential in an HttpOnly browser cookie."""

    COOKIE_NAME = "my_feeds_session"
    OAUTH_COOKIE_NAME = "my_feeds_oauth"
    SESSION_DURATION_DAYS = 30
    PENDING_TTL_MINUTES = 15
    OAUTH_TTL_MINUTES = 10

    def __init__(self, session_factory=None) -> None:
        self._settings = get_settings()
        self._session_factory = session_factory

    def _factory(self):
        return self._session_factory or get_session_factory()

    @property
    def _secure(self) -> bool:
        return self._settings.is_production or self._settings.oauth_redirect_base_url.startswith(
            "https://"
        )

    def _token(self, request: Request | None, cookie_name: str) -> str | None:
        if request is None and has_request_context():
            request = current_request
        value = request.cookies.get(cookie_name) if request is not None else None
        return value if isinstance(value, str) and _TOKEN.fullmatch(value) else None

    def _set_cookie(self, response: Response, name: str, token: str, expires: datetime):
        response.set_cookie(
            name,
            token,
            httponly=True,
            secure=self._secure,
            samesite="Lax",
            expires=expires,
            path="/",
        )

    def clear_oauth_cookie(self, response: Response) -> None:
        response.delete_cookie(
            self.OAUTH_COOKIE_NAME,
            path="/",
            secure=self._secure,
            httponly=True,
            samesite="Lax",
        )

    async def _issue(
        self,
        response: Response,
        kind: str,
        data: dict[str, Any],
        duration: timedelta,
        user_id: UUID | None = None,
    ) -> str:
        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        name = self.OAUTH_COOKIE_NAME if kind == "oauth" else self.COOKIE_NAME
        previous = self._token(None, name)
        async with self._factory()() as session:
            await session.execute(
                delete(IdentitySessionModel).where(IdentitySessionModel.expires_at <= now)
            )
            if previous:
                await session.execute(
                    delete(IdentitySessionModel).where(
                        IdentitySessionModel.token_hash == _digest(previous)
                    )
                )
            session.add(
                IdentitySessionModel(
                    token_hash=_digest(token),
                    kind=kind,
                    user_id=user_id,
                    data=data,
                    created_at=now,
                    expires_at=now + duration,
                )
            )
            await session.commit()
        self._set_cookie(response, name, token, now + duration)
        return token

    async def _read(self, request: Request, name: str, kind: str):
        token = self._token(request, name)
        if token is None:
            return None
        now = datetime.now(UTC)
        async with self._factory()() as session:
            row = await session.get(IdentitySessionModel, _digest(token))
            if row is None or row.kind != kind:
                return None
            if not (_utc(row.created_at) <= now < _utc(row.expires_at)):
                return None
            if not isinstance(row.data, dict):
                return None
            return row

    async def _consume(self, row: IdentitySessionModel) -> bool:
        now = datetime.now(UTC)
        async with self._factory()() as session:
            result = await session.execute(
                delete(IdentitySessionModel)
                .where(
                    IdentitySessionModel.token_hash == row.token_hash,
                    IdentitySessionModel.kind == row.kind,
                    IdentitySessionModel.created_at <= now,
                    IdentitySessionModel.expires_at > now,
                )
                .returning(IdentitySessionModel.token_hash)
            )
            consumed = result.scalar_one_or_none() is not None
            await session.commit()
            return consumed

    async def create_session(self, response: Response, user_id: UUID, provider: str) -> None:
        if (
            not isinstance(user_id, UUID)
            or not isinstance(provider, str)
            or provider not in _PROVIDERS
        ):
            raise ValueError("Invalid session identity")
        async with self._factory()() as session:
            if await session.scalar(select(UserModel.id).where(UserModel.id == user_id)) is None:
                raise ValueError("User does not exist")
        await self._issue(
            response,
            "session",
            {"user_id": str(user_id), "provider": provider},
            timedelta(days=self.SESSION_DURATION_DAYS),
            user_id,
        )

    async def get_session(self, request: Request) -> dict[str, Any] | None:
        row = await self._read(request, self.COOKIE_NAME, "session")
        if (
            row is None
            or not isinstance(row.data.get("provider"), str)
            or row.data["provider"] not in _PROVIDERS
        ):
            return None
        value = row.data.get("user_id")
        if not isinstance(value, str):
            return None
        try:
            user_id = UUID(value)
        except ValueError:
            return None
        if user_id != row.user_id:
            return None
        async with self._factory()() as session:
            if await session.scalar(select(UserModel.id).where(UserModel.id == user_id)) is None:
                return None
        return row.data

    async def get_user_id(self, request: Request) -> UUID | None:
        data = await self.get_session(request)
        return UUID(data["user_id"]) if data else None

    async def get_current_user_id(self) -> UUID | None:
        return await self.get_user_id(current_request)

    async def clear_session(self, response: Response, request: Request | None = None) -> None:
        tokens = [self._token(request, name) for name in (self.COOKIE_NAME, self.OAUTH_COOKIE_NAME)]
        hashes = [_digest(token) for token in tokens if token is not None]
        if hashes:
            async with self._factory()() as session:
                await session.execute(
                    delete(IdentitySessionModel).where(IdentitySessionModel.token_hash.in_(hashes))
                )
                await session.commit()
        response.delete_cookie(
            self.COOKIE_NAME, path="/", secure=self._secure, httponly=True, samesite="Lax"
        )
        self.clear_oauth_cookie(response)

    def _valid_pending(self, data: dict[str, Any]) -> bool:
        return (
            isinstance(data.get("provider"), str)
            and data["provider"] in _PROVIDERS
            and all(
                isinstance(data.get(key), str) and bool(data[key])
                for key in ("provider_id", "email")
            )
            and all(
                data.get(key) is None or isinstance(data[key], str)
                for key in ("name", "avatar_url")
            )
        )

    async def create_pending_session(
        self,
        response: Response,
        provider: str,
        provider_id: str,
        email: str,
        name: str | None = None,
        avatar_url: str | None = None,
    ) -> None:
        data = {
            "provider": provider,
            "provider_id": provider_id,
            "email": email,
            "name": name,
            "avatar_url": avatar_url,
        }
        if not self._valid_pending(data):
            raise ValueError("Invalid pending identity")
        await self._issue(response, "pending", data, timedelta(minutes=self.PENDING_TTL_MINUTES))

    async def get_pending_signup(self, request: Request) -> dict[str, Any] | None:
        row = await self._read(request, self.COOKIE_NAME, "pending")
        return row.data if row is not None and self._valid_pending(row.data) else None

    async def consume_pending_signup(self, request: Request) -> dict[str, Any] | None:
        row = await self._read(request, self.COOKIE_NAME, "pending")
        if row is None or not self._valid_pending(row.data) or not await self._consume(row):
            return None
        return row.data

    async def create_oauth_state(
        self,
        response: Response,
        provider: str,
        redirect_uri: str,
    ) -> tuple[str, str]:
        if not isinstance(provider, str) or provider not in _PROVIDERS:
            raise ValueError("Invalid provider")
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        await self._issue(
            response,
            "oauth",
            {
                "state_hash": _digest(state),
                "provider": provider,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            },
            timedelta(minutes=self.OAUTH_TTL_MINUTES),
        )
        return state, verifier

    async def consume_oauth_state(
        self,
        request: Request,
        state: str | None,
        provider: str,
        redirect_uri: str,
    ) -> str | None:
        if not isinstance(state, str) or not _TOKEN.fullmatch(state):
            return None
        row = await self._read(request, self.OAUTH_COOKIE_NAME, "oauth")
        if row is None:
            return None
        data = row.data
        if (
            not isinstance(data.get("state_hash"), str)
            or not secrets.compare_digest(data["state_hash"], _digest(state))
            or data.get("provider") != provider
            or data.get("redirect_uri") != redirect_uri
            or not isinstance(data.get("code_verifier"), str)
            or not _TOKEN.fullmatch(data["code_verifier"])
        ):
            return None
        return data["code_verifier"] if await self._consume(row) else None


session_manager = SessionManager()
