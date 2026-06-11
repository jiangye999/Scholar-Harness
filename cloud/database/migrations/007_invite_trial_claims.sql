-- ============================================================
-- Migration 007: Invite trial entitlement with hardware lock
-- Created: 2026-06-06
-- Description:
--   Users who invite 3 verified users can claim one 30-day trial extension.
--   The claim is one-time per account and one-time per hardware device.
-- ============================================================

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_type_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_type_check
  CHECK (plan_type IN ('monthly', 'quarterly', 'yearly', 'lifetime', 'trial'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'expired', 'cancelled', 'pending', 'trial', 'exhausted'));

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quota_total INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quota_used INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quota_remaining INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS max_file_upload INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS file_upload_used INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS invite_trial_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(100) NOT NULL,
    device_name VARCHAR(100),
    device_os VARCHAR(100),
    referred_count_at_claim INTEGER NOT NULL,
    required_referrals INTEGER NOT NULL DEFAULT 3,
    bonus_days INTEGER NOT NULL DEFAULT 30,
    subscription_id UUID REFERENCES subscriptions(id),
    claimed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT invite_trial_claims_user_unique UNIQUE (user_id),
    CONSTRAINT invite_trial_claims_device_unique UNIQUE (device_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_trial_claims_user_id ON invite_trial_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_invite_trial_claims_device_id ON invite_trial_claims(device_id);
CREATE INDEX IF NOT EXISTS idx_invite_trial_claims_claimed_at ON invite_trial_claims(claimed_at);

COMMENT ON TABLE invite_trial_claims IS
  '邀请试用领取记录：每个账号只能领取一次，每台硬件设备只能领取一次。';

-- ============================================================
-- Complete
-- ============================================================
