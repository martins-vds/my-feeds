"""Logging configuration."""

import logging
import sys
from typing import Literal

from app.config.settings import get_settings


def setup_logging(
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] | None = None,
) -> None:
    """Configure application logging.

    Args:
        level: Override log level. If None, uses DEBUG in dev, INFO in production.
    """
    settings = get_settings()

    if level is None:
        level = "DEBUG" if settings.debug else "INFO"

    # Configure root logger
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,
    )

    # Reduce noise from third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.debug else logging.WARNING
    )


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance with the given name.

    Args:
        name: Logger name, typically __name__ of the module.

    Returns:
        Configured logger instance.
    """
    return logging.getLogger(name)
