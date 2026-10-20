"""Contract tests for serving the built frontend from the API origin."""

import pytest
from quart import Quart
from quart.testing import QuartClient

from app.main import create_app


@pytest.fixture
def frontend_client(tmp_path) -> QuartClient:
    app: Quart = create_app()
    app.config.update(TESTING=True, FRONTEND_DIST_DIR=tmp_path)
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<main>frontend</main>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log('frontend')", encoding="utf-8")
    return app.test_client()


class TestFrontendRoutes:
    @pytest.mark.asyncio
    async def test_root_and_client_routes_serve_the_spa(self, frontend_client: QuartClient):
        for path in ("/", "/posts/example"):
            response = await frontend_client.get(path)

            assert response.status_code == 200
            assert b"<main>frontend</main>" in await response.get_data()

    @pytest.mark.asyncio
    async def test_static_assets_are_served(self, frontend_client: QuartClient):
        response = await frontend_client.get("/assets/app.js")

        assert response.status_code == 200
        assert b"console.log" in await response.get_data()

    @pytest.mark.asyncio
    async def test_unknown_api_routes_do_not_fall_back_to_the_spa(
        self, frontend_client: QuartClient
    ):
        response = await frontend_client.get("/api/not-a-route")

        assert response.status_code == 404
        assert b"<main>frontend</main>" not in await response.get_data()
