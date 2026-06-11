-- ============================================================
-- Migration 006: Add limited-time lifetime beta codes
-- Created: 2026-05-16
-- Description: Adds a 2-day campaign code type that can be used by unlimited users
--              and grants lifetime access to each account that redeems it.
-- ============================================================

ALTER TABLE beta_codes DROP CONSTRAINT IF EXISTS beta_codes_code_type_check;

ALTER TABLE beta_codes
  ADD CONSTRAINT beta_codes_code_type_check
  CHECK (code_type IN ('trial', 'premium_trial', 'extended_trial', 'lifetime_2d'));

COMMENT ON COLUMN beta_codes.code_type IS
  '内测码类型: trial=30天试用, premium_trial=高级试用, extended_trial=延长试用, lifetime_2d=2天限时永久码/不限使用人数';

-- ============================================================
-- Complete
-- ============================================================
