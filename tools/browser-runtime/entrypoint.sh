#!/usr/bin/env bash
set -e

DISPLAY="${DISPLAY:-:99}"
RESOLUTION="${RESOLUTION:-1280x800x24}"
VIEWER_PORT="${VIEWER_PORT:-6080}"
API_PORT="${API_PORT:-9223}"

echo "=========================================================="
echo "      EVENTRA REAL LIVE BROWSER RUNTIME STARTING          "
echo "=========================================================="
echo "Display: $DISPLAY ($RESOLUTION)"
echo "noVNC Port: $VIEWER_PORT"
echo "Runtime API Port: $API_PORT"

# Clean up any leftover X lock files
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

echo "[1/5] Starting Xvfb virtual framebuffer on $DISPLAY..."
Xvfb "$DISPLAY" -screen 0 "$RESOLUTION" -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait briefly for Xvfb to initialize
sleep 1

echo "[2/5] Starting Fluxbox window manager on $DISPLAY..."
fluxbox -display "$DISPLAY" &
FLUXBOX_PID=$!

echo "[3/5] Starting x11vnc server on 127.0.0.1:5900..."
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 -bg -quiet

echo "[4/5] Starting noVNC / websockify on port $VIEWER_PORT..."
# Find novnc web directory
NOVNC_DIR="/usr/share/novnc"
if [ ! -d "$NOVNC_DIR" ]; then
    NOVNC_DIR="/usr/share/novnc/"
fi
websockify --web "$NOVNC_DIR" "$VIEWER_PORT" 127.0.0.1:5900 &
WEBSOCKIFY_PID=$!

cleanup() {
    echo "Shutting down EVENTRA Browser Runtime components..."
    kill $WEBSOCKIFY_PID $FLUXBOX_PID $XVFB_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "[5/5] Starting Browser Runtime Controller API on port $API_PORT..."
exec uvicorn server:app --host 0.0.0.0 --port "$API_PORT"
