#!/bin/bash
# Check API configurations on server

cd /root/cloud

# Load environment
source .env

echo "=== Distributed API Keys ==="
PGPASSWORD=$DB_PASSWORD psql -U scholar_user -d scholar_harness -c \
  "SELECT key_prefix, key_type, status, is_active, allowed_models, created_at FROM distributed_api_keys ORDER BY created_at DESC LIMIT 5;"

echo ""
echo "=== Upstream API Configs ==="
PGPASSWORD=$DB_PASSWORD psql -U scholar_user -d scholar_harness -c \
  "SELECT provider_name, base_url, is_active, request_count FROM upstream_api_configs;"

echo ""
echo "=== API Pricing (available models) ==="
PGPASSWORD=$DB_PASSWORD psql -U scholar_user -d scholar_harness -c \
  "SELECT model_name, display_name, provider, is_active, is_listed FROM api_pricing WHERE is_active = TRUE LIMIT 10;"