"""Unit tests for HTML sanitization of untrusted feed content."""

from app.infrastructure.sanitization.html_sanitizer import sanitize_html


class TestSanitizeHtml:
    def test_none_and_empty_pass_through(self):
        assert sanitize_html(None) is None
        assert sanitize_html("") == ""

    def test_strips_script_tags(self):
        out = sanitize_html("<p>hi</p><script>alert('xss')</script>")
        assert out is not None
        assert "<script" not in out
        assert "alert" not in out
        assert "<p>hi</p>" in out

    def test_strips_event_handlers(self):
        out = sanitize_html('<img src="x" onerror="alert(1)">')
        assert out is not None
        assert "onerror" not in out
        assert "alert" not in out

    def test_strips_javascript_url(self):
        out = sanitize_html('<a href="javascript:alert(1)">click</a>')
        assert out is not None
        assert "javascript:" not in out

    def test_strips_iframe(self):
        out = sanitize_html('<iframe src="https://evil.example"></iframe>')
        assert out is not None
        assert "<iframe" not in out

    def test_keeps_safe_formatting(self):
        out = sanitize_html(
            "<p>Hello <strong>world</strong> <a href='https://ok.example'>link</a></p>"
        )
        assert out is not None
        assert "<strong>world</strong>" in out
        assert 'href="https://ok.example"' in out

    def test_adds_noopener_noreferrer_to_links(self):
        out = sanitize_html('<a href="https://ok.example">x</a>')
        assert out is not None
        assert 'rel="noopener noreferrer"' in out
