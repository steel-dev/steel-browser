ARG NODE_VERSION=22.13.0

FROM node:${NODE_VERSION} AS base

WORKDIR /app
# Set default values that can be overridden
ENV VITE_API_URL=http://localhost:3000
ENV VITE_WS_URL=ws://localhost:3000
ENV VITE_OPENAPI_URL=http://localhost:3000/documentation/json

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

# Expose the port your web server runs on, assuming it's 5173
EXPOSE 5173

WORKDIR /app/ui

# Command to run your web server
CMD ["npm", "run", "start"]
