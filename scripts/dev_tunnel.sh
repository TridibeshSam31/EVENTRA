#!/usr/bin/env bash
# ==============================================================================
# EVENTRA - Local Telephony Dev Tunnel (ngrok)
# ==============================================================================
# Starts an ngrok HTTP tunnel on port 8000 and prints the exact environment
# variables required by Exotel for the bidirectional audio WebSocket bridge.
# ==============================================================================

PORT="${PORT:-8000}"

echo "=============================================================================="
echo "Starting ngrok tunnel for EVENTRA API on port ${PORT}..."
echo "=============================================================================="

if ! command -v ngrok &> /dev/null; then
    echo "ERROR: 'ngrok' is not installed or not in PATH."
    echo "Install it via https://ngrok.com/download or:"
    echo "  - Mac: brew install ngrok/ngrok/ngrok"
    echo "  - Linux: curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok"
    echo "  - Windows: choco install ngrok / winget install ngrok"
    echo ""
    echo "Alternatively, you can use Cloudflare Tunnel:"
    echo "  cloudflared tunnel --url http://localhost:8000"
    exit 1
fi

# Launch ngrok in the background if not already running
if ! curl -s http://127.0.0.1:4040/api/tunnels > /dev/null 2>&1; then
    ngrok http "${PORT}" --log=stdout > /dev/null &
    NGROK_PID=$!
    echo "ngrok started in background (PID: ${NGROK_PID}). Waiting for tunnel to establish..."
    sleep 3
fi

# Fetch public URL from local ngrok API
TUNNEL_JSON=$(curl -s http://127.0.0.1:4040/api/tunnels)
PUBLIC_HTTPS=$(echo "${TUNNEL_JSON}" | grep -o 'https://[^"]*' | head -n 1)

if [ -z "${PUBLIC_HTTPS}" ]; then
    echo "Could not automatically determine ngrok URL. Please check http://127.0.0.1:4040 in your browser."
    exit 1
fi

PUBLIC_DOMAIN=$(echo "${PUBLIC_HTTPS}" | sed 's|https://||')
PUBLIC_WSS="wss://${PUBLIC_DOMAIN}"

echo ""
echo "=============================================================================="
echo "ngrok Tunnel Established Successfully!"
echo "=============================================================================="
echo "Public HTTPS URL : ${PUBLIC_HTTPS}"
echo "Public WSS URL   : ${PUBLIC_WSS}"
echo ""
echo "Add or update the following in your .env / apps/api/.env:"
echo "------------------------------------------------------------------------------"
echo "EXOTEL_STREAM_URL=${PUBLIC_WSS}/api/v1/voice/exotel/stream"
echo "EXOTEL_CALLBACK_URL=${PUBLIC_HTTPS}/api/v1/voice/exotel/callback"
echo "------------------------------------------------------------------------------"
echo "Keep this terminal open to keep the tunnel active."
echo "Press Ctrl+C to terminate."

wait
