-- ============================================================
-- Migration 012: Add one-time lifetime beta codes
-- Description: Adds a permanent-access beta code type that can be
--              redeemed by exactly one user.
-- ============================================================

ALTER TABLE beta_codes DROP CONSTRAINT IF EXISTS beta_codes_code_type_check;

ALTER TABLE beta_codes
  ADD CONSTRAINT beta_codes_code_type_check
  CHECK (code_type IN ('trial', 'premium_trial', 'extended_trial', 'lifetime_2d', 'lifetime_once', 'limited_trial_2d_15d'));

COMMENT ON COLUMN beta_codes.code_type IS
  '内测码类型: trial=30天试用, premium_trial=高级试用, extended_trial=延长试用, lifetime_2d=2天限时永久码/不限使用人数, lifetime_once=一次性永久码/每码仅1人, limited_trial_2d_15d=2天限时15天试用码/不限使用人数';

-- ============================================================
