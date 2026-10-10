@echo off
setlocal
cd /d "%~dp0"

echo =======================================================
echo   EVENTRA Windows Browser Companion (Option A)
echo =======================================================

if "%~1"=="" (
    set /p CODE="Enter 6-character Pairing Code: "
) else (
    set CODE=%~1
)

if "%CODE%"=="" (
    echo [ERROR] No pairing code provided.
    exit /b 1
)

echo.
echo [*] Launching Companion with code: %CODE%
echo.
node companion.mjs --code %CODE%
pause
