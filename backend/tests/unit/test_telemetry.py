from quart import Quart

from app.config.telemetry import setup_telemetry


def test_setup_telemetry_is_noop_without_connection_string(monkeypatch):
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    app = Quart(__name__)
    original = app.asgi_app
    setup_telemetry(app)
    assert app.asgi_app == original


def test_setup_telemetry_wraps_asgi_app(monkeypatch):
    calls = []
    monkeypatch.setenv(
        "APPLICATIONINSIGHTS_CONNECTION_STRING",
        "InstrumentationKey=00000000-0000-0000-0000-000000000000",
    )
    monkeypatch.setattr(
        "azure.monitor.opentelemetry.configure_azure_monitor", lambda: calls.append(1)
    )
    app = Quart(__name__)
    setup_telemetry(app)
    from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware

    assert calls == [1]
    assert isinstance(app.asgi_app, OpenTelemetryMiddleware)
