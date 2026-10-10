# ==============================================================================
# EVENTRA Windows Browser Companion Launcher (Option A)
# ==============================================================================
# Launches the visible local Windows Browser Agent controlled by Playwright.
#
# Usage:
#   .\run-companion.ps1
#   .\run-companion.ps1 -Code "ABC123"
# ==============================================================================

param (
    [string]$Code = "",
    [string]$ApiUrl = "http://localhost:8000/api",
    [string]$WsUrl = "ws://localhost:8000/api/browser-companion/ws"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   EVENTRA Windows Browser Companion (Option A)" -ForegroundColor Cyan
Write-Host "   Genuinely Visible Local Chromium / Microsoft Edge Browser" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Node.js
try {
    $nodeVer = (node -v).Trim()
    Write-Host "[OK] Node.js is installed: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js was not found in your PATH." -ForegroundColor Red
    Write-Host "Please install Node.js (v18+) from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# 2. Ensure dependencies are installed
if (-not (Test-Path "node_modules")) {
    Write-Host "[SETUP] Installing Playwright dependencies in tools/windows-companion..." -ForegroundColor Yellow
    npm install --silent
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install npm dependencies." -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Dependencies installed successfully." -ForegroundColor Green
}

# 3. Check for pairing code or existing session
$sessionFile = Join-Path $ScriptDir ".companion_session.json"
if ([string]::IsNullOrWhiteSpace($Code) -and (-not (Test-Path $sessionFile))) {
    Write-Host ""
    Write-Host "Enter the 6-character Pairing Code generated in the EVENTRA dashboard" -ForegroundColor Yellow
    Write-Host "(e.g., from the 'Browser Autonomous Agent' popup on your event page):" -ForegroundColor Gray
    $Code = Read-Host "Pairing Code"
    Write-Host ""
}

# 4. Launch companion.mjs
$cliArgs = @("companion.mjs", "--api", $ApiUrl, "--ws", $WsUrl)
if (-not [string]::IsNullOrWhiteSpace($Code)) {
    $cliArgs += @("--code", $Code.Trim().ToUpper())
}

Write-Host "[START] Launching Windows Browser Companion..." -ForegroundColor Cyan
node @cliArgs
