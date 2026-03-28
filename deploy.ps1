# ScholarClaw Deploy Script (PowerShell)

$ErrorActionPreference = "Stop"

# Simple color functions
function Write-Step { param($num, $total, $m) Write-Host "[$num/$total] $m" -ForegroundColor Yellow }
function Write-Success { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Note { param($m) Write-Host "  -> $m" -ForegroundColor Gray }
function Write-Err { param($m) Write-Host "  [X] $m" -ForegroundColor Red }

# Main
Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ScholarClaw Deploy Wizard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check environment
Write-Step 1 5 "Checking environment..."
Write-Host ""

try { node --version | Out-Null; Write-Success "Node.js: $(node --version)" } catch { Write-Err "Node.js not installed"; exit 1 }
try { pnpm --version | Out-Null; Write-Success "pnpm: $(pnpm --version)" } catch { Write-Note "Installing pnpm..."; npm install -g pnpm; Write-Success "pnpm installed" }

Write-Host ""
Read-Host "Press Enter to continue..."

# Step 2: Install deps
Write-Step 2 5 "Installing dependencies..."
Write-Host ""
Write-Note "Running: pnpm install"
pnpm install
Write-Success "Done"

Write-Host ""
Read-Host "Press Enter to continue..."

# Step 3: Configure API
Write-Step 3 5 "Configuring API..."
Write-Host ""

$apiUrl = Read-Host "API URL [https://modelgate.cn/v1]"
if (-not $apiUrl) { $apiUrl = "https://modelgate.cn/v1" }
Write-Success "API URL: $apiUrl"

Write-Host ""
$apiKey = Read-Host "API Key (required)"
while (-not $apiKey) { Write-Err "API Key required"; $apiKey = Read-Host "API Key (required)" }
Write-Success "API Key: set"

Write-Host ""
$primaryModel = Read-Host "AI Model [claude-sonnet-4-5]"
if (-not $primaryModel) { $primaryModel = "claude-sonnet-4-5" }
Write-Success "Model: $primaryModel"

Write-Host ""
$port = Read-Host "Port [18789]"
if (-not $port) { $port = "18789" }
Write-Success "Port: $port"

Write-Host ""
Read-Host "Press Enter to continue..."

# Step 4: Choose platform
Write-Step 4 5 "Configuring message platform..."
Write-Host ""
Write-Host "Choose platform:"
Write-Host "  1. Feishu (recommended)"
Write-Host "  2. Telegram"
Write-Host "  3. Skip for now"
Write-Host ""

$platform = Read-Host "Select [1]"
if (-not $platform) { $platform = "1" }

$feishuAppId = ""
$feishuAppSecret = ""
$telegramToken = ""

if ($platform -eq "1") {
    Write-Host ""
    Write-Host "Feishu config:"
    $feishuAppId = Read-Host "  App ID (cli_xxxxx)"
    $feishuAppSecret = Read-Host "  App Secret"
    Write-Success "Feishu configured"
} elseif ($platform -eq "2") {
    Write-Host ""
    Write-Host "Telegram config:"
    $telegramToken = Read-Host "  Bot Token"
    Write-Success "Telegram configured"
} else {
    Write-Note "Skipped"
}

Write-Host ""
Read-Host "Press Enter to continue..."

# Step 5: Start
Write-Step 5 5 "Starting service..."
Write-Host ""

# Write .env
@"
API_URL=$apiUrl
API_KEY=$apiKey
PRIMARY_MODEL=$primaryModel
PORT=$port
HOST=0.0.0.0
DATA_DIR=./data
LOG_LEVEL=info
DEBUG=false
FEISHU_APP_ID=$feishuAppId
FEISHU_APP_SECRET=$feishuAppSecret
TELEGRAM_BOT_TOKEN=$telegramToken
"@ | Out-File -FilePath ".env" -Encoding UTF8

Write-Success "Config saved: .env"

Write-Host ""
Write-Note "Building..."
pnpm build
Write-Success "Build complete"

Write-Host ""
Write-Note "Starting service..."

if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }
Start-Process -FilePath "pnpm" -ArgumentList "start:feishu" -WindowStyle Hidden
Start-Sleep -Seconds 3

Write-Success "Service started!"
Write-Host ""

# Done
Write-Host "========================================" -ForegroundColor Cyan
Write-Success "Deploy Complete!"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service: http://localhost:$port" -ForegroundColor White
Write-Host "Health:  http://localhost:$port/health" -ForegroundColor Gray
Write-Host ""
