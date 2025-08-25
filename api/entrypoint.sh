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
        pkill Xvfb || true
    else
        kill $(pidof chrome) >/dev/null 2>&1 || true
        kill $(pidof dbus-daemon) >/dev/null 2>&1 || true
        kill $(pidof Xvfb) >/dev/null 2>&1 || true
    fi

    rm -f /run/dbus/pid
    rm -f /tmp/.X10-lock || true

    # Clean up /tmp but preserve X11 sockets directory
    # Create a temporary backup of .X11-unix if it exists
    if [ -d "/tmp/.X11-unix" ]; then
        mv /tmp/.X11-unix /tmp/.X11-unix.backup 2>/dev/null || true
    fi

    # Clean other tmp files (avoid removing everything)
    find /tmp -maxdepth 1 -type f -delete 2>/dev/null || true
    find /tmp -maxdepth 1 -type d ! -name tmp ! -name .X11-unix.backup -exec rm -rf {} + 2>/dev/null || true

    # Restore X11 directory if we backed it up
    if [ -d "/tmp/.X11-unix.backup" ]; then
        mv /tmp/.X11-unix.backup /tmp/.X11-unix
    fi

    echo "Cleaning up processes..."
    "$NODE_PID" && kill -SIGTERM "$NODE_PID" 2>/dev/null || true
    "$FFMPEG_PID" && kill -SIGTERM "$FFMPEG_PID" 2>/dev/null || true

    # Give them a few seconds to exit gracefully
    sleep 3

    "$NODE_PID" && kill -SIGKILL "$NODE_PID" 2>/dev/null || true
    "$FFMPEG_PID" && kill -SIGKILL "$FFMPEG_PID" 2>/dev/null || true


    sleep 1
}

# Trap termination signals
# trap cleanup SIGINT SIGTERM EXIT

# Start Xvfb (virtual X server)
start_xvfb() {
    log "Starting Xvfb on display :10..."

    # Create new X authority file
    touch /tmp/.Xauthority
    chmod 600 /tmp/.Xauthority

    # Generate a MIT-MAGIC-COOKIE-1 for authentication
    xauth add :10 MIT-MAGIC-COOKIE-1 $(openssl rand -hex 16)

    # Start Xvfb with broader permissions
    Xvfb :10 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &

    # Ensure X11 unix socket directory exists with proper permissions
    mkdir -p /tmp/.X11-unix
    chmod 1777 /tmp/.X11-unix/

    # Start Xvfb (without -socketdir since it's not supported)
    Xvfb :10 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
    XVFB_PID=$!

    # Wait for Xvfb to initialize
    max_attempts=10
    attempt=1
    while [ $attempt -le $max_attempts ]; do
        if DISPLAY=:10 xdpyinfo >/dev/null 2>&1; then
            log "Xvfb started successfully on display :10"
            return 0
        fi
        log "Attempt $attempt/$max_attempts: Waiting for Xvfb..."
        attempt=$((attempt + 1))
        sleep 1
    done
    log "ERROR: Xvfb failed to start properly"
    return 1
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

       # Initial cleanup
       cleanup

       # Start Xvfb before anything else
       start_xvfb || exit 1
       xdpyinfo -display :10 || echo "Cannot connect to X server"

       # Initialize services
       init_dbus || exit 1
       verify_chrome || exit 1
       start_nginx || exit 1

       # Set required environment variables
       export CDP_REDIRECT_PORT=9223

       # Use standard DISPLAY format since we're using standard Xvfb
       export DISPLAY=:10

       # Verify the display is working
       log "Testing display connection..."
       if DISPLAY=:10 xdpyinfo >/dev/null 2>&1; then
           log "Display connection verified successfully"
       else
           log "ERROR: Display connection test failed"
           exit 1
       fi

    # Log environment state
    log "Environment configuration:"
    log "HOST=$HOST"
    log "CDP_REDIRECT_PORT=$CDP_REDIRECT_PORT"
    log "NODE_ENV=$NODE_ENV"
    log "DISPLAY=$DISPLAY"

    # Start the application
    # Run the `npm run start` command but without npm.
    # NPM will introduce its own signal handling
    # which will prevent the container from waiting
    # for a session to be released before stopping gracefully
    # Start Node.js in background
    echo "Starting Node.js application..."
    node ./api/build/index.js &
    NODE_PID=$!
    echo "Node.js PID: $NODE_PID"

    sleep 3  # Give Node a bit to start

    # Find Chromium window
    WINDOW_ID=$(xdotool search --name Chromium | while read id; do
        geom=$(xwininfo -id $id | awk '/geometry/{print $2}')
        if "$geom" == "1919x1079--9--9"; then
            echo $id
            break
        fi
    done)

    # Start ffmpeg in background
    echo "Starting ffmpeg capture..."
    ffmpeg -fflags +nobuffer -nostats -hide_banner \
            -f x11grab -framerate 30 -video_size 1920x1080 \
            -i :10.0 \
            -use_wallclock_as_timestamps 1 \
            -c:v libvpx -deadline realtime -cpu-used 8 \
            -threads 4 -error-resilient 1 -auto-alt-ref 0 \
           -lag-in-frames 0 -b:v 2M -maxrate 2.5M \
            -bufsize 500k -g 15 -keyint_min 10 -pix_fmt yuv420p \
            -an -f rtp rtp://127.0.0.1:5004 &
    FFMPEG_PID=$!
    echo "ffmpeg PID: $FFMPEG_PID"

    # Start Go server in foreground (PID 1)
    echo "Starting Go server..."
    ./api/pion_server
}

main "$@"
