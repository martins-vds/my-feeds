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


class TestSummaryDictShape:
    def test_summary_dict_has_exactly_the_listed_keys_and_values(self):
        post = _make_post(summary="Short summary", content="<p>Body</p>")
        post.feed_title = "Feed"
        post.feed_icon_url = "https://example.com/icon.png"
        post.author = "Ann"
        post.has_audio = True

        data = post.to_summary_dict()

        assert data == {
            "id": str(post.id),
            "feedId": str(post.feed_id),
            "feedTitle": "Feed",
            "feedIconUrl": "https://example.com/icon.png",
            "title": "Title",
            "summary": "Short summary",
            "author": "Ann",
            "link": "https://example.com/1",
            "publishedAt": "2026-01-01T00:00:00+00:00",
            "isRead": False,
            "readProgress": 0.0,
            "isSeen": False,
            "hasAudio": True,
            "hasContent": True,
        }

    def test_has_content_is_true_when_only_the_summary_is_readable(self):
        assert _make_post(summary="Short", content=None).to_summary_dict()["hasContent"] is True

    def test_has_content_is_true_when_only_the_content_is_readable(self):
        assert _make_post(summary=None, content="<p>Body</p>").to_summary_dict()["hasContent"]

    def test_has_content_is_false_when_nothing_is_readable(self):
        assert _make_post().to_summary_dict()["hasContent"] is False


class TestReadingFields:
    def test_reading_fields_default_to_untouched(self):
        post = _make_post()

        assert post.read_progress == 0.0
        assert post.is_seen is False

    def test_summary_dict_exposes_progress_and_seen(self):
        post = _make_post(summary="Short")
        post.read_progress = 0.42
        post.is_seen = True

        data = post.to_summary_dict()

        assert data["isRead"] is False
        assert data["readProgress"] == 0.42
        assert data["isSeen"] is True

    def test_detail_dict_includes_progress_and_seen(self):
        post = _make_post(content="<p>Body</p>")
        post.is_read = True
        post.read_progress = 1.0
        post.is_seen = True

        data = post.to_detail_dict()

        assert data["isRead"] is True
        assert data["readProgress"] == 1.0
        assert data["isSeen"] is True
        assert data["content"] == "<p>Body</p>"
