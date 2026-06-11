#!/bin/bash
# Test Prompt Cloud API (run on server)
# Usage: ./test-prompts-api.sh

API_BASE="http://localhost:3001/api/v1/prompts"

echo "=== Testing Prompt Cloud API ==="

# Test 1: Health check (no auth required)
echo "[Test 1] Health check..."
curl -s http://localhost:3001/api/v1/health | jq '.' || echo "Health endpoint not available"

# Test 2: Skills list without auth (expect 401)
echo "[Test 2] Skills list - no auth (expect 401)..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" ${API_BASE}/skills)
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")
echo "Status: $HTTP_CODE"
echo "Body: $BODY"

# Test 3: Get valid JWT token
echo "[Test 3] Getting JWT token..."
# Option A: From auth endpoint
TOKEN_RESPONSE=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}')

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // .access_token // empty')

if [ -z "$TOKEN" ]; then
  echo "Auth endpoint failed. Trying test token generation..."
  # Option B: Generate test token (if server has test mode)
  TOKEN="test-token-placeholder"
fi

# Test 4: Skills list with auth
echo "[Test 4] Skills list - with auth..."
if [ -n "$TOKEN" ] && [ "$TOKEN" != "test-token-placeholder" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" ${API_BASE}/skills | jq '.'
else
  echo "Skipping - no valid token"
fi

# Test 5: Get specific skill
echo "[Test 5] Get introduction skill..."
if [ -n "$TOKEN" ] && [ "$TOKEN" != "test-token-placeholder" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" \
    ${API_BASE}/skills/03_introduction_skill | jq '.'
else
  echo "Skipping - no valid token"
fi

# Test 6: Check database directly
echo "[Test 6] Database check..."
PGPASSWORD=$(grep DB_PASSWORD /root/cloud/.env | cut -d= -f2)
if [ -n "$PGPASSWORD" ]; then
  echo "Skills in database:"
  PGPASSWORD=$PGPASSWORD psql -U scholar_user -d scholar_harness -t -c \
    "SELECT skill_id, title, LENGTH(content) as content_length FROM prompts WHERE skill_id LIKE '%_skill' ORDER BY skill_id;"
else
  echo "Cannot check database - no password in .env"
fi

echo "=== Test Complete ==="