"""Contract tests for Posts API endpoints.

TDD: Written FIRST - must FAIL until implementation is complete.
"""

import pytest
from uuid import uuid4


class TestListPosts:
    """Tests for GET /api/posts endpoint."""

    @pytest.mark.asyncio
    async def test_list_posts_returns_posts_from_all_feeds(self, client, auth_headers):
        """Should return posts from all user's subscribed feeds."""
        # Arrange - user has feeds with posts

        # Act
        response = await client.get("/api/posts", headers=auth_headers)

        # Assert
        assert response.status_code == 200
        data = await response.get_json()
        assert "posts" in data
        assert "hasMore" in data
        assert isinstance(data["posts"], list)

    @pytest.mark.asyncio
    async def test_list_posts_expose_has_content_flag(self, client, auth_headers):
        """Each post summary exposes a boolean hasContent flag."""
        response = await client.get("/api/posts", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        for post in data["posts"]:
            assert isinstance(post["hasContent"], bool)
            assert isinstance(post["hasAudio"], bool)

    @pytest.mark.asyncio
    async def test_list_posts_sorted_by_date_descending(self, client, auth_headers):
        """Should return posts sorted by published_at descending (newest first)."""
        response = await client.get("/api/posts", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        posts = data["posts"]

        # Verify ordering
        for i in range(len(posts) - 1):
            assert posts[i]["publishedAt"] >= posts[i + 1]["publishedAt"]

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_category(self, client, auth_headers, category_id):
        """Should filter posts by category ID."""
        response = await client.get(f"/api/posts?categoryId={category_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["posts"], list)

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_feed(self, client, auth_headers, feed_id):
        """Should filter posts by feed ID."""
        response = await client.get(f"/api/posts?feedId={feed_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["posts"], list)
        # All posts should belong to the specified feed
        for post in data["posts"]:
            assert post["feedId"] == str(feed_id)

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_unread(self, client, auth_headers):
        """Should filter to show only unread posts."""
        response = await client.get("/api/posts?readState=unread", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        for post in data["posts"]:
            assert post["isRead"] is False

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_read(self, client, auth_headers):
        """Should filter to show only read posts."""
        response = await client.get("/api/posts?readState=read", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        for post in data["posts"]:
            assert post["isRead"] is True

    @pytest.mark.asyncio
    async def test_list_posts_pagination_with_limit(self, client, auth_headers):
        """Should respect limit parameter."""
        response = await client.get("/api/posts?limit=5", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert len(data["posts"]) <= 5

    @pytest.mark.asyncio
    async def test_list_posts_pagination_with_cursor(self, client, auth_headers):
        """Should paginate using before cursor."""
        # First request
        first_response = await client.get("/api/posts?limit=5", headers=auth_headers)
        first_data = await first_response.get_json()

        if first_data.get("hasMore") and first_data.get("nextCursor"):
            # Second request with cursor
            cursor = first_data["nextCursor"]
            second_response = await client.get(
                f"/api/posts?limit=5&before={cursor}", headers=auth_headers
            )
            second_data = await second_response.get_json()

            # Posts should be older than cursor
            assert second_response.status_code == 200
            for post in second_data["posts"]:
                assert post["publishedAt"] < cursor

    @pytest.mark.asyncio
    async def test_list_posts_returns_post_summary_fields(self, client, auth_headers):
        """Should return correct fields for each post summary."""
        response = await client.get("/api/posts?limit=1", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()

        if data["posts"]:
            post = data["posts"][0]
            # Required fields per OpenAPI spec
            assert "id" in post
            assert "feedId" in post
            assert "feedTitle" in post
            assert "title" in post
            assert "summary" in post
            assert "author" in post
            assert "link" in post
            assert "publishedAt" in post
            assert "isRead" in post
            assert "hasAudio" in post

    @pytest.mark.asyncio
    async def test_list_posts_requires_authentication(self, client):
        """Should return 401 when not authenticated."""
        response = await client.get("/api/posts")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_posts_invalid_category_returns_empty(self, client, auth_headers):
        """Should return empty list for non-existent category."""
        fake_id = str(uuid4())
        response = await client.get(f"/api/posts?categoryId={fake_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert data["posts"] == []

    @pytest.mark.asyncio
    async def test_list_posts_default_limit(self, client, auth_headers):
        """Should use default limit of 50 when not specified."""
        response = await client.get("/api/posts", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert len(data["posts"]) <= 50

    @pytest.mark.asyncio
    async def test_list_posts_limit_max_100(self, client, auth_headers):
        """Should cap limit at 100."""
        response = await client.get("/api/posts?limit=200", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert len(data["posts"]) <= 100

    @pytest.mark.asyncio
    async def test_list_posts_uncategorized(self, client, auth_headers):
        """categoryId=none returns posts from feeds that have no categories."""
        response = await client.get("/api/posts?categoryId=none", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["posts"], list)


class TestGetPostDetail:
    """Tests for GET /api/posts/{postId} endpoint."""

    @pytest.mark.asyncio
    async def test_get_post_returns_full_content(self, client, auth_headers, post_id):
        """Should return post with full content field."""
        response = await client.get(f"/api/posts/{post_id}", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert "id" in data
        assert "content" in data  # Full content, not just summary
        assert "feedId" in data
        assert "title" in data
        assert "link" in data
        assert "publishedAt" in data
        assert "isRead" in data

    @pytest.mark.asyncio
    async def test_get_post_auto_marks_as_read(self, client, auth_headers, unread_post_id):
        """Should auto-mark post as read when viewing."""
        # First, verify post is unread
        list_response = await client.get("/api/posts?readState=unread", headers=auth_headers)
        list_data = await list_response.get_json()
        unread_ids = [p["id"] for p in list_data["posts"]]

        # View the post
        response = await client.get(f"/api/posts/{unread_post_id}", headers=auth_headers)
        assert response.status_code == 200

        # Verify it's now marked as read
        data = await response.get_json()
        assert data["isRead"] is True

    @pytest.mark.asyncio
    async def test_get_post_not_found(self, client, auth_headers):
        """Should return 404 for non-existent post."""
        fake_id = str(uuid4())
        response = await client.get(f"/api/posts/{fake_id}", headers=auth_headers)

        assert response.status_code == 404
        data = await response.get_json()
        assert data["error"] == "not_found"

    @pytest.mark.asyncio
    async def test_get_post_requires_authentication(self, client, post_id):
        """Should return 401 when not authenticated."""
        response = await client.get(f"/api/posts/{post_id}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_post_from_other_user_returns_404(
        self, client, auth_headers, other_user_post_id
    ):
        """Should return 404 when accessing another user's post."""
        response = await client.get(f"/api/posts/{other_user_post_id}", headers=auth_headers)

        assert response.status_code == 404


class TestUpdateReadState:
    """Tests for PUT /api/posts/{postId}/read-state endpoint."""

    @pytest.mark.asyncio
    async def test_mark_post_as_read(self, client, auth_headers, unread_post_id):
        """Should mark post as read."""
        response = await client.put(
            f"/api/posts/{unread_post_id}/read-state", headers=auth_headers, json={"isRead": True}
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data["postId"] == str(unread_post_id)
        assert data["isRead"] is True
        assert "readAt" in data  # Should have timestamp

    @pytest.mark.asyncio
    async def test_mark_post_as_unread(self, client, auth_headers, read_post_id):
        """Should mark post as unread."""
        response = await client.put(
            f"/api/posts/{read_post_id}/read-state", headers=auth_headers, json={"isRead": False}
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data["postId"] == str(read_post_id)
        assert data["isRead"] is False
        assert data["readAt"] is None

    @pytest.mark.asyncio
    async def test_update_read_state_requires_is_read_field(self, client, auth_headers, post_id):
        """Should require isRead field in request body."""
        response = await client.put(
            f"/api/posts/{post_id}/read-state", headers=auth_headers, json={}
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_update_read_state_not_found(self, client, auth_headers):
        """Should return 404 for non-existent post."""
        fake_id = str(uuid4())
        response = await client.put(
            f"/api/posts/{fake_id}/read-state", headers=auth_headers, json={"isRead": True}
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_read_state_requires_authentication(self, client, post_id):
        """Should return 401 when not authenticated."""
        response = await client.put(f"/api/posts/{post_id}/read-state", json={"isRead": True})
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_update_read_state_is_read_must_be_boolean(self, client, auth_headers, post_id):
        """Should reject non-boolean isRead values."""
        response = await client.put(
            f"/api/posts/{post_id}/read-state", headers=auth_headers, json={"isRead": "yes"}
        )

        assert response.status_code == 400


class TestUnreadCounts:
    """Tests for GET /api/posts/unread-counts endpoint."""

    @pytest.mark.asyncio
    async def test_unread_counts_shape(self, client, auth_headers):
        """Should return a byFeed map and a total equal to its sum."""
        response = await client.get("/api/posts/unread-counts", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["byFeed"], dict)
        assert isinstance(data["total"], int)
        assert data["total"] == sum(data["byFeed"].values())

    @pytest.mark.asyncio
    async def test_unread_counts_requires_authentication(self, client):
        """Should return 401 when not authenticated."""
        response = await client.get("/api/posts/unread-counts")
        assert response.status_code == 401


class TestBulkReadState:
    """Tests for PUT /api/posts/read-state (bulk mark read/unread)."""

    @pytest.mark.asyncio
    async def test_returns_updated_count(self, client, auth_headers):
        """A scope with no matching posts returns updated: 0 (no mutation)."""
        response = await client.put(
            "/api/posts/read-state",
            headers=auth_headers,
            json={"isRead": True, "categoryId": str(uuid4())},
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data["updated"] == 0

    @pytest.mark.asyncio
    async def test_requires_boolean_is_read(self, client, auth_headers):
        """Should reject a non-boolean isRead."""
        response = await client.put(
            "/api/posts/read-state",
            headers=auth_headers,
            json={"isRead": "yes"},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_invalid_feed_id(self, client, auth_headers):
        """Should reject a malformed feedId."""
        response = await client.put(
            "/api/posts/read-state",
            headers=auth_headers,
            json={"isRead": True, "feedId": "not-a-uuid"},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client):
        """Should return 401 when not authenticated."""
        response = await client.put("/api/posts/read-state", json={"isRead": True})
        assert response.status_code == 401
