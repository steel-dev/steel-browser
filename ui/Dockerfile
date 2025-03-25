ARG NODE_VERSION=22.13.0

FROM node:${NODE_VERSION} AS base

WORKDIR /app
# Set default values that can be overridden
ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=ws://localhost:3000
ARG VITE_OPENAPI_URL=http://localhost:3000/documentation/json

# Make the build args available as environment variables during build
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
ENV VITE_OPENAPI_URL=${VITE_OPENAPI_URL}

LABEL org.opencontainers.image.source="https://github.com/steel-dev/steel-browser"

# Copy package.json and package-lock.json first
COPY --link package.json package-lock.json ./
COPY --link ui/ ./ui/

# Install the npm packages directly in the Docker container's working directory
RUN npm ci --include=dev -w ui

# Build the application
RUN npm run build -w ui

# Prune dev dependencies
RUN npm prune --omit=dev -w ui

# Expose the port your web server runs on, assuming it's 5173
EXPOSE 5173

WORKDIR /app/ui

# Command to run your web server
CMD ["npm", "run", "start"]
