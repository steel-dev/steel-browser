#!/bin/sh
set -e  # Exit on error

# Function to log with timestamp
log() {
    if [ "$DEBUG" = "true" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    fi
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
    log "Starting Node.js application..."
    exec node ./api/build/index.js
}

main "$@"