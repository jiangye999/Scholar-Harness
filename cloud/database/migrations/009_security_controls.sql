-- Security hardening: audit trail, rate-limit evidence, payment callback risk notes.

CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'info'
        CHECK (risk_level IN ('info', 'low', 'medium', 'high', 'critical')),
    ip_address VARCHAR(64),
    device_id VARCHAR(120),
    user_agent TEXT,
    source VARCHAR(40),
    route TEXT,
    method VARCHAR(12),
    status_code INTEGER,
    request_id VARCHAR(80),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_events_user_created
    ON security_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_ip_created
    ON security_events(ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_device_created
    ON security_events(device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created
    ON security_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_risk_created
    ON security_events(risk_level, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_request_id
    ON security_events(request_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS risk_status VARCHAR(20) DEFAULT 'unchecked'
    CHECK (risk_status IN ('unchecked', 'passed', 'review', 'blocked'));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_payments_risk_status ON payments(risk_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_external_payment_success
    ON payments(payment_method, external_payment_id)
    WHERE external_payment_id IS NOT NULL AND status = 'success';
