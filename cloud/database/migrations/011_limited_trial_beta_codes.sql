-- ============================================================
-- Migration 011: Add limited-time unlimited-use 15-day trial code
-- Created: 2026-06-10
-- Description: Adds a 2-day campaign code type that can be used by
--              unlimited users and grants a 15-day trial to each account.
-- ============================================================

ALTER TABLE beta_codes DROP CONSTRAINT IF EXISTS beta_codes_code_type_check;

ALTER TABLE beta_codes
  ADD CONSTRAINT beta_codes_code_type_check
  CHECK (code_type IN ('trial', 'premium_trial', 'extended_trial', 'lifetime_2d', 'limited_trial_2d_15d'));

COMMENT ON COLUMN beta_codes.code_type IS
  '内测码类型: trial=30天试用, premium_trial=高级试用, extended_trial=延长试用, lifetime_2d=2天限时永久码/不限使用人数, limited_trial_2d_15d=2天限时15天试用码/不限使用人数';

-- ============================================================
-- Complete
-- ============================================================
