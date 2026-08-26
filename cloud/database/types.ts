export interface User {
  id: string;
  email: string;
  phone?: string;
  password_hash: string;
  username?: string;
  avatar_url?: string;
  role: 'user' | 'premium' | 'admin' | 'beta_tester';
  source: 'cloud' | 'exe';
  referral_code?: string;
  referred_by?: string;
  distributor_id?: string;
  referral_earnings: number;
  created_at: Date;
  updated_at: Date;
  last_login_at?: Date;
  status: 'active' | 'suspended' | 'deleted' | 'pending';
  email_verified: boolean;
  phone_verified: boolean;
  metadata?: Record<string, any>;
  
  // 用户同意机制字段（合规要求）
  privacy_policy_accepted_at?: Date;       // 隐私政策同意时间
  user_agreement_accepted_at?: Date;       // 用户协议同意时间
  cross_border_transfer_accepted_at?: Date; // 数据跨境传输同意时间
  privacy_policy_version?: string;         // 同意的隐私政策版本
  user_agreement_version?: string;         // 同意的用户协议版本
}

export interface VerificationCode {
  id: string;
  email: string;
  code: string;
  type: 'register' | 'reset_password' | 'change_email' | 'change_phone';
  status: 'pending' | 'used' | 'expired';
  attempts: number;
  expires_at: Date;
  used_at?: Date;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export type PlanType = 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | 'trial';

export interface Subscription {
  id: string;
  user_id: string;
  plan_type: PlanType;
  status: 'active' | 'expired' | 'cancelled' | 'pending' | 'trial' | 'exhausted';
  start_date: Date;
  end_date: Date;
  auto_renew: boolean;
  next_renewal_date?: Date;
  price: number;
  currency: string;
  discount_percent: number;
  payment_method?: 'wechat' | 'alipay' | 'stripe' | 'beta_code' | 'invite_trial';
  last_payment_id?: string;
  trial_start?: Date;
  trial_end?: Date;
  
