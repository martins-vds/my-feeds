"""Same-origin mutation policy and bounded in-process request admission."""

import time
from collections import OrderedDict
from dataclasses import dataclass
from ipaddress import ip_address, ip_network
from urllib.parse import urlsplit

from quart import request

from app.api.middleware.error_handler import APIError, ForbiddenError


def client_address(peer: str, forwarded: str | None, trusted_networks: list[str]) -> str:
    """Only a configured proxy may replace its socket address with X-Real-IP."""
    if not forwarded or not trusted_networks:
        return peer
    address = ip_address(peer)
    if not any(address in ip_network(network) for network in trusted_networks):
        return peer
    try:
        return str(ip_address(forwarded))
    except ValueError:
        raise ForbiddenError("Invalid client address from trusted proxy") from None


def _origin(value: str) -> str | None:
    try:
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username is not None:
            return None
        port = url.port or (443 if url.scheme == "https" else 80)
        return f"{url.scheme}://{url.hostname.lower()}:{port}"
    except ValueError:
        return None


def verify_mutation_origin(frontend_url: str) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    allowed = {_origin(request.host_url), _origin(frontend_url)} - {None}
    supplied = request.headers.get("Origin") or request.headers.get("Referer")
    if supplied:
        if _origin(supplied) not in allowed:
            raise ForbiddenError("Cross-origin API mutations are not allowed")
    elif request.headers.get("X-Requested-With") != "XMLHttpRequest":
        raise ForbiddenError("API mutations require a same-origin request marker")
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise ForbiddenError("Cross-site API mutations are not allowed")


@dataclass
class _Window:
    started: float
    count: int = 0


class RequestAdmission:
    """Fixed-window limits with a bounded key count; forwarding headers are untrusted."""

    def __init__(self, *, limit: int | None = None):
        self._windows: OrderedDict[tuple[str, bool], _Window] = OrderedDict()
        self._limit = limit

    def admit(self, peer: str, mutation: bool) -> None:
        key = (peer, mutation)
        now = time.monotonic()
        window = self._windows.get(key)
        if window is None or now - window.started >= 60:
            window = _Window(now)
            self._windows[key] = window
        self._windows.move_to_end(key)
        while len(self._windows) > 1024:
            self._windows.popitem(last=False)
        limit = self._limit if self._limit is not None else (60 if mutation else 120)
        if window.count >= limit:
            raise APIError(
                "Request rate limit exceeded",
                status_code=429,
                error_code="RATE_LIMITED",
                details={"retryAfter": max(1, int(60 - (now - window.started)))},
            )
        window.count += 1
