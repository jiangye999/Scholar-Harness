-- ============================================================
-- Scholar Harness Cloud & exe 共享数据库 Schema
-- 版本: 1.0.0
-- 创建日期: 2026-04-01
-- ============================================================

-- 数据库连接配置建议:
-- CREATE DATABASE scholar_harness;
-- CREATE USER scholar_user WITH PASSWORD 'your_password';
-- GRANT ALL PRIVILEGES ON DATABASE scholar_harness TO scholar_user;

-- ============================================================
-- 1. 用户表 (users) - 核心表，云端版和exe版共用
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE,  -- 手机号，可选
    password_hash VARCHAR(255) NOT NULL,  -- bcrypt加密
    username VARCHAR(100),
    avatar_url TEXT,
    
    -- 用户角色
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'premium', 'admin', 'beta_tester')),
    
    -- 版本标识（区分用户来源）
    source VARCHAR(20) NOT NULL CHECK (source IN ('cloud', 'exe')),
    
    -- 邀请系统
    referral_code VARCHAR(20) UNIQUE,  -- 用户专属邀请码
    referred_by UUID REFERENCES users(id),  -- 被谁邀请
    referral_earnings DECIMAL(10,2) DEFAULT 0.00,  -- 累计返利金额
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- 账户状态
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted', 'pending')),
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);
CREATE INDEX idx_users_created_at ON users(created_at);

-- ============================================================
-- 2. 邮箱验证码表 (verification_codes) - 注册/找回密码等邮箱验证
-- ============================================================

CREATE TABLE IF NOT EXISTS verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    type VARCHAR(30) NOT NULL CHECK (type IN ('register', 'reset_password', 'change_email', 'change_phone')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_verification_codes_lookup ON verification_codes(email, type, status, created_at DESC);
CREATE INDEX idx_verification_codes_expires_at ON verification_codes(expires_at);

-- ============================================================
-- 3. 订阅表 (subscriptions) - 云端版季度会员
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 订阅类型
    plan_type VARCHAR(20) NOT NULL CHECK (plan_type IN ('quarterly', 'yearly', 'lifetime')),
    
    -- 订阅状态
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'expired', 'cancelled', 'pending', 'trial')),
    
    -- 订阅周期
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- 自动续费
    auto_renew BOOLEAN DEFAULT FALSE,
    next_renewal_date TIMESTAMP WITH TIME ZONE,
    
    -- 价格信息
    price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'CNY',
    discount_percent DECIMAL(5,2) DEFAULT 0.00,  -- 折扣百分比
    
    -- 支付信息
    payment_method VARCHAR(20),  -- 'wechat', 'alipay', 'stripe'
    last_payment_id UUID,  -- 关联 payments 表
    
    -- 试用信息
    trial_start TIMESTAMP WITH TIME ZONE,
    trial_end TIMESTAMP WITH TIME ZONE,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_end_date ON subscriptions(end_date);
CREATE INDEX idx_subscriptions_next_renewal ON subscriptions(next_renewal_date);

-- ============================================================
-- 3. 内测码表 (activation_codes) - exe版激活码管理
-- ============================================================

CREATE TABLE IF NOT EXISTS activation_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) UNIQUE NOT NULL,  -- 内测码（UUID格式）
    
    -- 内测码类型
    code_type VARCHAR(20) NOT NULL CHECK (code_type IN ('beta', 'standard', 'premium', 'lifetime')),
    
    -- 内测码状态
    status VARCHAR(20) NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'used', 'expired', 'disabled')),
    
    -- 关联用户（购买者）
    purchaser_id UUID REFERENCES users(id),
    
    -- 关联激活记录（使用者）
    activation_id UUID,  -- 关联 activations 表
    
    -- 价格信息
    price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'CNY',
    
    -- 有效期
    validity_days INTEGER DEFAULT 365,  -- 有效天数（365天=1年，-1=永久）
    expires_at TIMESTAMP WITH TIME ZONE,  -- 过期时间（从创建时间计算）
    
    -- 批次信息（批量生成）
    batch_id VARCHAR(50),
    batch_name VARCHAR(100),
    
    -- 邀请返利
    referral_code_used VARCHAR(20),  -- 购买时使用的邀请码
    referral_bonus DECIMAL(10,2) DEFAULT 0.00,  -- 该码产生的返利金额
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 备注
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_activation_codes_code ON activation_codes(code);
CREATE INDEX idx_activation_codes_status ON activation_codes(status);
CREATE INDEX idx_activation_codes_purchaser ON activation_codes(purchaser_id);
CREATE INDEX idx_activation_codes_batch ON activation_codes(batch_id);
CREATE INDEX idx_activation_codes_created_at ON activation_codes(created_at);

