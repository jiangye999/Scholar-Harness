/**
 * 认证工具函数
 * 处理用户注册、登录、订阅等云端API调用
 */

// 云端API基础URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://scholarharness.com/api/v1';

/**
 * 用户信息接口
 */
export interface User {
  id: string;
  email: string;
  username?: string;
  avatar_url?: string;  // 用户头像URL
  role: string;
  source?: string;
  referral_code?: string;
  referral_earnings?: number;
  referral_stats?: {
    totalReferrals: number;
    totalEarnings: number;
    pendingBonus: number;
    paidBonus: number;
  };
}

/**
 * 登录响应接口
 */
export interface LoginResponse {
  message: string;
  user: User;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  trial_info?: {
    success: boolean;
    trial_days?: number;
    message: string;
  };
}

/**
 * 注册响应接口
 */
export interface RegisterResponse {
  message: string;
  user: User;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  trial_info?: {
    trial_days: number;
    message: string;
  };
}

/**
 * 订阅信息接口
 */
export interface Subscription {
  plan_type: 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | 'trial';
  status: string;
  quota_total: number;
  quota_used: number;
  quota_remaining: number;
  max_file_upload: number;
  file_upload_used: number;
  start_date: string;
  end_date: string;
}

export interface InviteTrialStatus {
  success: boolean;
  eligible: boolean;
  required_referrals: number;
  referral_count: number;
  remaining_referrals: number;
  claimed_by_user: null | {
    id: string;
    referred_count_at_claim: number;
    required_referrals: number;
    bonus_days: number;
    claimed_at: string;
  };
  claimed_by_device: null | {
    id: string;
    referred_count_at_claim: number;
    required_referrals: number;
    bonus_days: number;
    claimed_at: string;
  };
}

export interface InviteTrialClaimResponse {
  success: boolean;
  code?: string;
  message: string;
  trial_days?: number;
  access_type?: string;
  required_referrals?: number;
  referral_count?: number;
  remaining_referrals?: number;
  subscription?: Subscription;
}

/**
 * 套餐信息接口
 */
export interface Plan {
  plan_type: string;
  price: number;
  validity_days: number;
  quota_total: number;
  max_file_upload: number;
  features: {
    max_file_upload: number;
    ai_model_access: string[];
  };
}

/**
 * 注册同意选项接口
 */
export interface RegisterAgreementOptions {
  accept_privacy_policy: boolean;
  accept_user_agreement: boolean;
  accept_cross_border_transfer?: boolean;
  privacy_policy_version?: string;
  user_agreement_version?: string;
}

export interface CaptchaVerification {
  ticket: string;
  randstr: string;
}

/**
 * 发送邮箱验证码
 */
