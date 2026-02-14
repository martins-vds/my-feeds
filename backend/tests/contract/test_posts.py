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
        response = await client.get(
            f"/api/posts?categoryId={category_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["posts"], list)

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_feed(self, client, auth_headers, feed_id):
        """Should filter posts by feed ID."""
        response = await client.get(
            f"/api/posts?feedId={feed_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["posts"], list)
        # All posts should belong to the specified feed
        for post in data["posts"]:
            assert post["feedId"] == str(feed_id)

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_unread(self, client, auth_headers):
        """Should filter to show only unread posts."""
        response = await client.get(
            "/api/posts?readState=unread",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = await response.get_json()
        for post in data["posts"]:
            assert post["isRead"] is False

    @pytest.mark.asyncio
    async def test_list_posts_filter_by_read(self, client, auth_headers):
        """Should filter to show only read posts."""
        response = await client.get(
            "/api/posts?readState=read",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = await response.get_json()
        for post in data["posts"]:
            assert post["isRead"] is True

    @pytest.mark.asyncio
    async def test_list_posts_pagination_with_limit(self, client, auth_headers):
        """Should respect limit parameter."""
        response = await client.get(
            "/api/posts?limit=5",
            headers=auth_headers
        )
        
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
                f"/api/posts?limit=5&before={cursor}",
                headers=auth_headers
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
        response = await client.get(
            f"/api/posts?categoryId={fake_id}",
            headers=auth_headers
        )
        
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