-- ============================================================
-- 4. 激活记录表 (activations) - exe版激活验证日志
-- ============================================================

CREATE TABLE IF NOT EXISTS activations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_id UUID NOT NULL REFERENCES activation_codes(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- 激活状态
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'expired', 'revoked', 'transferred')),
    
    -- 设备信息
    device_id VARCHAR(100) NOT NULL,  -- 设备唯一标识
    device_name VARCHAR(100),
    device_os VARCHAR(50),
    device_ip VARCHAR(50),
    
    -- 激活信息
    activation_token VARCHAR(255),  -- 激活令牌（用于验证）
    hardware_hash VARCHAR(255),  -- 硬件特征哈希（防作弊）
    
    -- 有效期
    activated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- 验证日志
    last_verified_at TIMESTAMP WITH TIME ZONE,
    verification_count INTEGER DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_activations_code_id ON activations(code_id);
CREATE INDEX idx_activations_user_id ON activations(user_id);
CREATE INDEX idx_activations_device_id ON activations(device_id);
CREATE INDEX idx_activations_status ON activations(status);
CREATE INDEX idx_activations_expires_at ON activations(expires_at);

-- ============================================================
-- 5. 返利记录表 (referral_records) - 邀请返利系统
-- ============================================================

CREATE TABLE IF NOT EXISTS referral_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 返利关系
    referrer_id UUID NOT NULL REFERENCES users(id),  -- 邀请人（获得返利）
    referee_id UUID NOT NULL REFERENCES users(id),  -- 被邀请人（购买者）
    
    -- 返利来源
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('activation_code', 'subscription', 'renewal')),
    source_id UUID,  -- 关联 activation_codes 或 subscriptions
    
    -- 返利金额
    purchase_amount DECIMAL(10,2) NOT NULL,  -- 原始购买金额
    bonus_rate DECIMAL(5,2) DEFAULT 30.00,  -- 返利百分比（默认30%）
    bonus_amount DECIMAL(10,2) NOT NULL,  -- 实际返利金额
    
    -- 返利状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled')),
    
    -- 结算信息
    settled_at TIMESTAMP WITH TIME ZONE,
    payment_method VARCHAR(20),  -- 'wechat', 'alipay', 'bank'
    payment_account VARCHAR(100),  -- 支付账号
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_referral_referrer ON referral_records(referrer_id);
CREATE INDEX idx_referral_referee ON referral_records(referee_id);
CREATE INDEX idx_referral_status ON referral_records(status);
CREATE INDEX idx_referral_created_at ON referral_records(created_at);
CREATE INDEX idx_referral_source ON referral_records(source_type, source_id);

-- ============================================================
-- 6. 用户记忆表 (user_memory) - 云端版记忆存储
-- ============================================================

CREATE TABLE IF NOT EXISTS user_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 记忆类型
    memory_type VARCHAR(50) NOT NULL,  -- 'experiment_summary', 'data_summary', 'writing_progress', etc.
    
    -- 记忆内容
    key VARCHAR(100) NOT NULL,  -- 记忆键名
    value TEXT NOT NULL,  -- 记忆内容
    
    -- 来源
    source VARCHAR(50),  -- 'user-input', 'ai-extracted', 'auto-generated'
    
    -- 结构化版本
    value_structured TEXT,  -- 结构化版本（Markdown格式）
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 唯一约束：每个用户的每种记忆类型只能有一个
    UNIQUE(user_id, memory_type, key)
);

-- 创建索引
CREATE INDEX idx_user_memory_user ON user_memory(user_id);
CREATE INDEX idx_user_memory_type ON user_memory(memory_type);
CREATE INDEX idx_user_memory_key ON user_memory(key);
CREATE INDEX idx_user_memory_updated ON user_memory(updated_at);

-- ============================================================
-- 7. 对话记录表 (conversations) - 云端版对话历史
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 对话信息
    title VARCHAR(200),
    summary TEXT,
    key_topics JSONB DEFAULT '[]'::jsonb,  -- 关键话题数组
    
    -- 对话状态
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    
    -- 消息计数
    message_count INTEGER DEFAULT 0,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP WITH TIME ZONE,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_updated ON conversations(updated_at);

-- ============================================================
-- 8. 对话消息表 (conversation_messages) - 对话详细消息
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    
    -- 消息内容
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    
    -- 时间戳
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON conversation_messages(timestamp);

