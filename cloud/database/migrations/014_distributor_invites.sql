-- Migration 014: Long-lived distributor invite attribution and commission reporting

CREATE TABLE IF NOT EXISTS distributors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL,
    invite_code VARCHAR(20) NOT NULL UNIQUE,
    contact_name VARCHAR(120),
    contact_phone VARCHAR(80),
    commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0
        CHECK (commission_rate >= 0 AND commission_rate <= 100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distributors_invite_code_upper
    ON distributors (UPPER(invite_code));
CREATE INDEX IF NOT EXISTS idx_distributors_status
    ON distributors (status);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS distributor_id UUID REFERENCES distributors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_distributor_created
    ON users (distributor_id, created_at DESC);

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS distributor_id UUID REFERENCES distributors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_distributor_paid
    ON payments (distributor_id, paid_at DESC)
    WHERE status IN ('success', 'refunded');

-- Backfill attribution for payments that pre-date this migration.
UPDATE payments AS payment
SET distributor_id = users.distributor_id
FROM users
WHERE payment.user_id = users.id
  AND payment.distributor_id IS NULL
  AND users.distributor_id IS NOT NULL;

COMMENT ON TABLE distributors IS
    '长期有效的分销商邀请码、分成比例和管理状态。邀请码本身不设置过期时间。';
COMMENT ON COLUMN users.distributor_id IS
    '注册时使用的分销商邀请码归因；一个用户只归因到一个分销商。';
COMMENT ON COLUMN payments.distributor_id IS
    '支付创建时固化的分销商归因，用于逐笔购买和分成审计。';
