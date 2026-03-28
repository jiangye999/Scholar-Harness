@echo off
title ScholarClaw Installer

echo.
echo =======================================
echo  ScholarClaw Installer
echo =======================================
echo.

cd /d "%~dp0"
echo Current: %CD%
echo.

echo [1/2] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js not installed!
    echo.
    echo Please install Node.js 22+ from:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo OK: Node.js installed
echo.

echo [2/2] Installing dependencies...
echo This may take a few minutes, please wait...
echo.

call npm install
if errorlevel 1 (
    echo.
    echo ERROR: Installation failed!
    echo Please check your internet connection.
    echo.
    pause
    exit /b 1
)
echo OK: Dependencies installed
echo.

if not exist ".env" (
    echo Creating config file...
    echo API_URL=https://modelgate.cn/v1 > .env
    echo API_KEY= >> .env
    echo PRIMARY_MODEL=qwen3.5-plus >> .env
    echo PORT=18789 >> .env
    echo OK: Created .env
    echo.
    echo Please edit .env and add your API key!
) else (
    echo OK: .env already exists
)

echo.
echo =======================================
echo  Installation Complete!
echo =======================================
echo.
echo Next step: Run start.bat
echo.
pause