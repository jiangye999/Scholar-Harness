#!/bin/bash
# Deploy Prompt Cloud API to Server
# Run this script on your local machine after SSH is configured

SERVER="ubuntu@119.91.116.90"
REMOTE_DIR="/root/cloud"

echo "=== Deploying Prompt Cloud API ==="

# 1. Upload encryption module
echo "[1/4] Uploading encryption.ts..."
scp cloud/prompts/encryption.ts ${SERVER}:${REMOTE_DIR}/prompts/encryption.ts

# 2. Upload prompts routes
echo "[2/4] Uploading prompts.ts..."
scp cloud/server/routes/prompts.ts ${SERVER}:${REMOTE_DIR}/server/routes/prompts.ts

# 3. Build and restart server
echo "[3/4] Building and restarting server..."
ssh ${SERVER} << 'ENDSSH'
cd /root/cloud

# Check if prompts directory exists
mkdir -p prompts

# Rebuild TypeScript
npm run build

# Restart server
sudo systemctl restart cloud-server

# Check status
sudo systemctl status cloud-server --no-pager
ENDSSH

# 4. Test API
echo "[4/4] Testing API endpoints..."
ssh ${SERVER} << 'ENDSSH'
# Test without auth (should fail)
echo "--- Test 1: No auth (expect 401) ---"
curl -s -w "\nHTTP: %{http_code}\n" http://localhost:3001/api/v1/prompts/skills

# Test with JWT (need to get token first)
echo "--- Test 2: Get JWT token ---"
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo "Token obtained: ${TOKEN:0:20}..."
  
  echo "--- Test 3: Get skills list ---"
  curl -s -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/v1/prompts/skills | jq '.'
  
  echo "--- Test 4: Get specific skill ---"
  curl -s -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/v1/prompts/skills/03_introduction_skill | jq '.'
else
  echo "Failed to get token. Check auth endpoint."
fi
ENDSSH

echo "=== Deployment Complete ==="