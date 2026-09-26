# ==============================================================================
# EVENTRA - Local Telephony Dev Tunnel (PowerShell / Windows)
# ==============================================================================
param (
    [int]$Port = 8000
)

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "Starting ngrok tunnel for EVENTRA API on port $Port..." -ForegroundColor Cyan
Write-Host "=============================================================================="

$ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokCmd) {
    Write-Host "ERROR: 'ngrok' is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install it via:"
    Write-Host "  winget install ngrok.ngrok"
    Write-Host "  OR choco install ngrok"
    Write-Host "  OR download from https://ngrok.com/download"
    Write-Host ""
    Write-Host "Alternative (Cloudflare Tunnel):"
    Write-Host "  cloudflared tunnel --url http://localhost:$Port"
    exit 1
}

# Check if ngrok is already running
$running = $false
try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($res) { $running = $true }
} catch {
    $running = $false
}

if (-not $running) {
    Write-Host "Launching ngrok process..." -ForegroundColor Yellow
    Start-Process ngrok -ArgumentList "http $Port" -WindowStyle Minimized
    Start-Sleep -Seconds 3
}

try {
    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5
    $publicHttps = ($tunnels.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1).public_url

    if (-not $publicHttps) {
        $publicHttps = ($tunnels.tunnels | Select-Object -First 1).public_url
    }

    $domain = $publicHttps -replace "https://", "" -replace "http://", ""
    $publicWss = "wss://$domain"

    Write-Host ""
    Write-Host "==============================================================================" -ForegroundColor Green
    Write-Host "ngrok Tunnel Established Successfully!" -ForegroundColor Green
    Write-Host "=============================================================================="
    Write-Host "Public HTTPS : $publicHttps"
    Write-Host "Public WSS   : $publicWss"
    Write-Host ""
    Write-Host "Copy and paste the following into your .env / apps/api/.env:" -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------------------------"
    Write-Host "EXOTEL_STREAM_URL=$publicWss/api/v1/voice/exotel/stream" -ForegroundColor Green
    Write-Host "EXOTEL_CALLBACK_URL=$publicHttps/api/v1/voice/exotel/callback" -ForegroundColor Green
    Write-Host "------------------------------------------------------------------------------"
} catch {
    Write-Host "Tunnel started, but could not query http://127.0.0.1:4040. Check ngrok web UI directly." -ForegroundColor Red
}