-- ============================================================
-- 9. 文件表 (files) - 云端版文件存储记录
-- ============================================================

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 文件信息
    original_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),  -- 'pdf', 'docx', 'txt', etc.
    file_size INTEGER,  -- 字节数
    
    -- 存储信息
    storage_provider VARCHAR(20) DEFAULT 'oss',  -- 'oss', 's3', 'local'
    storage_key VARCHAR(255) NOT NULL,  -- OSS/S3 key
    storage_url TEXT,  -- 公开访问URL
    
    -- 解析状态
    parse_status VARCHAR(20) DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'completed', 'failed')),
    parsed_content TEXT,  -- 解析后的文本内容
    
    -- 时间戳
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    parsed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,  -- 文件过期时间（可选）
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_files_user ON files(user_id);
CREATE INDEX idx_files_storage_key ON files(storage_key);
CREATE INDEX idx_files_type ON files(file_type);
CREATE INDEX idx_files_uploaded ON files(uploaded_at);

-- ============================================================
-- 10. API密钥表 (api_keys) - 云端版用户API配置
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- API配置
    api_provider VARCHAR(50) NOT NULL,  -- 'openai', 'claude', 'qwen', 'deepseek', etc.
    api_url VARCHAR(255) NOT NULL,
    api_key_encrypted TEXT NOT NULL,  -- AES加密后的API Key
    
    -- 模型配置
    primary_model VARCHAR(100) DEFAULT 'gpt-4o',
    temperature DECIMAL(3,2) DEFAULT 0.70,
    max_tokens INTEGER DEFAULT 4000,
    
    -- 状态
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'expired')),
    
    -- 验证状态
    is_validated BOOLEAN DEFAULT FALSE,
    last_validated_at TIMESTAMP WITH TIME ZONE,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- 唯一约束：每个用户每种provider只能有一个
    UNIQUE(user_id, api_provider)
);

-- 创建索引
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_provider ON api_keys(api_provider);
CREATE INDEX idx_api_keys_status ON api_keys(status);

-- ============================================================
-- 11. 使用量事件表 (usage_events)
-- ============================================================

CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    event_data JSONB DEFAULT '{}'::jsonb,
    device_id VARCHAR(120),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_events_user_created ON usage_events(user_id, created_at DESC);
CREATE INDEX idx_usage_events_subscription_created ON usage_events(subscription_id, created_at DESC);
CREATE INDEX idx_usage_events_type_created ON usage_events(event_type, created_at DESC);
CREATE INDEX idx_usage_events_device_created ON usage_events(device_id, created_at DESC);

-- ============================================================
-- 12. 支付记录表 (payments) - 支付系统核心表
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- 支付类型
    payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('subscription', 'activation_code', 'renewal')),
    related_id UUID,  -- 关联 subscription 或 activation_code
    
    -- 支付金额
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'CNY',
    
    -- 支付方式
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('wechat', 'alipay', 'stripe', 'manual')),
    
    -- 支付状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'refunded', 'cancelled')),
    risk_status VARCHAR(20) DEFAULT 'unchecked' CHECK (risk_status IN ('unchecked', 'passed', 'review', 'blocked')),
    risk_score INTEGER DEFAULT 0,
    
    -- 第三方支付信息
    external_transaction_id VARCHAR(255),  -- 微信/支付宝订单号
    external_payment_id VARCHAR(255),  -- 微信/支付宝支付流水号
    
    -- 退款信息
    refund_amount DECIMAL(10,2),
    refund_reason TEXT,
    refunded_at TIMESTAMP WITH TIME ZONE,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 备注
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_method ON payments(payment_method);
CREATE INDEX idx_payments_external ON payments(external_transaction_id);
CREATE INDEX idx_payments_created ON payments(created_at);
CREATE INDEX idx_payments_risk_status ON payments(risk_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_external_payment_success
    ON payments(payment_method, external_payment_id)
    WHERE external_payment_id IS NOT NULL AND status = 'success';

-- ============================================================
-- 13. 提现请求表 (withdraw_requests) - 返利提现
-- ============================================================

CREATE TABLE IF NOT EXISTS withdraw_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- 提现金额
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'CNY',
    
    -- 提现方式
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('wechat', 'alipay', 'bank')),
    payment_account VARCHAR(100) NOT NULL,  -- 支付账号
    account_name VARCHAR(100),  -- 账号姓名（银行提现需要）
    
    -- 提现状态
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'cancelled')),
    
    -- 第三方支付信息
    external_transaction_id VARCHAR(255),
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- 备注
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 创建索引
CREATE INDEX idx_withdraw_user ON withdraw_requests(user_id);
CREATE INDEX idx_withdraw_status ON withdraw_requests(status);
CREATE INDEX idx_withdraw_created ON withdraw_requests(created_at);

