@echo off
title ScholarClaw Server

cd /d "%~dp0"

echo.
echo =======================================
echo  Starting ScholarClaw...
echo =======================================
echo.

if not exist node_modules (
    echo ERROR: node_modules not found!
    echo Please run install.bat first.
    echo.
    pause
    exit /b 1
)

echo [1/3] Checking build...
if not exist "dist\src\server\local-server.js" (
    echo Building project...
    call npm run build
    if errorlevel 1 (
        echo.
        echo ERROR: Build failed!
        echo.
        pause
        exit /b 1
    )
    echo OK: Build complete
) else (
    echo OK: Build exists
)
echo.

echo [2/3] Starting OpenClaw service (port 19222)...
cd /d "%~dp0openclaw"
if not exist node_modules (
    echo Installing OpenClaw dependencies...
    call npm install
)
start "OpenClaw Service" cmd /c "node index.js serve --port 19222"
echo OK: OpenClaw service started
cd /d "%~dp0"
echo.

echo [3/3] Starting ScholarClaw server...
echo.
echo =======================================
echo  Services running:
echo  - OpenClaw:  http://localhost:19222
echo  - ScholarClaw: http://localhost:18789
echo =======================================
echo.
echo Press Ctrl+C to stop
echo.

call npm start

if errorlevel 1 (
    echo.
    echo ERROR: Server failed to start!
    echo.
    pause
)