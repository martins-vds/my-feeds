"""Unit tests for the UserPostState value object."""

from dataclasses import FrozenInstanceError
from datetime import UTC, datetime

import pytest

from app.domain.feed_management.entities.user_post_state import (
    READ_COMPLETION_THRESHOLD,
    UserPostState,
)


class TestUserPostState:
    def test_defaults_describe_an_untouched_post(self):
        state = UserPostState()

        assert state.is_read is False
        assert state.read_at is None
        assert state.read_progress == 0.0
        assert state.opened_at is None
        assert state.is_seen is False

    def test_is_seen_once_opened_at_is_set(self):
        state = UserPostState(opened_at=datetime(2026, 1, 5, tzinfo=UTC))

        assert state.is_seen is True

    def test_is_immutable(self):
        state = UserPostState()

        with pytest.raises(FrozenInstanceError):
            state.is_read = True  # type: ignore[misc]

    def test_completion_threshold_is_ninety_five_percent(self):
        assert READ_COMPLETION_THRESHOLD == 0.95
