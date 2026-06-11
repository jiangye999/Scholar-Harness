@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   环境诊断工具
echo ========================================
echo.

echo 当前目录: %CD%
echo.

echo 【检查关键文件】
echo.

if exist "openclaw\index.js" (
    echo ✅ openclaw\index.js 存在
) else (
    echo ❌ openclaw\index.js 不存在
)

if exist "openclaw\node_modules" (
    echo ✅ openclaw\node_modules 存在
) else (
    echo ❌ openclaw\node_modules 不存在
)

if exist "openclaw\node_modules\playwright" (
    echo ✅ playwright 已安装
) else (
    echo ❌ playwright 未安装
)

if exist "dist\src\server\local-server.js" (
    echo ✅ 服务器已构建
) else (
    echo ❌ 服务器未构建
)

echo.
echo 【运行详细诊断】
echo.

node scripts\diagnose-environment.js

echo.
pause