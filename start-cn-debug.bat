@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Short-term diagnosis: preserve the window and also save a full combined log.
set "LOG_LEVEL=info"
set "GACHA_VERBOSE_LOGS=true"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-cn-debug.ps1" -RetentionDays 3
set "exitCode=%errorlevel%"
echo.
echo Debug server exited with code %exitCode%.
pause
exit /b %exitCode%