export async function sendEmailVerificationCode(
  email: string,
  type: 'register' | 'reset_password' = 'register',
  captcha?: CaptchaVerification
): Promise<{
  success: boolean;
  message: string;
  status?: number;
  expiresIn?: number;
}> {
  const response = await fetch(`${API_BASE_URL}/verification/send-email-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      type,
      captchaTicket: captcha?.ticket,
      captchaRandstr: captcha?.randstr,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      success: false,
      message: data.message || '验证码发送失败',
      status: response.status,
    };
  }

  return {
    success: true,
    message: data.message || '验证码已发送到您的邮箱',
    expiresIn: data.expiresIn,
  };
}

/**
 * 用户注册（带邮箱验证码、同意选项和必填授权码/内测码）
 */
export async function register(
  email: string, 
  password: string, 
  verificationCode: string,
  username?: string,
  agreementOptions?: RegisterAgreementOptions,
  betaCode?: string,
  referralCode?: string
): Promise<RegisterResponse> {
  if (!verificationCode) {
    throw new Error('请输入邮箱验证码');
  }

  const normalizedBetaCode = betaCode?.trim().toUpperCase() || '';
  const normalizedReferralCode = referralCode?.trim().toUpperCase() || '';
  if (!normalizedBetaCode && !normalizedReferralCode) {
    throw new Error('注册必须填写授权码/内测码或好友邀请码');
  }

  // 合规验证：必须提供同意选项
  if (!agreementOptions?.accept_privacy_policy) {
    throw new Error('必须同意隐私政策才能注册');
  }
  if (!agreementOptions?.accept_user_agreement) {
    throw new Error('必须同意用户协议才能注册');
  }

  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      username,
      verification_code: verificationCode,
      source: 'cloud',
      accept_privacy_policy: agreementOptions.accept_privacy_policy,
      accept_user_agreement: agreementOptions.accept_user_agreement,
      accept_cross_border_transfer: agreementOptions.accept_cross_border_transfer || false,
      privacy_policy_version: agreementOptions.privacy_policy_version || 'V1.3',
      user_agreement_version: agreementOptions.user_agreement_version || 'V1.3',
      beta_code: normalizedBetaCode || undefined,
      referral_code: normalizedReferralCode || undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '注册失败');
  }

  const data = await response.json();
  
  // 保存tokens到localStorage
  saveTokens(data.tokens);
  saveUser(data.user);
  
  return data;
}

/**
 * 验证授权码/内测码（注册前检查）
 */
export async function validateBetaCode(code: string): Promise<{
  valid: boolean;
  reason?: string;
  validity_days?: number;
  code_type?: string;
  access_type?: 'trial' | 'lifetime';
  unlimited_uses?: boolean;
  message?: string;
}> {
  const response = await fetch(`${API_BASE_URL}/beta-codes/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    return { valid: false, reason: '验证失败，请稍后重试' };
  }

  return await response.json();
}

/**
 * 用户登录
 */
export async function login(email: string, password: string, betaCode?: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      source: 'cloud',
      beta_code: betaCode,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '登录失败');
  }

  const data = await response.json();
  
  // 保存tokens到localStorage
  saveTokens(data.tokens);
  saveUser(data.user);
  
  return data;
}

/**
 * 用户登出
 */
export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('tokenExpiresAt');
    localStorage.removeItem('user');
  }
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(): Promise<User | null> {
  const token = getAccessToken();
  
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // Token无效，清除本地存储
      logout();
      return null;
    }

    const data = await response.json() as { user: User };
    saveUser(data.user);
    return data.user;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
}

/**
 * 获取用户订阅信息
 */
export async function getSubscription(): Promise<Subscription | null> {
  const token = getAccessToken();
  
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/subscription/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // 用户未购买套餐
        return null;
      }
      throw new Error('获取订阅信息失败');
    }

    const data = await response.json() as { subscription: Subscription };
    return data.subscription;
  } catch (error) {
    console.error('获取订阅信息失败:', error);
    return null;
  }
}

function getReferralDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'browser-unknown-device';
  }

  const storageKey = 'scholarReferralDeviceId';
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;

  const generated = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(storageKey, generated);
  return generated;
}

export async function getInviteTrialStatus(): Promise<InviteTrialStatus | null> {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const params = new URLSearchParams({ device_id: getReferralDeviceId() });
    const response = await fetch(`${API_BASE_URL}/referral/invite-trial/status?${params.toString()}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('获取邀请奖励状态失败:', error);
    return null;
  }
}

export async function claimInviteTrialReward(): Promise<InviteTrialClaimResponse> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('请先登录');
  }

  const response = await fetch(`${API_BASE_URL}/referral/invite-trial/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      device_id: getReferralDeviceId(),
      device_name: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : 'browser',
      device_os: typeof navigator !== 'undefined' ? navigator.platform : 'web',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || '领取邀请奖励失败');
  }

  return data;
}

/**
 * 获取所有可用套餐
 */
export async function getPlans(): Promise<Plan[]> {
  const response = await fetch(`${API_BASE_URL}/subscription/plans`);

  if (!response.ok) {
    throw new Error('获取套餐列表失败');
  }

  const data = await response.json() as { plans: Plan[] };
  return data.plans;
}

