-- ============================================================
-- Migration: Add User Consent Fields
-- Version: 001
-- Date: 2026-04-25
-- Purpose: Add privacy policy, user agreement, and cross-border 
--          transfer consent tracking fields to users table
-- ============================================================

-- Add consent tracking fields for privacy policy
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_policy_accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_policy_version VARCHAR(20) DEFAULT 'V1.0';

-- Add consent tracking fields for user agreement
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_agreement_accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_agreement_version VARCHAR(20) DEFAULT 'V1.0';

-- Add consent tracking fields for cross-border data transfer
ALTER TABLE users ADD COLUMN IF NOT EXISTS cross_border_transfer_accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cross_border_transfer_version VARCHAR(20) DEFAULT 'V1.0';

-- Add composite index for consent queries
CREATE INDEX IF NOT EXISTS idx_users_consent ON users(
    privacy_policy_accepted_at,
    user_agreement_accepted_at,
    cross_border_transfer_accepted_at
);

-- Add comment for documentation
COMMENT ON COLUMN users.privacy_policy_accepted_at IS 'Timestamp when user accepted privacy policy';
COMMENT ON COLUMN users.privacy_policy_version IS 'Version of privacy policy accepted';
COMMENT ON COLUMN users.user_agreement_accepted_at IS 'Timestamp when user accepted user agreement';
COMMENT ON COLUMN users.user_agreement_version IS 'Version of user agreement accepted';
COMMENT ON COLUMN users.cross_border_transfer_accepted_at IS 'Timestamp when user accepted cross-border data transfer consent (optional)';
COMMENT ON COLUMN users.cross_border_transfer_version IS 'Version of cross-border transfer policy accepted';

-- ============================================================
-- Note: This migration is reversible with rollback script
-- ============================================================