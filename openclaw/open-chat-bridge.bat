@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   AI 聊天桥接 - 手动登录工具
echo ========================================
echo.

cd /d "%~dp0"

REM 尝试从多个位置读取配置文件
set CONFIG_PATH=
set CHAT_URL=

REM 检查环境变量
if defined CHAT_URL (
    echo 使用环境变量 CHAT_URL: %CHAT_URL%
    goto :found_url
)

REM 尝试读取配置文件（开发环境）
if exist "..\src\bridge\chat-bridge\config.json" (
    set CONFIG_PATH=..\src\bridge\chat-bridge\config.json
    goto :read_config
)

REM 尝试读取配置文件（打包环境）
if exist "..\dist\src\bridge\chat-bridge\config.json" (
    set CONFIG_PATH=..\dist\src\bridge\chat-bridge\config.json
    goto :read_config
)

REM 尝试读取配置文件（Electron resources）
if exist "..\app.asar.unpacked\dist\src\bridge\chat-bridge\config.json" (
    set CONFIG_PATH=..\app.asar.unpacked\dist\src\bridge\chat-bridge\config.json
    goto :read_config
)

REM 配置文件不存在，提示用户
echo.
echo ❌ 未找到配置文件！
echo.
echo 请在聊天界面左下角的 AI 聊天配置中设置 URL
echo 或者设置环境变量 CHAT_URL
echo.
pause
exit /b 1

:read_config
echo 正在从配置文件读取 URL...
echo 配置路径: %CONFIG_PATH%

REM 使用 PowerShell 读取 JSON 配置
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content '%CONFIG_PATH%' | ConvertFrom-Json).chat.chat_url"`) do set CHAT_URL=%%i

if not defined CHAT_URL (
    echo.
    echo ❌ 配置文件中未找到 chat_url！
    echo 请在聊天界面左下角的 AI 聊天配置中设置 URL
    echo.
    pause
    exit /b 1
)

:found_url
echo.
echo 配置的 URL: %CHAT_URL%
echo.

echo 正在启动浏览器...

REM 启动手动模式服务
start "ChatBridge Manual" /min node index-manual.js serve

REM 等待服务启动
timeout /t 2 /nobreak >nul

REM 打开浏览器
curl -s -X POST http://localhost:19222/open -H "Content-Type: application/json" -d "{\"url\":\"%CHAT_URL%\"}"

echo.
echo ========================================
echo   浏览器已打开！
echo ========================================
echo.
echo 接下来请手动操作：
echo.
echo 1. 如果页面空白，请刷新页面（按 F5）
echo 2. 登录你的 AI 聊天服务账号
echo 3. 登录后可以直接使用浏览器对话
echo.
echo 提示：
echo - 登录状态会自动保存
echo - 下次打开会保持登录
echo - 服务在后台运行（端口 19222）
echo.
echo ========================================
echo.
pause