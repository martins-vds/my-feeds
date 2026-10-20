"""Azure Monitor (Application Insights) via the OpenTelemetry distro.

https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable?tabs=python
Quart isn't auto-instrumented by the distro, so requests are traced with the
OpenTelemetry ASGI middleware; outbound httpx/aiohttp calls use their
community instrumentations.
"""

import os

from quart import Quart


def setup_telemetry(app: Quart) -> None:
    """Enable telemetry when APPLICATIONINSIGHTS_CONNECTION_STRING is set (no-op locally)."""
    if not os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        return

    from azure.monitor.opentelemetry import configure_azure_monitor
    from opentelemetry.instrumentation.aiohttp_client import AioHttpClientInstrumentor
    from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    # Reads the connection string and OTEL_SERVICE_NAME from the environment;
    # also exports Python logging records as traces.
    configure_azure_monitor()
    HTTPXClientInstrumentor().instrument()
    AioHttpClientInstrumentor().instrument()
    app.asgi_app = OpenTelemetryMiddleware(app.asgi_app)
