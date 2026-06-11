# Deploy Prompt Cloud API (Windows PowerShell)
# Run: .\scripts\deploy-prompts-api.ps1

$Server = "ubuntu@119.91.116.90"
$RemoteDir = "/root/cloud"

Write-Host "=== Deploying Prompt Cloud API ===" -ForegroundColor Cyan

# Check if SSH is available
$sshAvailable = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshAvailable) {
    Write-Host "ERROR: SSH not available. Install OpenSSH or use Git Bash." -ForegroundColor Red
    Write-Host "Alternative: Use WinSCP or manually upload files." -ForegroundColor Yellow
    exit 1
}

# 1. Upload encryption.ts
Write-Host "[1/4] Uploading encryption.ts..." -ForegroundColor Yellow
scp cloud\prompts\encryption.ts ${Server}:${RemoteDir}/prompts/encryption.ts
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Success" -ForegroundColor Green
} else {
    Write-Host "  Failed (check SSH key/password)" -ForegroundColor Red
}

# 2. Upload prompts.ts
Write-Host "[2/4] Uploading prompts.ts..." -ForegroundColor Yellow
scp cloud\server\routes\prompts.ts ${Server}:${RemoteDir}/server/routes/prompts.ts
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Success" -ForegroundColor Green
} else {
    Write-Host "  Failed (check SSH key/password)" -ForegroundColor Red
}

# 3. Build and restart on server
Write-Host "[3/4] Building and restarting server..." -ForegroundColor Yellow
ssh $Server @"
cd /root/cloud
mkdir -p prompts
npm run build
sudo systemctl restart cloud-server
sudo systemctl status cloud-server --no-pager
"@

# 4. Quick test
Write-Host "[4/4] Quick API test..." -ForegroundColor Yellow
ssh $Server "curl -s -w '\nHTTP: %{http_code}\n' http://localhost:3001/api/v1/prompts/skills"

Write-Host "=== Deployment Complete ===" -ForegroundColor Cyan