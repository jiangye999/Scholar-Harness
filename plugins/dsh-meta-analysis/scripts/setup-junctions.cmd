@echo off
rem ============================================================
rem  Recreate the node_modules/@deepseek-ai/* junctions pointing at
rem  the DSH installation's own copies. Required on a fresh clone:
rem  the plugin's host half imports @deepseek-ai/dsh-tools etc., and
rem  Node resolves those through this package's node_modules.
rem
rem  Run from the package root (dsh-meta-analysis/) as the same
rem  user that installed dsh (npx cache path below).
rem ============================================================
setlocal

set "DSH_NODE_MODULES=C:\Users\Administrator\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules"
if not exist "%DSH_NODE_MODULES%\@deepseek-ai\dsh-tools" (
    echo DSH installation not found at %DSH_NODE_MODULES%
    echo Set DSH_NODE_MODULES to the directory containing @deepseek-ai.
    exit /b 1
)

if not exist "node_modules\@deepseek-ai" mkdir "node_modules\@deepseek-ai"

for %%p in (dsh-tools cordis dsh-host-webserver dsh-system-prompt) do (
    if exist "node_modules\@deepseek-ai\%%p" (
        echo exists: %%p
    ) else (
        mklink /J "node_modules\@deepseek-ai\%%p" "%DSH_NODE_MODULES%\@deepseek-ai\%%p"
    )
)

echo Done. Verify with: npm run smoke
endlocal
