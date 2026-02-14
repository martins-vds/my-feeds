FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> /etc/bash.bashrc

# Install pnpm (standalone, since npm isn't available until devcontainer features run)
RUN curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" SHELL="$(which bash)" PNPM_VERSION="8" bash - && \
    echo 'export PNPM_HOME="$HOME/.local/share/pnpm"' >> /etc/bash.bashrc && \
    echo 'export PATH="$PNPM_HOME:$PATH"' >> /etc/bash.bashrc

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
