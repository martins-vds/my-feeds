"""Explicit telemetry pipeline with privacy filtering before export."""

import logging
import os
import re
from urllib.parse import urlsplit, urlunsplit

from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter
from opentelemetry.trace import Status
from quart import Quart

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+")
_CREDENTIAL_HEADER_PATTERN = re.compile(r"(?i)\b(authorization|(?:set-)?cookie)\s*[:=][^\r\n]*")
_SECRET_PATTERN = re.compile(
    r"(?i)(authorization|cookie|password|secret|token|code|api[_-]?key)\s*[:=]\s*\S+"
)
_SAFE_ATTRIBUTES = frozenset(
    {
        "http.method",
        "http.request.method",
        "http.status_code",
        "http.response.status_code",
        "http.route",
        "http.scheme",
        "server.address",
        "server.port",
        "network.protocol.version",
        "net.peer.name",
        "net.peer.port",
        "error.type",
        "exception.type",
    }
)
_URL_ATTRIBUTES = frozenset({"http.url", "url.full", "http.target"})
_provider = None


def _private_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        host = parts.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        if parts.port is not None:
            host = f"{host}:{parts.port}"
        return urlunsplit((parts.scheme, host, parts.path, "", ""))
    except ValueError:
        return "[invalid URL]"


def redact_text(value: str) -> str:
    value = _URL_PATTERN.sub(lambda match: _private_url(match.group()), value)
    value = _CREDENTIAL_HEADER_PATTERN.sub("[redacted]", value)
    return _SECRET_PATTERN.sub("[redacted]", value)


class PrivateDataLogFilter(logging.Filter):
    """Do not serialize third-party exception payloads into logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_text(record.getMessage())
        record.args = ()
        if record.exc_info:
            record.msg += f" [{record.exc_info[0].__name__}]"
            record.exc_info = None
            record.exc_text = None
        return True


def _safe_attributes(attributes):
    result = {}
    for key, value in (attributes or {}).items():
        if key in _SAFE_ATTRIBUTES:
            result[key] = redact_text(value) if isinstance(value, str) else value
        elif key in _URL_ATTRIBUTES and isinstance(value, str):
            result[key] = _private_url(value)
    return result


class RedactingSpanExporter(SpanExporter):
    """Copy public span data instead of mutating SDK-private attributes."""

    def __init__(self, exporter: SpanExporter):
        self._exporter = exporter

    def export(self, spans):
        cleaned = [
            ReadableSpan(
                name=redact_text(span.name),
                context=span.context,
                parent=span.parent,
                resource=span.resource,
                attributes=_safe_attributes(span.attributes),
                events=[
                    Event(
                        redact_text(event.name),
                        attributes=_safe_attributes(event.attributes),
                        timestamp=event.timestamp,
                    )
                    for event in span.events
                ],
                kind=span.kind,
                status=Status(span.status.status_code),
                start_time=span.start_time,
                end_time=span.end_time,
                instrumentation_scope=span.instrumentation_scope,
            )
            for span in spans
        ]
        return self._exporter.export(cleaned)

    def shutdown(self):
        self._exporter.shutdown()

    def force_flush(self, timeout_millis=30_000):
        return self._exporter.force_flush(timeout_millis)


def setup_telemetry(app: Quart) -> None:
    """Export sanitized traces and application logs only when configured."""
    connection_string = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        return

    from azure.monitor.opentelemetry.exporter import (
        AzureMonitorLogExporter,
        AzureMonitorTraceExporter,
    )
    from opentelemetry import trace
    from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor
    from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    global _provider
    if _provider is None:
        resource = Resource.create(
            {"service.name": os.environ.get("OTEL_SERVICE_NAME", "my-feeds")}
        )
        _provider = TracerProvider(resource=resource)
        _provider.add_span_processor(
            BatchSpanProcessor(
                RedactingSpanExporter(
                    AzureMonitorTraceExporter(
                        connection_string=connection_string,
                        disable_offline_storage=True,
                    )
                )
            )
        )
        trace.set_tracer_provider(_provider)
        logs = LoggerProvider(resource=resource)
        logs.add_log_record_processor(
            BatchLogRecordProcessor(
                AzureMonitorLogExporter(
                    connection_string=connection_string,
                    disable_offline_storage=True,
                )
            )
        )
        handler = LoggingHandler(logger_provider=logs)
        handler.addFilter(PrivateDataLogFilter())
        logging.getLogger("app").addHandler(handler)
        HTTPXClientInstrumentor().instrument(tracer_provider=_provider)
        AioHttpClientInstrumentor().instrument(tracer_provider=_provider)
    app.asgi_app = OpenTelemetryMiddleware(app.asgi_app, tracer_provider=_provider)
