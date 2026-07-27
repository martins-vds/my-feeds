"""Unit tests for readable-content detection."""

from app.domain.shared.readable_content import has_readable_content


class TestHasReadableContent:
    def test_empty_is_not_readable(self):
        assert has_readable_content(None) is False
        assert has_readable_content("") is False
        assert has_readable_content("   ") is False

    def test_comments_only_link_is_not_readable(self):
        # Hacker News items: body is just a discussion/comments link.
        assert (
            has_readable_content('<a href="https://news.ycombinator.com/item?id=1">Comments</a>')
            is False
        )
        assert has_readable_content('<p><a href="https://hn/1">Comments</a></p>') is False

    def test_two_links_no_text_is_not_readable(self):
        assert has_readable_content('<a href="/a">Article</a> | <a href="/c">Comments</a>') is False

    def test_prose_is_readable(self):
        assert has_readable_content("<p>This is a real article body.</p>") is True

    def test_text_with_link_is_readable(self):
        assert has_readable_content('<p>Read <a href="/x">this</a> today.</p>') is True

    def test_media_is_readable(self):
        assert has_readable_content('<p><img src="/x.jpg" alt="x"></p>') is True

    def test_curated_link_list_is_readable(self):
        html = (
            "<ul><li><a href='/1'>One</a></li>"
            "<li><a href='/2'>Two</a></li>"
            "<li><a href='/3'>Three</a></li></ul>"
        )
        assert has_readable_content(html) is True
