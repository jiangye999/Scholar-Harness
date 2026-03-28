@echo off
chcp 65001 >nul
title OpenClaw PATH 配置助手
echo.
echo ==========================================
echo     OpenClaw PATH 配置助手
echo ==========================================
echo.

set /p OPENCLAW_PATH="请输入 OpenClaw 项目的完整路径 (例如: E:\Projects\openclaw): "

if "%OPENCLAW_PATH%"=="" (
    echo [ERROR] 路径不能为空！
    pause
    exit /b 1
)

if not exist "%OPENCLAW_PATH%\index.js" (
    echo [ERROR] 未找到 index.js，请确认路径是否正确！
    echo [INFO] 你输入的路径: %OPENCLAW_PATH%
    pause
    exit /b 1
)

echo.
echo [INFO] OpenClaw 路径: %OPENCLAW_PATH%
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
echo [步骤 3/3] 配置说明...
echo.
echo ==========================================
echo     [SUCCESS] 配置完成！
echo ==========================================
echo.
echo 重要提示：
echo 1. 请关闭当前命令提示符窗口
echo 2. 打开新的命令提示符
echo 3. 运行以下命令验证：
echo    openclaw --version
echo.
echo 4. 测试浏览器功能：
echo    openclaw browser --action open --url "https://node8.nice188.com/"
echo.
echo 5. 启动 ScholarClaw：
echo    cd E:\AI_projects\scholar-claw-feishu -1.0.0.5
echo    pnpm start
echo.
pause
