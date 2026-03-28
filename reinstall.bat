@echo off
title ScholarClaw Reinstall

echo.
echo =======================================
echo  ScholarClaw Reinstall Tool
echo =======================================
echo.

cd /d "%~dp0"
echo Current: %CD%
echo.

echo WARNING: This will delete node_modules and dist!
echo.
set /p confirm="Continue? (Y/N): "
if /I not "%confirm%"=="Y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo [1/4] Cleaning old files...

if exist node_modules (
    rmdir /s /q node_modules
    echo OK: Deleted node_modules
)
if exist dist (
    rmdir /s /q dist
    echo OK: Deleted dist
)
if exist package-lock.json (
    del package-lock.json
    echo OK: Deleted package-lock.json
)

echo.
echo [2/4] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js not installed!
    echo Please install from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node --version') do echo OK: Node.js %%i

echo.
echo [3/4] Installing dependencies...
echo This may take a few minutes...
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
echo [4/4] Building project...
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: Build failed!
    echo.
    pause
    exit /b 1
)
echo OK: Build complete

echo.
echo =======================================
echo  Reinstall Complete!
echo =======================================
echo.
echo Next step: Run start.bat
echo.
pause