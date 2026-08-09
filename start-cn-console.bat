@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CN StarPoint - Console

echo.
echo ========================================
echo   CN StarPoint foreground console mode
echo ========================================
echo.
echo The server logs will remain visible in this window.
echo Closing this window stops the server.
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Install Node.js or add node.exe to the system PATH, then try again.
    set "exitCode=1"
    goto :finish
)

if not exist ".env" (
    echo [ERROR] .env was not found in: %CD%
    set "exitCode=1"
    goto :finish
)

if not exist "out\cn-server.js" (
    echo [ERROR] out\cn-server.js was not found.
    echo Run npm run build first, then start the server again.
    set "exitCode=1"
    goto :finish
)

echo Starting CN StarPoint...
echo HTTP: 8001    TCP: 8003
echo.

set "LOG_LEVEL=info"
set "GACHA_VERBOSE_LOGS=false"
node --env-file=.env out/cn-server.js
set "exitCode=%errorlevel%"

echo.
echo Server process exited with code %exitCode%.

:finish
echo.
pause
exit /b %exitCode%
