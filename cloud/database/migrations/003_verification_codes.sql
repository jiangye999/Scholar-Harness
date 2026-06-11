-- ============================================================
-- Migration: Add Email Verification Codes
-- Version: 003
-- Date: 2026-05-15
-- Purpose: Store one-time email verification codes for registration
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('register', 'reset_password', 'change_email', 'change_phone')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup
    ON verification_codes(email, type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at
    ON verification_codes(expires_at);

COMMENT ON TABLE verification_codes IS 'One-time verification codes for email-based flows';
COMMENT ON COLUMN verification_codes.email IS 'Lowercase email address receiving the code';
COMMENT ON COLUMN verification_codes.code IS 'Six-digit verification code';
COMMENT ON COLUMN verification_codes.type IS 'Verification flow type';
COMMENT ON COLUMN verification_codes.attempts IS 'Failed verification attempts for the latest code';
