# ---- Build stage ----
FROM golang:1.24 AS builder
WORKDIR /app

# Copy mod files first (to leverage caching)
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build Go binary with caching enabled (BuildKit required)
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go build -o server .

# ---- Runtime stage ----
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install only the runtime deps you really need
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xdotool \
    xclip \
    x11-utils \
    libvpx-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Go server + entrypoint script
COPY --from=builder /app/server .
COPY --from=builder /app/entrypoint.sh .
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
