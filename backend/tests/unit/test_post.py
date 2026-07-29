"""Unit tests for the Post domain entity."""

from datetime import datetime, timezone
from uuid import uuid4

from app.domain.feed_management.entities.post import Post


def _make_post(summary: str | None = None, content: str | None = None) -> Post:
    return Post(
        id=uuid4(),
        feed_id=uuid4(),
        guid="guid-1",
        title="Title",
        link="https://example.com/1",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        content=content,
        summary=summary,
    )


class TestGetExcerpt:
    def test_strips_html_tags(self):
        post = _make_post(summary="<p>Hello <strong>world</strong></p>")
        assert post.get_excerpt() == "Hello world"

    def test_decodes_html_entities(self):
        # &gt; and &amp; must render as real characters, not literal entity text.
        post = _make_post(summary="<p>Q &gt; 1 &amp; done</p>")
        assert post.get_excerpt() == "Q > 1 & done"

    def test_nbsp_entity_is_decoded(self):
        # Regression: literal "&nbsp;" was leaking into the post list summary.
        excerpt = _make_post(summary="Helion&nbsp;has progressed").get_excerpt()
        assert "&nbsp;" not in excerpt
        assert excerpt.startswith("Helion")
        assert excerpt.endswith("has progressed")

    def test_falls_back_to_content_when_no_summary(self):
        post = _make_post(summary=None, content="<p>Body &amp; text</p>")
        assert post.get_excerpt() == "Body & text"

    def test_truncates_at_word_boundary(self):
        post = _make_post(summary="word " * 100)
        excerpt = post.get_excerpt(max_length=20)
        assert excerpt.endswith("...")
        assert len(excerpt) <= 23