/**
 * 购买套餐
 */
export async function purchasePlan(planType: string, paymentMethod: string): Promise<{
  subscription: any;
  payment: any;
  pay_url?: string;
}> {
  const token = getAccessToken();
  
  if (!token) {
    throw new Error('请先登录');
  }

  const response = await fetch(`${API_BASE_URL}/subscription/purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      plan_type: planType,
      payment_method: paymentMethod,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '购买失败');
  }

  return await response.json();
}

/**
 * 刷新accessToken
 */
export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken,
      }),
    });

    if (!response.ok) {
      logout();
      return false;
    }

    const data = await response.json() as { tokens: LoginResponse['tokens'] };
    saveTokens(data.tokens);
    return true;
  } catch (error) {
    console.error('刷新Token失败:', error);
    logout();
    return false;
  }
}

/**
 * 保存tokens到localStorage
 */
function saveTokens(tokens: LoginResponse['tokens']): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    localStorage.setItem('tokenExpiresAt', String(Date.now() + tokens.expiresIn * 1000));
  }
}

/**
 * 保存用户信息到localStorage
 */
function saveUser(user: User): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('user', JSON.stringify(user));
  }
}

/**
 * 获取accessToken
 */
export function getAccessToken(): string | null {
  if (typeof window !== 'undefined') {
    // 检查token是否过期
    const expiresAt = localStorage.getItem('tokenExpiresAt');
    if (expiresAt && Date.now() > parseInt(expiresAt, 10)) {
      // Token过期，尝试刷新
      refreshAccessToken();
      return null;
    }
    
    return localStorage.getItem('accessToken');
  }
  return null;
}

/**
 * 获取refreshToken
 */
function getRefreshToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('refreshToken');
  }
  return null;
}

/**
 * 从localStorage获取用户信息
 */
export function getStoredUser(): User | null {
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr) as User;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 检查用户是否已登录
 */
export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

/**
 * 检查用户是否有活跃订阅
 * trial 状态是内测码激活的试用期订阅，属于有效状态
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const subscription = await getSubscription();
  return subscription !== null && (subscription.status === 'active' || subscription.status === 'trial');
}

/**
 * 每日用量统计接口
 */
export interface DailyStat {
  date: string;
  word_count: number;
  file_count: number;
}

/**
 * 用量统计响应接口
 */
export interface DailyStatsResponse {
  daily_stats: DailyStat[];
  subscription: {
    plan_type: string;
    quota_remaining: number;
    quota_total: number;
  };
}

/**
 * 获取每日用量统计（用于柱状图）
 */
export async function getDailyStats(): Promise<DailyStatsResponse | null> {
  const token = getAccessToken();
  
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/usage/daily-stats`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('获取用量统计失败:', error);
    return null;
  }
}

/**
 * 格式化字数显示
 */
