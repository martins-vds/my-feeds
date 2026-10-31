"""Bounded admission across manual and scheduled feed ingestion."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from quart import Quart

from app.infrastructure.jobs import feed_ingestion as jobs


@pytest.mark.asyncio
async def test_same_feed_cannot_be_ingested_concurrently(monkeypatch):
    started, finish = asyncio.Event(), asyncio.Event()
    calls = []

    async def ingest(feed_id):
        calls.append(feed_id)
        started.set()
        await finish.wait()
        return 2

    service = SimpleNamespace(ingest_feed=ingest, get_feed_owner=AsyncMock(return_value=None))
    monkeypatch.setattr(jobs, "create_feed_service", lambda _session: service)
    monkeypatch.setattr(jobs, "create_session", lambda: AsyncMock())
    feed_id = uuid4()
    task = asyncio.create_task(jobs.ingest_feed_posts(feed_id))
    await started.wait()
    try:
        with pytest.raises(Exception) as error:
            await asyncio.wait_for(jobs.ingest_feed_posts(feed_id), timeout=0.1)
        assert error.value.status_code == 429
        assert calls == [feed_id]
    finally:
        finish.set()
        assert await task == 2


@pytest.mark.asyncio
async def test_global_capacity_rejects_without_waiting_and_releases(monkeypatch):
    gate = jobs.FeedJobGate(max_jobs=2)
    first, second, third = uuid4(), uuid4(), uuid4()
    a, b = gate.reserve(first), gate.reserve(second)
    with pytest.raises(jobs.FeedJobAdmissionError) as error:
        gate.reserve(third)
    assert error.value.status_code == 503
    a.release()
    c = gate.reserve(third)
    b.release()
    c.release()
    retry = gate.reserve(first)
    assert retry.feed_id == first
    retry.release()


@pytest.mark.asyncio
async def test_cancellation_releases_ingestion_admission(monkeypatch):
    started = asyncio.Event()

    async def ingest(feed_id):
        started.set()
        await asyncio.Event().wait()

    gate = jobs.FeedJobGate(max_jobs=1)
    monkeypatch.setattr(jobs, "feed_job_gate", gate)
    monkeypatch.setattr(jobs, "create_session", lambda: AsyncMock())
    monkeypatch.setattr(
        jobs,
        "create_feed_service",
        lambda _session: SimpleNamespace(
            ingest_feed=ingest, get_feed_owner=AsyncMock(return_value=None)
        ),
    )
    feed_id = uuid4()
    task = asyncio.create_task(jobs.ingest_feed_posts(feed_id))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    reservation = gate.reserve(feed_id)
    reservation.release()


@pytest.mark.asyncio
async def test_manual_refresh_returns_429_then_503_at_admission(monkeypatch):
    from app.api.routes import feeds

    app = Quart(__name__)
    app.register_blueprint(feeds.bp, url_prefix="/api")
    feed_id = uuid4()
    feed = SimpleNamespace(id=feed_id, is_active=True, to_dict=lambda: {"id": str(feed_id)})
    monkeypatch.setattr(feeds, "get_current_user_id", AsyncMock(return_value=uuid4()))
    monkeypatch.setattr(
        feeds,
        "get_request_container",
        lambda: SimpleNamespace(
            feed_service=SimpleNamespace(get_feed=AsyncMock(return_value=feed))
        ),
    )
    pending = []
    monkeypatch.setattr(app, "add_background_task", lambda *args: pending.append(args))
    client = app.test_client()
    first = await client.post(f"/api/feeds/{feed_id}/refresh")
    assert first.status_code == 200
    duplicate = await client.post(f"/api/feeds/{feed_id}/refresh")
    assert duplicate.status_code == 429
    assert len(pending) == 1

    reservation = pending[0][2]
    reservation.release()
    gate = jobs.FeedJobGate(max_jobs=1)
    monkeypatch.setattr(feeds, "feed_job_gate", gate)
    occupied = gate.reserve(uuid4())
    try:
        saturated = await client.post(f"/api/feeds/{feed_id}/refresh")
        assert saturated.status_code == 503
        assert saturated.headers["Retry-After"] == "30"
        assert len(pending) == 1
    finally:
        occupied.release()


@pytest.mark.asyncio
async def test_scheduled_refresh_skips_admission_failures_and_continues(monkeypatch):
    from app.infrastructure.jobs import feed_refresh

    monkeypatch.setattr(
        feed_refresh, "_get_active_feed_ids", AsyncMock(return_value=[uuid4(), uuid4()])
    )
    monkeypatch.setattr(
        feed_refresh,
        "ingest_feed_posts",
        AsyncMock(side_effect=[jobs.FeedJobAdmissionError("busy", 429), 3]),
    )
    assert await feed_refresh.refresh_active_feeds() == 3


@pytest.mark.parametrize("path", ["/api/feeds", "/api/categories/{category_id}/feeds"])
@pytest.mark.asyncio
async def test_creation_at_capacity_rolls_back_instead_of_success(monkeypatch, path):
    from app.api.routes import feeds

    app = Quart(__name__)
    app.register_blueprint(feeds.bp, url_prefix="/api")
    gate = jobs.FeedJobGate(max_jobs=1)
    monkeypatch.setattr(feeds, "feed_job_gate", gate)
    occupied = gate.reserve(uuid4())
    feed = SimpleNamespace(id=uuid4(), to_dict=lambda: {"title": "Feed"})

    class Session:
        committed = False
        rolled_back = False

        async def commit(self):
            self.committed = True

        async def rollback(self):
            self.rolled_back = True

    session = Session()
    monkeypatch.setattr(feeds, "get_current_user_id", AsyncMock(return_value=uuid4()))
    monkeypatch.setattr(
        feeds,
        "get_request_container",
        lambda: SimpleNamespace(
            session=session, feed_service=SimpleNamespace(add_feed=AsyncMock(return_value=feed))
        ),
    )
    try:
        response = await app.test_client().post(
            path.format(category_id=uuid4()), json={"url": "https://example.com/rss"}
        )
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "30"
        assert session.rolled_back is True
        assert session.committed is False
    finally:
        occupied.release()


@pytest.mark.asyncio
async def test_background_submission_failure_releases_reserved_slot(monkeypatch):
    from app.api.routes import feeds

    app = Quart(__name__)
    app.register_blueprint(feeds.bp, url_prefix="/api")
    gate = jobs.FeedJobGate(max_jobs=1)
    monkeypatch.setattr(feeds, "feed_job_gate", gate)
    feed_id = uuid4()
    feed = SimpleNamespace(id=feed_id, is_active=True, to_dict=lambda: {"title": "Feed"})
    monkeypatch.setattr(feeds, "get_current_user_id", AsyncMock(return_value=uuid4()))
    monkeypatch.setattr(
        feeds,
        "get_request_container",
        lambda: SimpleNamespace(
            feed_service=SimpleNamespace(get_feed=AsyncMock(return_value=feed))
        ),
    )

    def cannot_schedule(*args):
        raise RuntimeError("Application closing")

    monkeypatch.setattr(app, "add_background_task", cannot_schedule)
    response = await app.test_client().post(f"/api/feeds/{feed_id}/refresh")
    assert response.status_code == 500
    retry = gate.reserve(feed_id)
    retry.release()
