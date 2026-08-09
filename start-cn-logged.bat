@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-cn-logged.ps1"
if errorlevel 1 (
    echo.
    echo Failed to start CN StarPoint.
    pause
)
