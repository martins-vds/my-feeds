"""Unit tests for CategoryService.

Tests use mock repositories to isolate service logic.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.application.services.category_service import (
    CategoryLimitError,
    CategoryNameConflictError,
    CategoryNotFoundError,
    CategoryPermissionError,
    CategoryService,
)
from app.domain.feed_management.entities.category import Category


class TestCategoryServiceCreate:
    """Tests for CategoryService.create_category()."""

    @pytest.mark.asyncio
    async def test_create_category_success(self):
        """Should create category with default position 0."""
        mock_repo = AsyncMock()
        mock_repo.count_by_user.return_value = 0
        mock_repo.get_max_position.return_value = -1
        mock_repo.exists_by_name.return_value = False
        mock_repo.save.side_effect = lambda cat: cat

        service = CategoryService(mock_repo)
        result = await service.create_category(user_id=uuid4(), name="Technology")

        assert result.name == "Technology"
        assert result.position == 0
        mock_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_category_assigns_next_position(self):
        """New category should get position = max_position + 1."""
        mock_repo = AsyncMock()
        mock_repo.count_by_user.return_value = 3
        mock_repo.get_max_position.return_value = 2
        mock_repo.exists_by_name.return_value = False
        mock_repo.save.side_effect = lambda cat: cat

        service = CategoryService(mock_repo)
        result = await service.create_category(user_id=uuid4(), name="New Category")

        assert result.position == 3

    @pytest.mark.asyncio
    async def test_create_category_enforces_25_limit(self):
        """Should raise error when user has 25 categories (FR-039)."""
        mock_repo = AsyncMock()
        mock_repo.count_by_user.return_value = 25

        service = CategoryService(mock_repo)
        with pytest.raises(CategoryLimitError):
            await service.create_category(user_id=uuid4(), name="New Category")

    @pytest.mark.asyncio
    async def test_create_category_validates_name_length(self):
        """Name over 100 chars should raise validation error."""
        mock_repo = AsyncMock()
        mock_repo.count_by_user.return_value = 0
        mock_repo.exists_by_name.return_value = False
        mock_repo.get_max_position.return_value = -1

        service = CategoryService(mock_repo)
        with pytest.raises(ValueError):
            await service.create_category(user_id=uuid4(), name="x" * 101)

    @pytest.mark.asyncio
    async def test_create_category_validates_unique_name(self):
        """Duplicate name for same user should raise error."""
        mock_repo = AsyncMock()
        mock_repo.count_by_user.return_value = 1
        mock_repo.exists_by_name.return_value = True

        service = CategoryService(mock_repo)
        with pytest.raises(CategoryNameConflictError):
            await service.create_category(user_id=uuid4(), name="Existing")


class TestCategoryServiceUpdate:
    """Tests for CategoryService.update_category()."""

    @pytest.mark.asyncio
    async def test_update_category_name(self):
        """Should update category name."""
        user_id = uuid4()
        category_id = uuid4()
        mock_repo = AsyncMock()
        existing_category = Category(
            id=category_id,
            user_id=user_id,
            name="Old Name",
            position=0,
        )
        mock_repo.get_by_id.return_value = existing_category
        mock_repo.exists_by_name.return_value = False
        mock_repo.save.side_effect = lambda cat: cat

        service = CategoryService(mock_repo)
        result = await service.update_category(user_id, category_id, name="New Name")

        assert result.name == "New Name"
        mock_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_category_position(self):
        """Should update category position."""
        user_id = uuid4()
        category_id = uuid4()
        mock_repo = AsyncMock()
        existing_category = Category(
            id=category_id,
            user_id=user_id,
            name="Test",
            position=0,
        )
        mock_repo.get_by_id.return_value = existing_category
        mock_repo.save.side_effect = lambda cat: cat

        service = CategoryService(mock_repo)
        result = await service.update_category(user_id, category_id, position=5)

        assert result.position == 5

    @pytest.mark.asyncio
    async def test_update_category_not_found(self):
        """Should raise error for non-existent category."""
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = None

        service = CategoryService(mock_repo)
        with pytest.raises(CategoryNotFoundError):
            await service.update_category(uuid4(), uuid4(), name="New")

    @pytest.mark.asyncio
    async def test_update_category_different_user(self):
        """Should raise error when category belongs to different user."""
        category_id = uuid4()
        mock_repo = AsyncMock()
        existing_category = Category(
            id=category_id,
            user_id=uuid4(),
            name="Test",
            position=0,
        )
        mock_repo.get_by_id.return_value = existing_category

        service = CategoryService(mock_repo)
        with pytest.raises(CategoryPermissionError):
            await service.update_category(uuid4(), category_id, name="New")


class TestCategoryServiceDelete:
    """Tests for CategoryService.delete_category()."""

    @pytest.mark.asyncio
    async def test_delete_category_success(self):
        """Should delete category."""
        user_id = uuid4()
        category_id = uuid4()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = Category(
            id=category_id,
            user_id=user_id,
            name="Test",
        )
        mock_repo.delete.return_value = True

        service = CategoryService(mock_repo)
        result = await service.delete_category(user_id, category_id)

        assert result is True
        mock_repo.delete.assert_called_once_with(category_id)

    @pytest.mark.asyncio
    async def test_delete_category_not_found(self):
        """Should raise error for non-existent category."""
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = None

        service = CategoryService(mock_repo)
        with pytest.raises(CategoryNotFoundError):
            await service.delete_category(uuid4(), uuid4())


class TestCategoryServiceList:
    """Tests for CategoryService.list_categories()."""

    @pytest.mark.asyncio
    async def test_list_categories_returns_ordered_by_position(self):
        """Should return categories ordered by position."""
        mock_repo = AsyncMock()
        user_id = uuid4()
        categories = [
            Category(id=uuid4(), user_id=user_id, name="Cat2", position=1),
            Category(id=uuid4(), user_id=user_id, name="Cat1", position=0),
            Category(id=uuid4(), user_id=user_id, name="Cat3", position=2),
        ]
        mock_repo.get_by_user.return_value = categories

        service = CategoryService(mock_repo)
        result = await service.list_categories(user_id)

        assert len(result) == 3
        mock_repo.get_by_user.assert_called_once_with(user_id)

    @pytest.mark.asyncio
    async def test_list_categories_includes_feed_count(self):
        """Each category should include feed_count."""
        mock_repo = AsyncMock()
        user_id = uuid4()
        cat = Category(id=uuid4(), user_id=user_id, name="Test", position=0)
        cat.feed_count = 5
        mock_repo.get_by_user.return_value = [cat]

        service = CategoryService(mock_repo)
        result = await service.list_categories(user_id)

        assert result[0].feed_count == 5
