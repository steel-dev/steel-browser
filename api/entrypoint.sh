#!/bin/sh
set -e  # Exit on error

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check if a process is running
is_process_running() {
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -x "$1" >/dev/null 2>&1
    else
        pidof "$1" >/dev/null 2>&1 || ps aux | grep -v grep | grep -q "$1"
    fi
}

# Clean up any stale processes and files
cleanup() {
    log "Cleaning up stale processes and files..."
    # More graceful process cleanup
    if command -v pkill >/dev/null 2>&1; then
        pkill Xvfb || true
        pkill dbus-daemon || true
    else
        kill $(pidof Xvfb) >/dev/null 2>&1 || true
        kill $(pidof dbus-daemon) >/dev/null 2>&1 || true
    fi
    
    rm -f /run/dbus/pid /tmp/.X10-lock /tmp/.X11-unix/X10
    sleep 2  # Give processes time to clean up
}

# Start Xvfb with better error handling
start_xvfb() {
    log "Starting Xvfb..."
    
    # Remove any existing lock files
    rm -f /tmp/.X10-lock
    rm -f /tmp/.X11-unix/X10
    
    # Start Xvfb with more verbose output
    Xvfb :10 -screen 0 1920x1080x24 -ac -nolisten tcp &
    xvfb_pid=$!
    
    # Wait for Xvfb to start
    max_attempts=30
    attempt=1
    while [ $attempt -le $max_attempts ]; do
        if DISPLAY=:10 xdpyinfo >/dev/null 2>&1; then
            log "Xvfb started successfully (PID: $xvfb_pid)"
            return 0
        fi
        
        # Check if process is still running
        if ! kill -0 $xvfb_pid >/dev/null 2>&1; then
            log "ERROR: Xvfb process died unexpectedly"
            return 1
        fi
        
        log "Attempt $attempt/$max_attempts: Waiting for Xvfb..."
        attempt=$((attempt + 1))
        sleep 1
    done
    
    log "ERROR: Xvfb failed to start properly after $max_attempts attempts"
    return 1
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
    start_xvfb || exit 1
    start_nginx || exit 1
    
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