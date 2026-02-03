"""Backend test configuration and fixtures."""

import pytest
from quart import Quart

from app.main import create_app


@pytest.fixture(scope="session")
def app() -> Quart:
    """Create application instance for testing."""
    app = create_app()
    app.config.update(
        {
            "TESTING": True,
        }
    )
    return app


@pytest.fixture
def client(app: Quart):
    """Create test client."""
    return app.test_client()
