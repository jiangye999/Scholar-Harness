-- Migration 015: Distributor self-service portal accounts

CREATE TABLE IF NOT EXISTS distributor_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    distributor_id UUID NOT NULL UNIQUE REFERENCES distributors(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distributor_accounts_email_lower
    ON distributor_accounts (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_distributor_accounts_status
    ON distributor_accounts (status);

COMMENT ON TABLE distributor_accounts IS
    '分销商独立登录账户。账户只允许访问其绑定 distributor_id 的邀请和消费数据。';
