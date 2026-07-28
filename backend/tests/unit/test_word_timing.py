"""Unit tests for the WordTiming value object (feature 003 read-along).

Covers the happy path (derived ``end_ms``, verbatim source text, immutability
and value equality), the validation error paths (negative offset/duration), and
the accepted zero-value boundaries. The value object is otherwise only
constructed indirectly by the edge-tts capture tests, so this pins its contract
directly.
"""

import dataclasses

import pytest

from app.domain.audio.value_objects.word_timing import WordTiming


class TestWordTimingHappyPath:
    def test_end_ms_is_start_plus_duration(self):
        assert WordTiming(text="Hello", start_ms=120, duration_ms=300).end_ms == 420

    def test_preserves_source_text_verbatim(self):
        # Digits and contractions are kept exactly (not normalized server-side).
        assert WordTiming(text="2024", start_ms=0, duration_ms=10).text == "2024"
        assert WordTiming(text="don't", start_ms=0, duration_ms=10).text == "don't"

    def test_is_immutable(self):
        timing = WordTiming(text="Hello", start_ms=0, duration_ms=10)
        with pytest.raises(dataclasses.FrozenInstanceError):
            timing.text = "world"  # type: ignore[misc]

    def test_value_equality(self):
        assert WordTiming("a", 1, 2) == WordTiming("a", 1, 2)
        assert WordTiming("a", 1, 2) != WordTiming("a", 1, 3)


class TestWordTimingValidation:
    def test_negative_start_ms_raises(self):
        with pytest.raises(ValueError, match="start_ms must be >= 0"):
            WordTiming(text="x", start_ms=-1, duration_ms=10)

    def test_negative_duration_ms_raises(self):
        with pytest.raises(ValueError, match="duration_ms must be >= 0"):
            WordTiming(text="x", start_ms=0, duration_ms=-1)


class TestWordTimingBoundaries:
    def test_zero_start_and_duration_allowed(self):
        timing = WordTiming(text="x", start_ms=0, duration_ms=0)
        assert timing.start_ms == 0
        assert timing.duration_ms == 0
        assert timing.end_ms == 0
