"""Word timing value object."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WordTiming:
    """One spoken word within a clip (immutable, no identity).

    Attributes:
        text: The engine's source-text token, verbatim (e.g. ``"2024"``,
            ``"don't"``, ``"Hello"``). Not normalized server-side.
        start_ms: Start offset from the beginning of the audio, in whole
            milliseconds (``>= 0``).
        duration_ms: Duration of the spoken word in whole milliseconds
            (``>= 0``).
    """

    text: str
    start_ms: int
    duration_ms: int

    def __post_init__(self) -> None:
        if self.start_ms < 0:
            raise ValueError("start_ms must be >= 0")
        if self.duration_ms < 0:
            raise ValueError("duration_ms must be >= 0")

    @property
    def end_ms(self) -> int:
        """Absolute end offset in milliseconds."""
        return self.start_ms + self.duration_ms
