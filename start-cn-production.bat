@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Production mode: keep warnings/errors and important lifecycle summaries,
rem while suppressing Fastify access logs, gacha details and hot-path game logs.
set "LOG_LEVEL=warn"
set "GACHA_VERBOSE_LOGS=false"
set "GAME_VERBOSE_LOGS=false"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-cn-logged.ps1" -RetentionDays 7
if errorlevel 1 (
    echo.
    echo Failed to start CN StarPoint production mode.
    pause
)
