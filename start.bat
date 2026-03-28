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

echo [1/2] Checking build...
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

echo [2/2] Starting server...
echo.
echo =======================================
echo  Server running at:
echo  http://localhost:18789
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