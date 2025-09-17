#!/bin/sh
set -e  # Exit on error

# Function to log with timestamp
log() {
    if [ "$DEBUG" = "true" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    fi
}

# Initialize DBus
init_dbus() {
    log "Initializing DBus..."
    mkdir -p /var/run/dbus

    if [ -e /var/run/dbus/pid ]; then
        rm -f /var/run/dbus/pid
    fi

    dbus-daemon --system --fork
    sleep 2  # Give DBus time to initialize

    if dbus-send --system --print-reply --dest=org.freedesktop.DBus \
        /org/freedesktop/DBus org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
        log "DBus initialized successfully"
        return 0
    else
        log "ERROR: DBus failed to initialize"
        return 1
    fi
}

# Verify Chrome and ChromeDriver installation
verify_chrome() {
    log "Verifying Chrome installation..."

    # Check Chrome binary and version
    if [ ! -f "/usr/bin/chromium" ] && [ -z "$CHROME_EXECUTABLE_PATH" ]; then
        log "ERROR: Chrome binary not found at /usr/bin/chromium and CHROME_EXECUTABLE_PATH not set"
        return 1
    fi

    if [ -f "/usr/bin/chromium" ]; then
        chrome_version=$(chromium --version 2>/dev/null || echo "unknown")
    elif [ -n "$CHROME_EXECUTABLE_PATH" ] && [ -f "$CHROME_EXECUTABLE_PATH" ]; then
        chrome_version=$("$CHROME_EXECUTABLE_PATH" --version 2>/dev/null || echo "unknown")
    else
        chrome_version="unknown"
    fi
    log "Chrome version: $chrome_version"

    # Check ChromeDriver binary and version
    if [ ! -f "/usr/bin/chromedriver" ]; then
        log "ERROR: ChromeDriver not found at /usr/bin/chromedriver"
        return 1
    fi

    chromedriver_version=$(chromedriver --version 2>/dev/null || echo "unknown")
    log "ChromeDriver version: $chromedriver_version"

    log "Chrome environment configured successfully"
    return 0
}

# Start nginx with better error handling
start_nginx() {
    if [ "$START_NGINX" = "true" ]; then
        log "Starting nginx..."
        nginx -c /app/api/nginx.conf
        
        # Wait for nginx to start
        max_attempts=10
        attempt=1
        while [ $attempt -le $max_attempts ]; do
            if nginx -t >/dev/null 2>&1; then
                log "Nginx started successfully"
                return 0
            fi
            log "Attempt $attempt/$max_attempts: Waiting for nginx..."
            attempt=$((attempt + 1))
            sleep 1
        done
        log "ERROR: Nginx failed to start properly"
        return 1
    else
        log "Skipping nginx startup (--no-nginx flag detected)"
        return 0
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
    
    if [ "$DEBUG" = "true" ]; then
        init_dbus || exit 1
        verify_chrome || exit 1
    fi
    start_nginx || exit 1
    
    # Set required environment variables
    export CDP_REDIRECT_PORT=9223
    export DISPLAY=:10
    
    # Log environment state
    log "Environment configuration:"
    log "HOST=$HOST"
    log "CDP_REDIRECT_PORT=$CDP_REDIRECT_PORT"
    log "NODE_ENV=$NODE_ENV"
    
    # Start the application
    # Run the `npm run start` command but without npm.
    # NPM will introduce its own signal handling
    # which will prevent the container from waiting
    # for a session to be released before stopping gracefully
    log "Starting Steel Browser API..."
    exec node ./api/build/index.js
}

main "$@"