-- Usage accounting table required by /api/v1/usage/report.
-- This table is intentionally separate from security_events:
-- usage_events is for quota/accounting; security_events is for abuse/risk audit.

CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    event_data JSONB DEFAULT '{}'::jsonb,
    device_id VARCHAR(120),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
    ON usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_subscription_created
    ON usage_events(subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_type_created
    ON usage_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_device_created
    ON usage_events(device_id, created_at DESC);
