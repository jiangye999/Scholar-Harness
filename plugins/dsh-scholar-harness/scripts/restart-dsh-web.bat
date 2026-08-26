@echo off
rem ============================================================
rem  Restart the dsh web server so newly installed plugins
rem  (dsh-scholar-harness and friends) take effect.
rem
rem  Run as Administrator from any directory. The current GUI
rem  session will drop briefly and return at the same URL
rem  (http://127.0.0.1:3080) after a browser refresh.
rem
rem  Requires: the web profile's package.json dsh.profile.bundles
rem  already lists dsh-scholar-harness (installed by `dsh plugin add`).
rem ============================================================
setlocal

rem --- Locate the dsh launcher (npx cache first, then PATH) ---------
set "DSH_CMD="
for %%d in (
    "%LOCALAPPDATA%\npm-cache\_npx\*\node_modules\.bin\dsh.cmd"
    "%USERPROFILE%\AppData\Local\npm-cache\_npx\*\node_modules\.bin\dsh.cmd"
) do (
    if not defined DSH_CMD if exist "%%~d" set "DSH_CMD=%%~d"
)
if not defined DSH_CMD (
    where dsh >nul 2>&1 && set "DSH_CMD=dsh"
)
if not defined DSH_CMD (
    echo dsh not found. Install it or set DSH_CMD manually.
    exit /b 1
)
echo Using dsh: %DSH_CMD%

echo [1/3] Stopping dsh web (port 3080)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3080 .*LISTENING"') do (
    echo   killing PID %%p
    taskkill /PID %%p /F >nul 2>&1
)

echo [2/3] Waiting for the port to free...
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
netstat -ano | findstr /r /c:":3080 .*LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    set /a tries+=1
    if %tries% lss 10 goto wait
    echo   port still busy after 10s - aborting
    exit /b 1
)

echo [3/3] Starting dsh web (profile: web, host 127.0.0.1, port 3080)...
start "dsh web" /min cmd /c ""%DSH_CMD%" web --host 127.0.0.1 --port 3080"

echo Done. Refresh http://127.0.0.1:3080 in your browser.
echo Expect: sidebar "Scholar" entry; agent prompt gains the scholar_* tools.
endlocal
