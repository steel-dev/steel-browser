FROM ubuntu:22.04

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    xdotool \
    xclip \
    x11-utils \
    libvpx-dev \
    wget \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Go
RUN wget -q https://go.dev/dl/go1.22.0.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz \
    && rm go1.22.0.linux-amd64.tar.gz
ENV PATH=$PATH:/usr/local/go/bin

# Create working directory
WORKDIR /app

# Copy the Go project files
COPY . /app
# Copy the entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
# COPY entrypoint-debug.sh /app/entrypoint-debug.sh
RUN chmod +x /app/entrypoint.sh
# RUN chmod +x /app/entrypoint-debug.sh

# Build the Go application (pre-build to cache dependencies)
WORKDIR /app
RUN go mod download
RUN go build -o server .

# Set back to the app directory
WORKDIR /app

# Expose the web server port
EXPOSE 8080

# Set the entrypoint script
# ENTRYPOINT ["/app/entrypoint-debug.sh"]
ENTRYPOINT ["/app/entrypoint.sh"]
