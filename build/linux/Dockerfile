# Build environment for the Linux binary (`task build:linux`), usable from any OS
# with Docker. Wails v2 cannot cross-compile to Linux: the app links WebKitGTK via
# cgo, so it is built inside Linux with the GTK/WebKit headers installed.
#
# WebKitGTK 4.1 (Debian trixie has no 4.0) — the build passes `-tags webkit2_41`.
# The binary then needs libwebkit2gtk-4.1 at runtime (Ubuntu 22.04+, Debian 12+,
# Fedora 39+ ship it).

FROM node:22-trixie-slim AS node

FROM golang:1.26-trixie

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev \
 && rm -rf /var/lib/apt/lists/*

# Node 22 (Vite 7 needs >= 20.19), copied from the official image.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Same Wails version as go.mod.
RUN go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0

WORKDIR /src
