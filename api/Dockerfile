ARG NODE_VERSION=22.13.0

FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

ENV NODE_ENV="production" \
    PUPPETEER_CACHE_DIR=/app/.cache \
    DISPLAY=:10 \
    PATH="/usr/bin:/app/selenium/driver:${PATH}" \
    CHROME_BIN=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    DEBIAN_FRONTEND=noninteractive

LABEL org.opencontainers.image.source="https://github.com/steel-dev/steel-browser"

# Install dependencies
RUN rm -f /etc/apt/apt.conf.d/docker-clean; \
    echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache; \
    apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get -yq dist-upgrade

FROM base AS build

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential \
    pkg-config \
    python-is-python3 \
    xvfb \
    x11-utils \
    xdotool \
    && rm -rf /var/lib/apt/lists/*

# Copy root workspace files first
COPY --link package.json package-lock.json ./
COPY --link api/ ./api/

# Install dependencies for api
RUN npm ci --include=dev --workspace=api --ignore-scripts

# Install dependencies for recorder extension separately
RUN cd api/extensions/recorder && npm ci --include=dev && cd -

# Build the api package
RUN npm run build -w api

RUN cd api/extensions/recorder && \
    npm run build && \
    cd -

# Prune dev dependencies
RUN npm prune --omit=dev -w api
RUN cd api/extensions/recorder && npm prune --omit=dev && cd -

FROM golang:1.24 AS go-build

WORKDIR /app

# Copy go.mod for caching
COPY ./api/src/webrtc/go.mod ./
COPY ./api/src/webrtc/go.sum ./
RUN go mod download

# Copy all source including cmd, internal, and web
COPY ./api/src/webrtc/ ./

# Build
RUN GOOS=linux GOARCH=$(go env GOARCH) go build -o steelrtc ./cmd

FROM base AS production
# Install dependencies
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -yq --no-install-recommends \
    wget \
    nginx \
    gnupg \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    xvfb \
    curl \
    unzip \
    default-jre \
    dbus \
    dbus-x11 \
    procps \
    x11-xserver-utils \
    x11-utils \
    xdotool \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome and ChromeDriver
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    curl \
    unzip \
    # Download and install Chromium
    && apt-get install -y chromium chromium-driver \
    # Clean up
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /var/cache/apt/*

RUN mkdir -p /files

COPY --chmod=755 api/entrypoint.sh /app/api/entrypoint.sh

# Copy Go server binary
COPY --from=go-build /app/steelrtc /app/api/steelrtc
# COPY --from=go-build /app/live-session-streamer.html /app/api/live-session-streamer.html

EXPOSE 3000 9223 3001

ENV HOST_IP=localhost \
    DBUS_SESSION_BUS_ADDRESS=autolaunch:

ENTRYPOINT ["/app/api/entrypoint.sh"]

COPY --from=build /app /app
