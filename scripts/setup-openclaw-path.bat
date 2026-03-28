@echo off
chcp 65001 >nul
title OpenClaw PATH 配置助手
echo.
echo ==========================================
echo     OpenClaw PATH 配置助手
echo ==========================================
echo.

set "OPENCLAW_PATH=%~dp0"
set "OPENCLAW_PATH=%OPENCLAW_PATH:~0,-1%"

echo [INFO] 检测到 OpenClaw 路径: %OPENCLAW_PATH%
echo.

echo [步骤 1/3] 添加到用户 PATH...
echo.

for /f "tokens=2*" %%a in ('reg query HKCU\Environment /v PATH 2^>nul ^| findstr PATH') do set "USER_PATH=%%b"

if defined USER_PATH (
    echo %USER_PATH% | find /i "%OPENCLAW_PATH%" >nul && (
        echo [INFO] OpenClaw 已在 PATH 中，跳过...
    ) || (
        setx PATH "%USER_PATH%;%OPENCLAW_PATH%" >nul 2>&1
        echo [SUCCESS] 已添加到用户 PATH
    )
) else (
    setx PATH "%OPENCLAW_PATH%" >nul 2>&1
    echo [SUCCESS] 已创建 PATH 并添加 OpenClaw
)

echo.
echo [步骤 2/3] 创建 openclaw.bat 包装器...
echo.

if not exist "%OPENCLAW_PATH%\openclaw.bat" (
    (
        echo @echo off
        echo cd /d "%OPENCLAW_PATH%"
        echo node index.js %%*
    ) > "%OPENCLAW_PATH%\openclaw.bat"
    echo [SUCCESS] 已创建 openclaw.bat
) else (
    echo [INFO] openclaw.bat 已存在，跳过...
)

echo.
echo [步骤 3/3] 验证配置...
echo.

timeout /t 2 /nobreak >nul

echo [测试] 尝试运行 openclaw --version...
echo.

openclaw --version 2>nul

if %errorlevel% equ 0 (
    echo.
    echo ==========================================
    echo     [SUCCESS] 配置成功！
    echo ==========================================
    echo.
    echo 现在你可以在任意位置使用 openclaw 命令了。
    echo.
) else (
    echo.
    echo ==========================================
    echo     [WARNING] 需要重启终端
    echo ==========================================
    echo.
    echo PATH 已更新，但需要重启命令提示符才能生效。
    echo.
    echo 请执行以下步骤：
    echo 1. 关闭此窗口
    echo 2. 打开新的命令提示符
    echo 3. 运行: openclaw --version
    echo.
)

echo 按任意键退出...
pause >nul
