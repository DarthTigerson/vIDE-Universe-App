# Base image for Universe sandboxes. Built and pushed to GHCR on release tags
# (.github/workflows/image.yml), or built locally from Settings > Universe.
# The sandbox itself runs with no network, so everything an agent may want has
# to be baked in here.
FROM debian:bookworm-slim

ARG NODE_VERSION=22.12.0
ARG GO_VERSION=1.23.4

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1

# Toolchain, Python with the common libraries, and handy CLI tools. curl is
# here but useless offline; that is fine.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils git build-essential pkg-config \
      python3 python3-pip python3-venv python3-dev \
      python3-pytest python3-numpy python3-pandas \
      ripgrep jq procps less file unzip zip \
    && rm -rf /var/lib/apt/lists/*

# Node LTS + npm and Go from the official tarballs, linked into /usr/local/bin so
# they stay on PATH inside login shells (/etc/profile resets PATH).
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unsupported arch $arch"; exit 1 ;; esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" | tar -xJ -C /usr/local --strip-components=1; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" | tar -xz -C /usr/local; \
    ln -s /usr/local/go/bin/go /usr/local/bin/go; \
    ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt; \
    node --version; npm --version; go version

# Non-root user 1000 and the workspace the named volume mounts over. A new
# volume copies this directory's ownership, so uid 1000 can write to it.
RUN useradd --uid 1000 --create-home --shell /bin/bash universe \
    && mkdir -p /workspace && chown 1000:1000 /workspace

USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
