FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install PostgreSQL client tools (for pg_isready)
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Set up workspace
WORKDIR /workspace

# Install uv (Python package manager) as vscode user
USER vscode
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
