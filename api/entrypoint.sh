#!/bin/sh
set -e  # Exit on error

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to wait for a service with timeout
wait_for_service() {
    local service_name="$1"
    local check_command="$2"
    local max_attempts=30
    local attempt=1

    log "Waiting for $service_name to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if eval "$check_command" > /dev/null 2>&1; then
            log "$service_name is ready"
            return 0
        fi
        log "Attempt $attempt/$max_attempts: $service_name not ready yet..."
        attempt=$((attempt + 1))
        sleep 1
    done
    log "ERROR: $service_name failed to start after $max_attempts attempts"
    return 1
}

# Clean up any stale processes and files
cleanup() {
    log "Cleaning up stale processes and files..."
    pkill Xvfb || true
    pkill dbus-daemon || true
    rm -f /run/dbus/pid /tmp/.X10-lock /tmp/.X11-unix/X10
    sleep 1
}

# Initialize services
init_services() {
    # Start dbus
    log "Initializing DBus..."
    mkdir -p /var/run/dbus
    dbus-daemon --system --fork
    wait_for_service "DBus" "dbus-send --system --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames" || exit 1

    # Start Xvfb
    log "Starting Xvfb..."
    Xvfb :10 -screen 0 1920x1080x8 -ac &
    wait_for_service "Xvfb" "xdpyinfo -display :10" || exit 1

    # Verify Chrome installation
    log "Verifying Chrome installation..."
    if [ ! -f "$CHROME_BIN" ]; then
        log "ERROR: Chrome binary not found at $CHROME_BIN"
        exit 1
    fi
}

# Start nginx if needed
start_nginx() {
    if [ "$START_NGINX" = "true" ]; then
        log "Starting nginx..."
        nginx -c /app/nginx.conf
        wait_for_service "nginx" "pgrep nginx" || exit 1
    else
        log "Skipping nginx startup (--no-nginx flag detected)"
    fi
}

# Main execution
main() {
    # Parse arguments
    START_NGINX=true
    for arg in "$@"; do
        if [ "$arg" = "--no-nginx" ]; then
            START_NGINX=false
            break
        fi
    done

    # Initial cleanup
    cleanup

    # Initialize core services
    init_services

    # Start nginx if needed
    start_nginx

    # Set required environment variables
    export DISPLAY=:10
    export CDP_REDIRECT_PORT=9223
    export HOST=0.0.0.0

    # Log environment state
    log "Environment configuration:"
    log "DISPLAY=$DISPLAY"
    log "HOST=$HOST"
    log "CDP_REDIRECT_PORT=$CDP_REDIRECT_PORT"
    log "CHROME_BIN=$CHROME_BIN"
    log "NODE_ENV=$NODE_ENV"

    # Start the application
    log "Starting Node.js application..."
    exec node ./build/index.js
}

# Run main with all arguments
main "$@"