-- ============================================================
-- 14. 系统配置表 (system_config) - 全局配置
-- ============================================================

CREATE TABLE IF NOT EXISTS system_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    config_type VARCHAR(20) DEFAULT 'string',  -- 'string', 'number', 'boolean', 'json'
    
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认配置
INSERT INTO system_config (config_key, config_value, config_type, description) VALUES
('referral_bonus_rate', '30', 'number', '返利百分比'),
('subscription_quarterly_price', '99', 'number', '季度订阅价格（元）'),
('subscription_yearly_price', '299', 'number', '年度订阅价格（元）'),
('activation_code_price', '199', 'number', '内测码价格（元）'),
('activation_code_validity_days', '365', 'number', '内测码有效期（天）'),
('min_withdraw_amount', '50', 'number', '最低提现金额（元）'),
('max_activation_devices', '1', 'number', '每个内测码最大激活设备数'),
('cloud_storage_quota_mb', '100', 'number', '云端存储空间配额（MB）')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================
-- 14. 管理员操作日志表 (admin_logs) - 管理操作审计
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES users(id),
    
    -- 操作信息
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),  -- 'user', 'activation_code', 'subscription', etc.
    target_id UUID,
    
    -- 操作详情
    details JSONB DEFAULT '{}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- IP地址
    ip_address VARCHAR(50)
);

-- 创建索引
CREATE INDEX idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_action ON admin_logs(action);
CREATE INDEX idx_admin_logs_created ON admin_logs(created_at);

-- ============================================================
-- 15. 安全审计事件表 (security_events)
-- ============================================================

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

CREATE INDEX idx_security_events_user_created ON security_events(user_id, created_at DESC);
CREATE INDEX idx_security_events_ip_created ON security_events(ip_address, created_at DESC);
CREATE INDEX idx_security_events_device_created ON security_events(device_id, created_at DESC);
CREATE INDEX idx_security_events_type_created ON security_events(event_type, created_at DESC);
CREATE INDEX idx_security_events_risk_created ON security_events(risk_level, created_at DESC);
CREATE INDEX idx_security_events_request_id ON security_events(request_id);

-- ============================================================
-- 触发器：自动更新 updated_at 字段
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为所有需要 updated_at 的表创建触发器
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_activation_codes_updated_at BEFORE UPDATE ON activation_codes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_activations_updated_at BEFORE UPDATE ON activations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_referral_records_updated_at BEFORE UPDATE ON referral_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_memory_updated_at BEFORE UPDATE ON user_memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_withdraw_requests_updated_at BEFORE UPDATE ON withdraw_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 视图：活跃订阅用户
-- ============================================================

CREATE OR REPLACE VIEW active_subscribers AS
SELECT 
    u.id,
    u.email,
    u.username,
    s.plan_type,
    s.start_date,
    s.end_date,
    s.auto_renew,
    s.next_renewal_date
FROM users u
JOIN subscriptions s ON u.id = s.user_id
WHERE s.status = 'active'
AND s.end_date > CURRENT_TIMESTAMP;

-- ============================================================
-- 视图：返利统计
-- ============================================================

CREATE OR REPLACE VIEW referral_statistics AS
SELECT 
    u.id as referrer_id,
    u.email as referrer_email,
    u.username as referrer_name,
    u.referral_code,
    COUNT(r.id) as total_referrals,
    SUM(r.bonus_amount) as total_bonus,
    SUM(CASE WHEN r.status = 'paid' THEN r.bonus_amount ELSE 0 END) as paid_bonus,
    SUM(CASE WHEN r.status = 'pending' THEN r.bonus_amount ELSE 0 END) as pending_bonus
FROM users u
LEFT JOIN referral_records r ON u.id = r.referrer_id
GROUP BY u.id, u.email, u.username, u.referral_code;

-- ============================================================
-- 完成
-- ============================================================

-- 数据库创建完成提示
-- 下一步：
-- 1. 创建数据库用户: CREATE USER scholar_user WITH PASSWORD 'your_password';
-- 2. 授权: GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO scholar_user;
-- 3. 配置连接字符串: postgresql://scholar_user:your_password@localhost:5432/scholar_harness
