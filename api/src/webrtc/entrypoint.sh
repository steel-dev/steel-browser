#!/bin/bash
set -e

WINDOW_TITLE="Chromium"

# Function to clean up background processes when the script exits
cleanup() {
  echo "Cleaning up processes..."

  if kill -0 "$FFMPEG_PID" 2>/dev/null; then
    kill -SIGTERM "$FFMPEG_PID" 2>/dev/null || true
    # Give ffmpeg max 3s to exit, then force kill
    for i in {1..30}; do
      if ! kill -0 "$FFMPEG_PID" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    kill -9 "$FFMPEG_PID" 2>/dev/null || true
  fi

  pkill -P $$ || true  # Kill all other child processes
  exit 0
}
# Set trap to call cleanup function when script receives termination signal
trap cleanup SIGINT SIGTERM EXIT

sleep 1

# Ensure we have proper X11 permissions
if [ -f "/tmp/.Xauthority" ]; then
  echo "Using shared X authority file"
  export XAUTHORITY=/tmp/.Xauthority
fi


# Add this before trying to find the window
echo "Testing X server connection..."
xdpyinfo -display :10 || echo "Cannot connect to X server"

# Use DISPLAY=:10 to match the headful browser container
WINDOW_ID=$(xdotool search --name Chromium | while read id; do
    geom=$(xwininfo -id $id | awk '/geometry/{print $2}')
    if [[ "$geom" == "1919x1079--9--9" ]]; then
        echo $id
        break
    fi
done)

ffmpeg -fflags +nobuffer -nostats -hide_banner \
      -f x11grab -framerate 30 -video_size 1920x1080 \
      -i :10.0 \
      -use_wallclock_as_timestamps 1 \
      -c:v libvpx \
      -deadline realtime \
      -cpu-used 8 \
      -threads 4 \
      -error-resilient 1 \
      -auto-alt-ref 0 \
      -lag-in-frames 0 \
      -b:v 2M \
      -maxrate 2.5M \
      -bufsize 500k \
      -g 15 \
      -keyint_min 10 \
      -pix_fmt yuv420p \
      -an \
      -f rtp rtp://127.0.0.1:5004 &
      # -f tee "[f=matroska]/recordings/$(date +%s)_$(hostname).webm|[f=rtp]rtp://127.0.0.1:5004"
    # -f matroska /recordings/$(date +%s)_$(hostname).webm
    # -f rtp rtp://127.0.0.1:5004

# Start Pion WebRTC server
echo "Starting Pion WebRTC server..."
exec /app/server
