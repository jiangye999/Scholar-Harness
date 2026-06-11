@echo off
chcp 65001 >nul
title Scholar Harness - 学术论文写作助手

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║       Scholar Harness - 对话式学术论文写作助手          ║
echo ║                    版本 1.0.0                           ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

set DATA_DIR=%USERPROFILE%\.scholar-harness
set ACTIVATION_FILE=%DATA_DIR%\activation.json

if not exist "%DATA_DIR%" (
    mkdir "%DATA_DIR%"
)

if exist "%ACTIVATION_FILE%" (
    echo [信息] 检测到激活信息，正在验证...
    goto :start_server
)

:check_activation
echo.
echo [重要] 首次使用需要激活
echo.
echo 请选择操作：
echo   1. 输入激活码
echo   2. 购买激活码
echo   3. 退出
echo.
set /p choice=请输入选项 (1-3): 

if "%choice%"=="1" goto :enter_code
if "%choice%"=="2" goto :buy_code
if "%choice%"=="3" exit /b 0
goto :check_activation

:enter_code
echo.
set /p activation_code=请输入激活码: 

if "%activation_code%"=="" (
    echo [错误] 激活码不能为空
    goto :enter_code
)

echo.
echo [信息] 正在验证激活码...

powershell -Command ^
    "$body = @{code='%activation_code%'} | ConvertTo-Json; ^
     try { ^
         $response = Invoke-RestMethod -Uri 'https://api.scholarharness.com/api/v1/activation/verify-code' -Method Post -Body $body -ContentType 'application/json'; ^
         if ($response.valid) { ^
             Write-Host '[成功] 激活码有效'; ^
             $activation = @{activated=$true; code='%activation_code%'; activatedAt=(Get-Date).ToString()}; ^
             $activation | ConvertTo-Json | Out-File -FilePath '%ACTIVATION_FILE%' -Encoding utf8; ^
             exit 0 ^
         } else { ^
             Write-Host '[错误] 激活码无效或已过期'; ^
             exit 1 ^
         } ^
     } catch { ^
         Write-Host '[错误] 网络连接失败，请检查网络后重试'; ^
         exit 1 ^
     }"

if %errorlevel% neq 0 (
    echo.
    echo [提示] 验证失败，请检查激活码是否正确
    goto :check_activation
)

echo.
echo [成功] 激活成功！
timeout /t 2 >nul
goto :start_server

:buy_code
echo.
echo 正在打开购买页面...
start https://scholarharness.com/buy
goto :check_activation

:start_server
echo.
echo [信息] 正在启动服务器...

cd /d "%~dp0"

if not exist "node_modules" (
    echo [信息] 正在安装依赖...
    call npm install --production
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo.
echo [信息] 服务器启动中...
echo [信息] 请在浏览器中访问: http://localhost:18789
echo.
echo [提示] 按 Ctrl+C 可停止服务器
echo.

node dist\src\server\local-server.js

pause