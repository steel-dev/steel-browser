ARG NODE_VERSION=22.13.0

FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

ENV NODE_ENV="production"
ENV PUPPETEER_CACHE_DIR=/app/.cache
ENV DISPLAY=:10
ENV PATH="/usr/bin:/app/selenium/driver:${PATH}"
ENV CHROME_BIN=/usr/bin/google-chrome-stable
ENV CHROME_PATH=/usr/bin/google-chrome-stable

LABEL org.opencontainers.image.source="https://github.com/steel-dev/steel-browser"

FROM base AS build

RUN apt-get update -qq && \
    apt-get install -y build-essential pkg-config python-is-python3 xvfb

COPY --link package-lock.json package.json ./

RUN npm ci --include=dev

COPY --link . .

RUN npm run build

RUN npm prune --omit=dev


FROM build AS patcher
WORKDIR /app/patcher
RUN npm i --include=dev
RUN node ./scripts/patcher.js patch --packagePath /app/node_modules/puppeteer-core

FROM base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y wget nginx gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    # && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' <- add this back in when supported \ 
    && apt-get update \
    && apt-get install -y fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 xvfb curl unzip default-jre dbus dbus-x11 \
    --no-install-recommends

RUN curl -o chrome.deb https://mirror.cs.uchicago.edu/google-chrome/pool/main/g/google-chrome-stable/google-chrome-stable_128.0.6613.119-1_amd64.deb \
    && apt-get install -y ./chrome.deb \
    && rm chrome.deb


RUN mkdir -p /selenium/driver \
    && curl -o chromedriver.zip https://storage.googleapis.com/chrome-for-testing-public/128.0.6613.119/linux64/chromedriver-linux64.zip \
    && unzip chromedriver.zip -d /tmp \
    && mv /tmp/chromedriver-linux64/chromedriver /selenium/driver/chromedriver \
    && rm -rf chromedriver.zip /tmp/chromedriver-linux64 \
    && chmod +x /selenium/driver/chromedriver \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=patcher /app /app

COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
EXPOSE 9223

ENV HOST_IP=localhost
# Set the DISPLAY environment variable
ENV DISPLAY=:10
ENV DBUS_SESSION_BUS_ADDRESS=autolaunch:

ENTRYPOINT ["/app/entrypoint.sh"]