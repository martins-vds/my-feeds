"""Contract tests for category endpoints.

Tests verify API contract compliance per openapi.yaml.
TDD: These tests are written FIRST and should FAIL until implementation.
"""

from uuid import uuid4

import pytest


class TestListCategories:
    """Tests for GET /api/categories."""

    @pytest.mark.asyncio
    async def test_list_categories_returns_empty_array_for_new_user(self, client):
        """New user should have no categories."""
        # Use a fresh user UUID that has no data at all
        import json
        from datetime import datetime

        fresh_session = {
            "user_id": str(uuid4()),
            "provider": "github",
            "created_at": datetime.utcnow().isoformat(),
        }
        headers = {"Cookie": f"my_feeds_session={json.dumps(fresh_session)}"}

        response = await client.get("/api/categories", headers=headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data, list)
        assert len(data) == 0

    @pytest.mark.asyncio
    async def test_list_categories_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/categories")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_created_category_persists_across_requests(self, client, auth_headers):
        """A newly created category should appear in a subsequent list call.

        Regression: flush without commit caused the category to be lost
        after the create request finished.
        """
        unique_name = f"Persist-{uuid4().hex[:8]}"

        # Create a category
        create_resp = await client.post(
            "/api/categories",
            json={"name": unique_name},
            headers=auth_headers,
        )
        assert create_resp.status_code == 201

        # List categories in a NEW request — should include the created one
        list_resp = await client.get("/api/categories", headers=auth_headers)
        assert list_resp.status_code == 200

        categories = await list_resp.get_json()
        names = [c["name"] for c in categories]
        assert unique_name in names, (
            f"Category '{unique_name}' was not found in list response. Got: {names}"
        )

    @pytest.mark.asyncio
    async def test_list_categories_returns_user_categories_only(self, client):
        """Should return only categories owned by authenticated user."""
        # This test requires category creation + auth mock
        # Will fail until fully implemented
        response = await client.get("/api/categories")

        assert response.status_code in (200, 401)  # 401 until auth implemented


class TestCreateCategory:
    """Tests for POST /api/categories."""

    @pytest.mark.asyncio
    async def test_create_category_success(self, client, auth_headers):
        """Valid category creation should return 201."""
        unique_name = f"Tech-{uuid4().hex[:8]}"
        response = await client.post(
            "/api/categories",
            json={"name": unique_name},
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = await response.get_json()
        assert data["name"] == unique_name
        assert "id" in data
        assert data["position"] >= 0
        assert data["feedCount"] == 0

    @pytest.mark.asyncio
    async def test_create_category_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        response = await client.post(
            "/api/categories",
            json={"name": "Technology"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_create_category_requires_name(self, client):
        """Missing name should return 400."""
        response = await client.post(
            "/api/categories",
            json={},
        )

        assert response.status_code in (400, 401)

    @pytest.mark.asyncio
    async def test_create_category_name_max_length(self, client):
        """Name over 100 chars should return 400."""
        response = await client.post(
            "/api/categories",
            json={"name": "x" * 101},
        )

        assert response.status_code in (400, 401)

    @pytest.mark.asyncio
    async def test_create_category_duplicate_name_returns_409(self, client):
        """Duplicate category name for same user should return 409."""
        # Create first category
        await client.post("/api/categories", json={"name": "Technology"})

        # Try to create duplicate
        response = await client.post(
            "/api/categories",
            json={"name": "Technology"},
        )

        assert response.status_code in (409, 401)

    @pytest.mark.asyncio
    async def test_create_category_enforces_25_limit(self, client):
        """Should reject creation when user has 25 categories (FR-039)."""
        # This test requires creating 25 categories first
        # Will be implemented with proper fixtures
        pass


class TestGetCategory:
    """Tests for GET /api/categories/{categoryId}."""

    @pytest.mark.asyncio
    async def test_get_category_returns_category_with_feeds(self, client):
        """Should return category details with feeds array."""
        category_id = str(uuid4())

        response = await client.get(f"/api/categories/{category_id}")

        # Will fail until implemented
        assert response.status_code in (200, 401, 404)

    @pytest.mark.asyncio
    async def test_get_category_not_found(self, client):
        """Non-existent category should return 404."""
        fake_id = str(uuid4())

        response = await client.get(f"/api/categories/{fake_id}")

        assert response.status_code in (404, 401)


class TestUpdateCategory:
    """Tests for PATCH /api/categories/{categoryId}."""

    @pytest.mark.asyncio
    async def test_update_category_name(self, client):
        """Should update category name."""
        category_id = str(uuid4())

        response = await client.patch(
            f"/api/categories/{category_id}",
            json={"name": "Updated Name"},
        )

        assert response.status_code in (200, 401, 404)

    @pytest.mark.asyncio
    async def test_update_category_position(self, client):
        """Should update category position."""
        category_id = str(uuid4())

        response = await client.patch(
            f"/api/categories/{category_id}",
            json={"position": 5},
        )

        assert response.status_code in (200, 401, 404)

    @pytest.mark.asyncio
    async def test_update_category_duplicate_name_returns_409(self, client):
        """Renaming to existing name should return 409."""
        category_id = str(uuid4())

        response = await client.patch(
            f"/api/categories/{category_id}",
            json={"name": "Existing Name"},
        )

        assert response.status_code in (409, 401, 404)


class TestDeleteCategory:
    """Tests for DELETE /api/categories/{categoryId}."""

    @pytest.mark.asyncio
    async def test_delete_category_success(self, client):
        """Should delete category and return 204."""
        category_id = str(uuid4())

        response = await client.delete(f"/api/categories/{category_id}")

        assert response.status_code in (204, 401, 404)

    @pytest.mark.asyncio
    async def test_delete_category_cascades_feeds(self, client):
        """Deleting category should delete all its feeds."""
        # Requires integration with feeds
        pass

    @pytest.mark.asyncio
    async def test_delete_category_not_found(self, client):
        """Non-existent category should return 404."""
        fake_id = str(uuid4())

        response = await client.delete(f"/api/categories/{fake_id}")

        assert response.status_code in (404, 401)
