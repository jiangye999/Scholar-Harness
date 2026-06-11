@echo off
cd /d "%~dp0"
echo Starting Scholar Harness...
echo.
dist\scholar-harness.exe
if %errorlevel% neq 0 (
    echo.
    echo Error occurred. Press any key to exit...
    pause >nul
)
pause