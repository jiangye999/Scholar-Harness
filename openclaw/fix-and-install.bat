@echo off
chcp 936 >nul
echo ==========================================
echo OpenClaw Quick Fix
echo ==========================================
echo.

cd /d "E:\AI_projects\openclaw"

echo Step 1: Checking dependencies...
if not exist "node_modules\playwright\package.json" (
    echo Installing dependencies...
    call npm install
) else (
    echo Dependencies OK
)
echo.

echo Step 2: Installing Chromium...
call npx playwright install chromium
echo.

echo Step 3: Testing OpenClaw...
call node index.js --version
echo.

echo Step 4: Manual PATH setup instructions:
echo.
echo Please manually add to PATH:
echo   E:\AI_projects\openclaw
echo.
echo Steps:
echo 1. Right-click "This PC" -> Properties -> Advanced system settings
echo 2. Environment Variables
echo 3. User variables -> Path -> Edit
echo 4. New -> E:\AI_projects\openclaw
echo 5. OK -> OK -> OK
echo.
echo Then open NEW Command Prompt and test:
echo   openclaw --version
echo.
pause