export function formatWordCount(count: number): string {
  if (count === -1) return '无限';
  if (!count) return '0字';
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万字`;
  }
  return `${count}字`;
}

export interface ApiBalance {
  balance_cents?: number;
  balance_yuan?: number;
  total_recharged_cents?: number;
  total_used_cents?: number;
  total_available_words?: number;
  used_words?: number;
  remaining_words?: number;
}

export interface RechargeTier {
  amount: number;
  label?: string;
  bonus?: number;
  words?: number;
}

export interface BillingRules {
  minimum_recharge: number;
  maximum_recharge: number;
  custom_amount_allowed: boolean;
  base_price_per_1k: number;
  cost_ratio: number;
  currency: string;
}

export interface DistributedApiKey {
  id: string;
  key_name: string;
  key_type?: string;
  status?: string;
  created_at?: string;
  last_used_at?: string | null;
  usage_count?: number;
}

export interface DistributedApiKeyType {
  type: string;
  label: string;
  description?: string;
}

export interface ApiPricingModel {
  model: string;
  label?: string;
  price_per_1k?: number;
}

export interface ApiUsageLog {
  id: string;
  model?: string;
  word_count?: number;
  cost_cents?: number;
  created_at?: string;
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('请先登录');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

async function parseApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || fallbackMessage);
  }
  return data as T;
}

export async function getApiBalance(): Promise<ApiBalance> {
  return parseApiResponse<ApiBalance>(
    await authedFetch('/api-pricing/balance'),
    '获取API余额失败'
  );
}

export async function getRechargeTiers(): Promise<{ tiers: RechargeTier[]; billing_rules: BillingRules }> {
  const response = await fetch(`${API_BASE_URL}/api-pricing/recharge-tiers`);
  if (!response.ok) {
    return {
      tiers: [],
      billing_rules: {
        minimum_recharge: 1,
        maximum_recharge: 10000,
        custom_amount_allowed: true,
        base_price_per_1k: 0.025,
        cost_ratio: 0.5,
        currency: 'CNY',
      },
    };
  }
  return response.json();
}

export async function createApiRecharge(
  amount: number,
  paymentMethod: string
): Promise<{ payment_url?: string; order_id?: string; message?: string }> {
  return parseApiResponse(
    await authedFetch('/api-pricing/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, payment_method: paymentMethod }),
    }),
    '充值请求失败'
  );
}

export async function getApiPricing(): Promise<{ models: ApiPricingModel[]; base_price_per_1k?: number }> {
  const response = await fetch(`${API_BASE_URL}/api-pricing/models`);
  if (!response.ok) {
    return { models: [], base_price_per_1k: 0.025 };
  }
  return response.json();
}

export async function getApiUsageLogs(limit?: number): Promise<{ logs: ApiUsageLog[] }> {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return parseApiResponse<{ logs: ApiUsageLog[] }>(
    await authedFetch(`/api-pricing/usage-logs${query}`),
    '获取API用量日志失败'
  );
}

export async function getMyDistributedApiKeys(): Promise<{ keys: DistributedApiKey[] }> {
  return parseApiResponse<{ keys: DistributedApiKey[] }>(
    await authedFetch('/distributed-api-keys/my-keys'),
    '获取API密钥列表失败'
  );
}

export async function getDistributedApiKeyTypes(): Promise<{
  types: DistributedApiKeyType[];
  max_keys_per_user: number;
}> {
  const response = await fetch(`${API_BASE_URL}/distributed-api-keys/types`);
  if (!response.ok) {
    return { types: [], max_keys_per_user: 5 };
  }
  return response.json();
}

export async function createDistributedApiKey(
  keyName: string,
  keyType: string
): Promise<{ api_key?: string; key?: DistributedApiKey; message?: string }> {
  return parseApiResponse(
    await authedFetch('/distributed-api-keys/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_name: keyName, key_type: keyType }),
    }),
    '创建API密钥失败'
  );
}

export async function revealDistributedApiKey(keyId: string): Promise<{ api_key: string }> {
  return parseApiResponse<{ api_key: string }>(
    await authedFetch(`/distributed-api-keys/reveal/${encodeURIComponent(keyId)}`),
    '获取API密钥失败'
  );
}

export async function revokeDistributedApiKey(keyId: string): Promise<void> {
  await parseApiResponse(
    await authedFetch(`/distributed-api-keys/revoke/${encodeURIComponent(keyId)}`, {
      method: 'POST',
    }),
    '撤销API密钥失败'
  );
}

export async function disableDistributedApiKey(keyId: string): Promise<void> {
  await parseApiResponse(
    await authedFetch(`/distributed-api-keys/disable/${encodeURIComponent(keyId)}`, {
      method: 'POST',
    }),
    '禁用API密钥失败'
  );
}

export async function enableDistributedApiKey(keyId: string): Promise<void> {
  await parseApiResponse(
    await authedFetch(`/distributed-api-keys/enable/${encodeURIComponent(keyId)}`, {
      method: 'POST',
    }),
    '启用API密钥失败'
  );
}
