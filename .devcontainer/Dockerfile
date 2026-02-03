FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> /etc/bash.bashrc

# Install pnpm
RUN npm install -g pnpm@8

# Set up workspace
WORKDIR /workspace

# Create vscode user if not exists
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN if ! id -u $USERNAME > /dev/null 2>&1; then \
        groupadd --gid $USER_GID $USERNAME && \
        useradd --uid $USER_UID --gid $USER_GID -m $USERNAME; \
    fi

USER $USERNAME
