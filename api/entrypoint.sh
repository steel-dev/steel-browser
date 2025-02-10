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
    
    # Check for Chrome binary
    if [ ! -f "$CHROME_BIN" ]; then
        log "Chrome not found at $CHROME_BIN, checking alternative locations..."
        # Try to find Chrome in common locations
        for chrome_path in \
            "/usr/bin/google-chrome" \
            "/usr/bin/google-chrome-stable" \
            "/usr/bin/chrome" \
            "$(which google-chrome 2>/dev/null)" \
            "$(which chrome 2>/dev/null)"
        do
            if [ -f "$chrome_path" ]; then
                log "Found Chrome at $chrome_path"
                export CHROME_BIN="$chrome_path"
                export CHROME_PATH="$chrome_path"
                break
            fi
        done
    fi

    # Verify ChromeDriver
    if [ ! -f "/selenium/driver/chromedriver" ]; then
        log "ERROR: ChromeDriver not found at /selenium/driver/chromedriver"
        return 1
    fi
    
    # Get Chrome version
    chrome_version=$($CHROME_BIN --version 2>/dev/null || echo "unknown")
    chromedriver_version=$(/selenium/driver/chromedriver --version 2>/dev/null || echo "unknown")
    
    log "Chrome version: $chrome_version"
    log "ChromeDriver version: $chromedriver_version"
    
    # Test Chrome with minimal flags
    if $CHROME_BIN --headless=new --no-sandbox --version >/dev/null 2>&1; then
        log "Chrome headless mode verified successfully"
        
        # Set additional Puppeteer environment variables
        export PUPPETEER_EXECUTABLE_PATH="$CHROME_BIN"
        export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
        
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
    export PUPPETEER_ARGS="--no-sandbox,--headless=new,--disable-gpu,--disable-dev-shm-usage"
    
    # Log environment state
    log "Environment configuration:"
    log "HOST=$HOST"
    log "CDP_REDIRECT_PORT=$CDP_REDIRECT_PORT"
    log "CHROME_BIN=$CHROME_BIN"
    log "CHROME_PATH=$CHROME_PATH"
    log "PUPPETEER_EXECUTABLE_PATH=$PUPPETEER_EXECUTABLE_PATH"
    log "PUPPETEER_ARGS=$PUPPETEER_ARGS"
    log "NODE_ENV=$NODE_ENV"
    
    # Start the application
    log "Starting Node.js application..."
    exec node ./build/index.js
}

# Run main with all arguments
main "$@"