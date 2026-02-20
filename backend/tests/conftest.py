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


@pytest.fixture(autouse=True)
async def _reset_db_engine():
    """Reset the global DB engine between tests to avoid event loop conflicts.

    Each async test gets its own event loop. The SQLAlchemy engine pool
    holds connections bound to the loop they were created in. We must
    dispose the engine after each test so the next test creates fresh
    connections on its own loop.
    """
    yield
    # After each test, dispose the engine so connections aren't reused
    # across event loops
    import app.infrastructure.persistence.database as db_mod

    if db_mod._engine is not None:
        try:
            await db_mod._engine.dispose()
        except Exception:
            pass
        db_mod._engine = None
        db_mod._session_factory = None
