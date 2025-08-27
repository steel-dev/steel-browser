#!/bin/sh
set -e

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

substitute_env_vars() {
    log "Substituting environment variables in nginx config template..."
    sed -e "s|__API_URL__|${API_URL}|g" /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
}

main() {
    substitute_env_vars
    log "Starting nginx..."
    exec nginx -g 'daemon off;'
}

main "$@"