  // 兼容旧数据库/旧客户端的观测字段。订阅不再按字符数或文件数限额；
  // quota_total/quota_remaining/max_file_upload 固定为 -1。
  quota_total: number;
  quota_used: number;
  quota_remaining: number;
  max_file_upload: number;
  file_upload_used: number;
  
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface ActivationCode {
  id: string;
  code: string;
  code_type: 'beta' | 'standard' | 'premium' | 'lifetime';
  status: 'unused' | 'used' | 'expired' | 'disabled';
  purchaser_id?: string;
  activation_id?: string;
  price: number;
  currency: string;
  validity_days: number;
  expires_at?: Date;
  batch_id?: string;
  batch_name?: string;
  referral_code_used?: string;
  referral_bonus: number;
  created_at: Date;
  used_at?: Date;
  updated_at: Date;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface Activation {
  id: string;
  code_id: string;
  user_id: string;
  status: 'active' | 'expired' | 'revoked' | 'transferred';
  device_id: string;
  device_name?: string;
  device_os?: string;
  device_ip?: string;
  activation_token?: string;
  hardware_hash?: string;
  activated_at: Date;
  expires_at: Date;
  last_verified_at?: Date;
  verification_count: number;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface ReferralRecord {
  id: string;
  referrer_id: string;
  referee_id: string;
  source_type: 'activation_code' | 'subscription' | 'renewal';
  source_id?: string;
  purchase_amount: number;
  bonus_rate: number;
  bonus_amount: number;
  status: 'pending' | 'confirmed' | 'paid' | 'cancelled';
  settled_at?: Date;
  payment_method?: 'wechat' | 'alipay' | 'bank';
  payment_account?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface UserMemory {
  id: string;
  user_id: string;
  memory_type: string;
  key: string;
  value: string;
  source?: string;
  value_structured?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface Conversation {
  id: string;
  user_id: string;
  title?: string;
  summary?: string;
  key_topics: string[];
  status: 'active' | 'archived' | 'deleted';
  message_count: number;
  created_at: Date;
  updated_at: Date;
  last_message_at?: Date;
  metadata?: Record<string, any>;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface FileRecord {
  id: string;
  user_id: string;
  original_name: string;
  file_type?: string;
  file_size?: number;
  storage_provider: string;
  storage_key: string;
  storage_url?: string;
  parse_status: 'pending' | 'processing' | 'completed' | 'failed';
  parsed_content?: string;
  uploaded_at: Date;
  parsed_at?: Date;
  expires_at?: Date;
  metadata?: Record<string, any>;
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  api_provider: string;
  api_url: string;
  api_key_encrypted: string;
  primary_model: string;
  temperature: number;
  max_tokens: number;
  status: 'active' | 'disabled' | 'expired';
  is_validated: boolean;
  last_validated_at?: Date;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface Payment {
  id: string;
  user_id: string;
  payment_type: 'subscription' | 'activation_code' | 'renewal';
  related_id?: string;
  amount: number;
  currency: string;
  payment_method: 'wechat' | 'alipay' | 'stripe' | 'manual';
  status: 'pending' | 'processing' | 'success' | 'failed' | 'refunded' | 'cancelled';
  risk_status?: 'unchecked' | 'passed' | 'review' | 'blocked';
  risk_score?: number;
  external_transaction_id?: string;
  external_payment_id?: string;
  refund_amount?: number;
  refund_reason?: string;
  refunded_at?: Date;
  created_at: Date;
  paid_at?: Date;
  updated_at: Date;
  notes?: string;
  metadata?: Record<string, any>;
  distributor_id?: string;
}

export interface Distributor {
  id: string;
  name: string;
  invite_code: string;
  contact_name?: string;
  contact_phone?: string;
  commission_rate: number;
  status: 'active' | 'disabled';
  notes?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface WithdrawRequest {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  payment_method: 'wechat' | 'alipay' | 'bank';
  payment_account: string;
  account_name?: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'cancelled';
  external_transaction_id?: string;
  created_at: Date;
  processed_at?: Date;
  updated_at: Date;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface SystemConfig {
  id: string;
  config_key: string;
  config_value: string;
  config_type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AdminLog {
  id: string;
  admin_id: string;
  action: string;
  target_type?: string;
  target_id?: string;
  details?: Record<string, any>;
  created_at: Date;
  ip_address?: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  username?: string;
  phone?: string;
  source: 'cloud' | 'exe';
  referral_code?: string;
  
  // 用户同意字段（合规要求）
  accept_privacy_policy: boolean;    // 必须同意隐私政策
  accept_user_agreement: boolean;    // 必须同意用户协议
  accept_cross_border_transfer?: boolean; // 可选同意数据跨境传输
  privacy_policy_version?: string;   // 同意的版本
  user_agreement_version?: string;   // 同意的版本
}

export interface CreateSubscriptionInput {
  user_id: string;
  plan_type: PlanType;
  price: number;
  currency?: string;
  payment_method: 'wechat' | 'alipay' | 'stripe' | 'beta_code' | 'invite_trial';
  auto_renew?: boolean;
  
}

export interface CreateActivationCodeInput {
  code_type: 'beta' | 'standard' | 'premium' | 'lifetime';
  price: number;
  validity_days?: number;
  batch_id?: string;
  batch_name?: string;
  quantity: number;
}

export interface ActivateCodeInput {
  code: string;
  user_id: string;
  device_id: string;
  device_name?: string;
  device_os?: string;
  device_ip?: string;
}

export interface CreateWithdrawInput {
  user_id: string;
  amount: number;
  payment_method: 'wechat' | 'alipay' | 'bank';
  payment_account: string;
  account_name?: string;
}

// ==================== BetaCode 内测码相关类型 ====================

export interface BetaCode {
  id: string;
  code: string;
  code_type: 'trial' | 'premium_trial' | 'extended_trial' | 'lifetime_2d' | 'lifetime_once' | 'limited_trial_2d_15d';
  validity_days: number;           // 试用天数
  status: 'unused' | 'used' | 'expired' | 'disabled';
  batch_id?: string;
  batch_name?: string;
  used_by?: string;                // 使用者用户ID
  used_at?: Date;
  expires_at?: Date;               // 内测码本身过期时间（可选）
  notes?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export interface CreateBetaCodeInput {
  quantity: number;                // 批量生成数量 (1-100)
  code_type?: 'trial' | 'premium_trial' | 'extended_trial' | 'lifetime_2d' | 'lifetime_once' | 'limited_trial_2d_15d';
  validity_days?: number;          // 默认 30 天
  batch_id?: string;
  batch_name?: string;
  expires_at?: Date;
  notes?: string;
  created_by?: string;
}

export interface UseBetaCodeInput {
  code: string;
  user_id: string;
}

export interface BetaCodeStats {
  total: number;
  unused: number;
  used: number;
  expired: number;
  disabled: number;
}

export interface InviteTrialClaim {
  id: string;
  user_id: string;
  device_id: string;
  device_name?: string;
  device_os?: string;
  referred_count_at_claim: number;
  required_referrals: number;
  bonus_days: number;
  subscription_id?: string;
  claimed_at: Date;
  metadata?: Record<string, any>;
}
