"""HTML sanitization for untrusted feed content.

RSS/Atom feed content is untrusted third-party HTML, so it must be sanitized
before being stored/served to prevent stored XSS. Uses nh3 (a maintained,
Rust-based HTML sanitizer built on ammonia — the successor to the now-deprecated
Bleach).
"""

import nh3


def sanitize_html(html: str | None) -> str | None:
    """Sanitize an untrusted HTML fragment.

    Strips scripts, event handlers, ``javascript:`` URLs and other dangerous
    constructs while keeping a safe allowlist of formatting tags. nh3 also adds
    ``rel="noopener noreferrer"`` to links by default. Falsy input (``None`` or
    empty string) is returned unchanged.

    Args:
        html: Untrusted HTML (may be ``None``).

    Returns:
        Sanitized HTML, or the original falsy value.
    """
    if not html:
        return html
    return nh3.clean(html)
