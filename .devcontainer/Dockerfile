FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Set up workspace
WORKDIR /workspace

# Install uv (Python package manager) as vscode user
USER vscode
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
