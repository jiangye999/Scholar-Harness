@echo off
chcp 936 >nul
echo ==========================================
echo OpenClaw Diagnostic Tool
echo ==========================================
echo.

echo [Check 1] PATH variable
echo %PATH% | find /i "openclaw" >nul && (
    echo [OK] openclaw found in PATH
echo %PATH%
) || (
    echo [ERROR] openclaw NOT found in PATH!
)
echo.

echo [Check 2] OpenClaw directory
echo Directory: E:\AI_projects\openclaw
if exist "E:\AI_projects\openclaw\openclaw.bat" (
    echo [OK] openclaw.bat exists
) else (
    echo [ERROR] openclaw.bat NOT found!
)
if exist "E:\AI_projects\openclaw\index.js" (
    echo [OK] index.js exists
) else (
    echo [ERROR] index.js NOT found!
)
echo.

echo [Check 3] Node.js
call node --version 2>nul && (
    echo [OK] Node.js installed
) || (
    echo [ERROR] Node.js NOT found!
)
echo.

echo [Check 4] Testing openclaw command
call openclaw --version 2>&1
echo Exit code: %errorlevel%
echo.

echo ==========================================
echo Diagnostic complete
echo ==========================================
pause
