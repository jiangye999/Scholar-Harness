@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   AI 聊天桥接 - 浏览器启动器
echo ========================================
echo.

cd /d "%~dp0"

REM 尝试从多个位置读取配置文件
set CONFIG_PATH=
set URL=

REM 检查环境变量
if defined CHAT_URL (
    echo 使用环境变量 CHAT_URL: %CHAT_URL%
    set URL=%CHAT_URL%
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
echo 或者设置环境变量: set CHAT_URL=your_url
echo.
pause
exit /b 1

:read_config
echo 正在从配置文件读取 URL...
echo 配置路径: %CONFIG_PATH%

REM 使用 PowerShell 读取 JSON 配置
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content '%CONFIG_PATH%' | ConvertFrom-Json).chat.chat_url"`) do set URL=%%i

if not defined URL (
    echo.
    echo ❌ 配置文件中未找到 chat_url！
    echo 请在聊天界面左下角的 AI 聊天配置中设置 URL
    echo.
    pause
    exit /b 1
)

:found_url
echo.
echo URL: %URL%
echo.
echo 正在打开浏览器...

REM 尝试不同的浏览器
where chrome >nul 2>&1
if %errorlevel% equ 0 (
    echo 使用 Chrome 打开...
    start chrome "%URL%"
    goto :success
)

where msedge >nul 2>&1
if %errorlevel% equ 0 (
    echo 使用 Edge 打开...
    start msedge "%URL%"
    goto :success
)

REM 使用默认浏览器
echo 使用默认浏览器打开...
start "" "%URL%"

:success
echo.
echo ========================================
echo   ✅ 浏览器已打开！
echo ========================================
echo.
echo 接下来请：
echo   1. 如果页面空白，按 F5 刷新
echo   2. 登录你的 AI 聊天服务账号
echo   3. 登录后使用浏览器对话
echo.
echo 登录状态会自动保存。
echo ========================================
echo.
timeout /t 3