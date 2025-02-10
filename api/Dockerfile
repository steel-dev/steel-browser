ARG NODE_VERSION=22.13.0
ARG RAILWAY_SERVICE_ID

FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

ENV NODE_ENV="production" \
    PUPPETEER_CACHE_DIR=/app/.cache \
    DISPLAY=:10 \
    PATH="/usr/bin:/app/selenium/driver:${PATH}" \
    CHROME_BIN=/usr/bin/google-chrome-stable \
    CHROME_PATH=/usr/bin/google-chrome-stable

LABEL org.opencontainers.image.source="https://github.com/steel-dev/steel-browser"

# Install dependencies
# Using --mount to speed up build with caching, see https://github.com/moby/buildkit/blob/master/frontend/dockerfile/docs/reference.md#run---mount
RUN rm -f /etc/apt/apt.conf.d/docker-clean; \
    echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache; \
    apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get -yq dist-upgrade

FROM base AS build

RUN --mount=type=cache,id=s/d7d87b8e-4d60-469f-be6f-07f75311163a-/var/cache/apt,target=/var/cache/apt \
    --mount=type=cache,id=s/d7d87b8e-4d60-469f-be6f-07f75311163a-/var/lib/apt,target=/var/lib/apt \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential \
    pkg-config \
    python-is-python3 \
    xvfb

COPY --link package-lock.json package.json ./

RUN npm ci --include=dev

COPY --link . .

RUN npm run build

RUN npm prune --omit=dev


FROM build AS patcher
WORKDIR /app/patcher
RUN npm i --include=dev
RUN node ./scripts/patcher.js patch --packagePath /app/node_modules/puppeteer-core

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
    x11-xserver-utils

# Install Chrome and ChromeDriver
RUN apt-get update && \
    apt-get install -y wget gnupg2 && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    CHROME_VERSION=$(google-chrome-stable --version | awk '{print $3}' | cut -d. -f1-3) && \
    CHROMEDRIVER_VERSION=$(curl -s "https://chromedriver.storage.googleapis.com/LATEST_RELEASE_${CHROME_VERSION}") && \
    wget -q "https://chromedriver.storage.googleapis.com/${CHROMEDRIVER_VERSION}/chromedriver_linux64.zip" && \
    mkdir -p /selenium/driver && \
    unzip chromedriver_linux64.zip -d /selenium/driver && \
    rm chromedriver_linux64.zip && \
    chmod +x /selenium/driver/chromedriver && \
    # Verify installations
    google-chrome-stable --version && \
    /selenium/driver/chromedriver --version && \
    # Clean up
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --chmod=755 entrypoint.sh /app/entrypoint.sh

EXPOSE 3000 9223

ENV HOST_IP=localhost \
    DBUS_SESSION_BUS_ADDRESS=autolaunch:

ENTRYPOINT ["/app/entrypoint.sh"]

COPY --from=patcher /app /app
