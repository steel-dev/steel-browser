#!/bin/sh
set -e  # Exit on error

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Clean up any stale processes and files
cleanup() {
    log "Cleaning up stale processes and files..."
    if command -v pkill >/dev/null 2>&1; then
        pkill chrome || true
        pkill dbus-daemon || true
    else
        kill $(pidof chrome) >/dev/null 2>&1 || true
        kill $(pidof dbus-daemon) >/dev/null 2>&1 || true
    fi
    
    rm -f /run/dbus/pid
    sleep 1
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
    if [ ! -f "/usr/bin/google-chrome-stable" ] && [ -z "$CHROME_EXECUTABLE_PATH" ]; then
        log "ERROR: Chrome binary not found at /usr/bin/google-chrome-stable and CHROME_EXECUTABLE_PATH not set"
        return 1
    fi
    
    if [ -f "/usr/bin/google-chrome-stable" ]; then
        chrome_version=$(google-chrome-stable --version 2>/dev/null || echo "unknown")
    elif [ -n "$CHROME_EXECUTABLE_PATH" ] && [ -f "$CHROME_EXECUTABLE_PATH" ]; then
        chrome_version=$("$CHROME_EXECUTABLE_PATH" --version 2>/dev/null || echo "unknown")
    else
        chrome_version="unknown"
    fi
    log "Chrome version: $chrome_version"
    
    # Check ChromeDriver binary and version
    if [ ! -f "/selenium/driver/chromedriver" ]; then
        log "ERROR: ChromeDriver not found at /selenium/driver/chromedriver"
        return 1
    fi
    
    chromedriver_version=$(/selenium/driver/chromedriver --version 2>/dev/null || echo "unknown")
    log "ChromeDriver version: $chromedriver_version"
    
    log "Chrome environment configured successfully"
    return 0
}

# Start nginx with better error handling
start_nginx() {
    if [ "$START_NGINX" = "true" ]; then
        log "Starting nginx..."
        nginx -c /app/nginx.conf
        
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
    
    # Initial cleanup
    cleanup
    
    # Initialize services
    init_dbus || exit 1
    verify_chrome || exit 1
    start_nginx || exit 1
    
    # Set required environment variables
    export CDP_REDIRECT_PORT=9223
    export HOST=0.0.0.0
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
    log "Starting Node.js application..."
    exec node ./api/build/index.js
}

main "$@"