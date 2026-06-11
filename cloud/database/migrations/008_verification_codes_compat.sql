-- ============================================================
-- Migration 008: Make legacy verification_codes compatible
-- Created: 2026-06-06
-- Description:
--   Older production tables used a boolean "used" column and did not have
--   status/attempts/updated_at/metadata. Current code expects those columns.
-- ============================================================

ALTER TABLE verification_codes ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE verification_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE verification_codes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

UPDATE verification_codes
SET status = CASE
  WHEN COALESCE(used, FALSE) = TRUE THEN 'used'
  WHEN expires_at <= CURRENT_TIMESTAMP THEN 'expired'
  ELSE 'pending'
END
WHERE status IS NULL;

ALTER TABLE verification_codes ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE verification_codes ALTER COLUMN status SET NOT NULL;

ALTER TABLE verification_codes DROP CONSTRAINT IF EXISTS verification_codes_status_check;
ALTER TABLE verification_codes
  ADD CONSTRAINT verification_codes_status_check
  CHECK (status IN ('pending', 'used', 'expired'));

CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup
  ON verification_codes(email, type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at
  ON verification_codes(expires_at);

-- ============================================================
-- Complete
-- ============================================================
