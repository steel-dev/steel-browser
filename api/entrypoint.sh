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

# Verify Chrome installation
verify_chrome() {
    log "Verifying Chrome installation..."
    if [ ! -f "$CHROME_BIN" ]; then
        log "ERROR: Chrome binary not found at $CHROME_BIN"
        return 1
    fi
    
    # Test Chrome in headless mode
    if $CHROME_BIN --headless=new --version >/dev/null 2>&1; then
        log "Chrome headless mode verified successfully"
        return 0
    else
        log "ERROR: Chrome headless mode verification failed"
        return 1
    fi
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
    
    # Log environment state
    log "Environment configuration:"
    log "HOST=$HOST"
    log "CDP_REDIRECT_PORT=$CDP_REDIRECT_PORT"
    log "CHROME_BIN=$CHROME_BIN"
    log "NODE_ENV=$NODE_ENV"
    log "PUPPETEER_ARGS=$PUPPETEER_ARGS"
    
    # Start the application
    log "Starting Node.js application..."
    exec node ./build/index.js
}

# Run main with all arguments
main "$@"