"""Synthetic canaries verify data is removed before export or logging."""

import logging
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import Status, StatusCode

from app.config import telemetry


class RecordingExporter(SpanExporter):
    def __init__(self):
        self.spans = []

    def export(self, spans):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        return None


def test_exported_span_excludes_query_userinfo_headers_and_exception_content():
    target = RecordingExporter()
    exporter_type = getattr(telemetry, "RedactingSpanExporter", lambda exporter: exporter)
    exporter = exporter_type(target)
    span = ReadableSpan(
        "GET",
        attributes={
            "http.url": "https://user:canary-secret@example.org/feed?token=canary-secret",
            "http.request.header.authorization": "Bearer canary-secret",
            "http.status_code": 200,
        },
        events=[Event("exception", attributes={"exception.message": "canary-secret"})],
        status=Status(StatusCode.ERROR, "canary-secret"),
    )
    exporter.export([span])
    actual = target.spans[0]
    assert "canary-secret" not in str(actual.attributes)
    assert "canary-secret" not in str(actual.events)
    assert actual.status.description is None
    assert actual.attributes["http.url"] == "https://example.org/feed"
    assert actual.attributes["http.status_code"] == 200


def test_log_filter_removes_secret_query_and_exception_payload():
    record = logging.LogRecord(
        "app",
        logging.ERROR,
        __file__,
        1,
        "Request failed https://example.org/feed?token=canary-secret",
        (),
        (ValueError, ValueError("canary-secret"), None),
    )
    filter_type = getattr(telemetry, "PrivateDataLogFilter", logging.Filter)
    assert filter_type().filter(record)
    assert "canary-secret" not in record.getMessage()
    assert record.exc_info is None


@pytest.mark.parametrize(
    "message",
    [
        "Authorization: Bearer canary-secret",
        "Authorization=Basic canary-secret",
        "Cookie: session=canary-secret; preference=canary-second-secret",
    ],
)
def test_log_filter_removes_entire_credential_header(message):
    record = logging.LogRecord("app", logging.ERROR, __file__, 1, message, (), None)
    assert telemetry.PrivateDataLogFilter().filter(record)
    assert "canary" not in record.getMessage()


def test_sql_engine_never_logs_secret_parameters_in_debug_mode(monkeypatch):
    from app.infrastructure.persistence import database

    create_engine = Mock()
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "create_async_engine", create_engine)
    monkeypatch.setattr(
        database,
        "get_settings",
        lambda: SimpleNamespace(debug=True, database_url="sqlite+aiosqlite://"),
    )
    database.get_engine()
    assert create_engine.call_args.kwargs["echo"] is False
    assert create_engine.call_args.kwargs["hide_parameters"] is True
