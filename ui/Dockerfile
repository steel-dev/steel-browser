ARG NODE_VERSION=22.13.0

FROM node:${NODE_VERSION} AS base

WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/steel-dev/steel-browser"

# Copy package.json and package-lock.json first
COPY --link package.json package-lock.json ./
COPY --link ui/ ./ui/

# Install the npm packages directly in the Docker container's working directory
RUN npm ci --include=dev -w ui --ignore-scripts

# Build the application
RUN npm run build -w ui

# Prune dev dependencies
RUN npm prune --omit=dev -w ui

FROM nginx:alpine
COPY --from=base /app/ui/dist /usr/share/nginx/html
COPY --from=base /app/ui/nginx.conf.template /etc/nginx/nginx.conf.template
COPY --chmod=755 --from=base /app/ui/entrypoint.sh /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
