'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://scholarharness.com/api/v1';

interface Stats {
  users: { total: number; active: number; premium: number };
  subscriptions: { total: number; active: number; monthly: number; quarterly: number; yearly: number };
  api: { revenue: number; cost: number; profit: number; requests: number };
  today: { revenue: number; profit: number; new_users: number };
  revenue: { total: number; today: number; month: number };
}

interface PricingItem {
  id: string;
  model_name: string;
  display_name: string;
  provider: string;
  model_ratio: number;
  completion_ratio: number;
  quota_type: number;
  model_price: number;
  official_input_price?: number;
  official_output_price?: number;
  is_active: boolean;
  is_listed: boolean;
}

interface UserItem {
  id: string;
  email: string;
  username?: string;
  role: string;
  status: string;
  source: string;
  subscription_plan?: string;
  created_at: string;
  last_login_at?: string;
}

interface PaymentItem {
  id: string;
  user_email: string;
  payment_type: string;
  amount: number;
  currency: string;
  payment_method: string;
  status: string;
  created_at: string;
  paid_at?: string;
}

interface UpstreamConfigItem {
  id: string;
  provider_name: string;
  base_url: string;
  is_default: boolean;
  is_active: boolean;
  description?: string;
  created_at: string;
  has_api_key: boolean;
  lb_strategy: string;
  lb_weight: number;
  lb_priority: number;
  current_connections: number;
  total_requests: number;
  max_connections: number;
  rate_limit_per_minute: number;
  current_minute_requests: number;
  last_used_at?: string;
}

interface LoadBalancerStats {
  provider_name: string;
  current_connections: number;
  total_requests: number;
  available: boolean;
}

type UpstreamEmbeddingConfigItem = UpstreamConfigItem;

interface BetaCodeItem {
  id: string;
  code: string;
  code_type: string;
  status: string;
  validity_days: number;
  batch_id?: string;
  batch_name?: string;
  used_by?: string;
  expires_at?: string;
  used_at?: string;
  created_at: string;
  notes?: string;
}

interface BetaCodeStats {
  total: number;
  unused: number;
  used: number;
  expired: number;
  disabled: number;
}

type DistributorPeriodType = 'month' | 'year';

interface DistributorMetrics {
  period_registrations: number;
  total_registrations: number;
  period_purchases: number;
  gross_revenue: number;
  refund_amount: number;
  net_revenue: number;
  commission_amount: number;
}

interface DistributorPackageBreakdown {
  package_type: string;
  purchase_count: number;
  gross_revenue: number;
  refund_amount: number;
  net_revenue: number;
}

interface DistributorItem {
  id: string;
  name: string;
  invite_code: string;
  contact_name?: string;
  contact_phone?: string;
  commission_rate: number;
  status: 'active' | 'disabled';
  notes?: string;
  created_at: string;
  updated_at: string;
  account: {
    email: string;
    display_name?: string;
    status: 'active' | 'disabled';
    last_login_at?: string;
  } | null;
  metrics: DistributorMetrics;
  package_breakdown: DistributorPackageBreakdown[];
}

interface DistributorSummary {
  distributors: number;
  registrations: number;
  purchases: number;
  net_revenue: number;
  commission_amount: number;
}

interface DistributorPurchase {
  id: string;
  user_email: string;
  username?: string;
  payment_type: string;
  package_type: string;
  amount: number;
  currency: string;
  payment_method: string;
  status: string;
  refund_amount: number;
  net_revenue: number;
  created_at: string;
  paid_at?: string;
}

type BetaCodeKind = 'trial' | 'premium_trial' | 'extended_trial' | 'lifetime_2d' | 'lifetime_once' | 'limited_trial_2d_15d';
type CommercialCardPlanKey = 'month' | 'quarter' | 'year';

interface CommercialCardPlan {
  label: string;
  durationLabel: string;
  codeType: Exclude<BetaCodeKind, 'lifetime_2d' | 'lifetime_once' | 'limited_trial_2d_15d'>;
  validityDays: number;
  batchPrefix: string;
}

interface GeneratedBetaCodesResponse {
  total: number;
  codes: BetaCodeItem[];
  message?: string;
}

const COMMERCIAL_CARD_PLANS: Record<CommercialCardPlanKey, CommercialCardPlan> = {
  month: {
    label: '1个月卡密',
    durationLabel: '30天',
    codeType: 'trial',
    validityDays: 30,
    batchPrefix: '链动小铺-1个月',
  },
  quarter: {
    label: '季度卡密',
    durationLabel: '90天',
    codeType: 'premium_trial',
    validityDays: 90,
    batchPrefix: '链动小铺-季度',
  },
  year: {
    label: '1年卡密',
    durationLabel: '365天',
    codeType: 'extended_trial',
    validityDays: 365,
    batchPrefix: '链动小铺-1年',
  },
};

function getCompactDate(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type AdminTab = 'stats' | 'pricing' | 'users' | 'payments' | 'upstream' | 'embedding' | 'beta-codes' | 'distributors' | 'feedback';

interface FeedbackItem {
  id: string;
  userId?: string;
  userEmail?: string;
  username?: string;
  contact?: string;
  category: string;
  title: string;
  content: string;
  status: string;
  priority: string;
  source?: string;
  appVersion?: string;
  machineId?: string;
  adminNotes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface FeedbackStats {
  total: number;
  open: number;
  reviewing: number;
  resolved: number;
  closed: number;
}


export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('stats');

  // Login state
  const [loginMode, setLoginMode] = useState<'secret' | 'email'>('email');
  const [secretCode, setSecretCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const adminRefreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [upstreamConfigs, setUpstreamConfigs] = useState<UpstreamConfigItem[]>([]);
  const [loadBalancerStats, setLoadBalancerStats] = useState<LoadBalancerStats[]>([]);
  const [upstreamEmbeddingConfigs, setUpstreamEmbeddingConfigs] = useState<UpstreamEmbeddingConfigItem[]>([]);
  const [betaCodes, setBetaCodes] = useState<BetaCodeItem[]>([]);
  const [betaCodeStats, setBetaCodeStats] = useState<BetaCodeStats | null>(null);
  const [distributors, setDistributors] = useState<DistributorItem[]>([]);
  const [distributorSummary, setDistributorSummary] = useState<DistributorSummary | null>(null);
  const [distributorPeriodType, setDistributorPeriodType] = useState<DistributorPeriodType>('month');
  const [distributorPeriod, setDistributorPeriod] = useState(getCurrentMonth());
  const [selectedDistributorId, setSelectedDistributorId] = useState<string | null>(null);
  const [distributorPurchases, setDistributorPurchases] = useState<DistributorPurchase[]>([]);
  const [distributorLoading, setDistributorLoading] = useState(false);
  const [newDistributor, setNewDistributor] = useState({
    name: '',
    invite_code: '',
    contact_name: '',
    contact_phone: '',
    commission_rate: 0,
    notes: '',
    account_email: '',
    account_password: '',
  });
  const [distributorAccountDrafts, setDistributorAccountDrafts] = useState<Record<string, {
    email: string;
    password: string;
    status: 'active' | 'disabled';
  }>>({});
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [newBetaCode, setNewBetaCode] = useState<{
    quantity: number;
    code_type: string;
    validity_days: number;
    batch_name: string;
    expires_at: string;
    notes: string;
  }>({
    quantity: 10,
    code_type: 'trial',
    validity_days: 30,
    batch_name: '',
    expires_at: '',
    notes: '',
  });
  const [commercialCardBatch, setCommercialCardBatch] = useState<{
    plan: CommercialCardPlanKey;
    quantity: number;
    batch_name: string;
    expires_at: string;
    notes: string;
  }>({
    plan: 'month',
    quantity: 50,
    batch_name: '',
    expires_at: '',
    notes: '链动小铺导入',
  });
  const [commercialCardLoading, setCommercialCardLoading] = useState(false);


  const [embeddingLoadBalancerStats, setEmbeddingLoadBalancerStats] = useState<LoadBalancerStats[]>([]);  const [newPricing, setNewPricing] = useState({
    model_name: '',
    display_name: '',
    provider: '',
    model_ratio: 1,
    completion_ratio: 1,
    quota_type: 0,
    is_active: true,
    is_listed: true,
  });
  const [newUpstreamConfig, setNewUpstreamConfig] = useState({
    provider_name: 'nicerouter',
    api_key: '',
    base_url: 'https://api.nicerouter.com/v1',
    is_default: true,
    description: '',
    lb_strategy: 'round_robin',
    lb_weight: 1,
    lb_priority: 0,
    max_connections: 100,
    rate_limit_per_minute: 60,
  });
  const [newEmbeddingUpstreamConfig, setNewEmbeddingUpstreamConfig] = useState({
    provider_name: 'nicerouter',
    api_key: '',
    base_url: 'https://api.nicerouter.com/v1',
    is_default: true,
    description: '',
    lb_strategy: 'round_robin',
    lb_weight: 1,
    lb_priority: 0,
    max_connections: 100,
    rate_limit_per_minute: 60,
  });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!localStorage.getItem('adminToken') && !localStorage.getItem('adminRefreshToken')) {
          setLoading(false);
          return;
        }

        try {
          const response = await adminFetch(`${API_BASE_URL}/admin/stats`, {
            signal: controller.signal,
          });
          if (response.ok) {
            setStats(await response.json());
            setIsLoggedIn(true);
          }
          setLoading(false);
        } catch (error) {
          if ((error as Error).name === 'AbortError') return;
          setLoading(false);
        }
      })();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  function clearAdminSession(message = '') {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminRefreshToken');
    setIsLoggedIn(false);
    if (message) setLoginError(message);
  }

  async function refreshAdminSession(): Promise<string | null> {
    if (adminRefreshPromiseRef.current) return adminRefreshPromiseRef.current;

    adminRefreshPromiseRef.current = (async () => {
      const refreshToken = localStorage.getItem('adminRefreshToken');
      if (!refreshToken) return null;

      try {
        const response = await fetch(`${API_BASE_URL}/admin/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) return null;

        const data = await response.json();
        const nextAccessToken = data?.tokens?.accessToken;
        const nextRefreshToken = data?.tokens?.refreshToken;
        if (!nextAccessToken || !nextRefreshToken) return null;

        localStorage.setItem('adminToken', nextAccessToken);
        localStorage.setItem('adminRefreshToken', nextRefreshToken);
        return nextAccessToken as string;
      } catch {
        return null;
      } finally {
        adminRefreshPromiseRef.current = null;
      }
    })();

    return adminRefreshPromiseRef.current;
  }

  async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const requestWithToken = (token: string | null) => {
      const headers = new Headers(init.headers);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      if (token) headers.set('Authorization', `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    };

    let token = localStorage.getItem('adminToken');
    let response = await requestWithToken(token);
    if (response.status !== 401) return response;

    token = await refreshAdminSession();
    if (token) {
      response = await requestWithToken(token);
      if (response.status !== 401) return response;
    }

    clearAdminSession('登录已过期，请重新登录。');
    throw new Error('ADMIN_SESSION_EXPIRED');
  }

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      if (loginMode === 'secret' && /@/.test(secretCode.trim())) {
        setLoginError('当前是密令登录。管理员邮箱账号请切换到“邮箱登录”。');
        setLoginLoading(false);
        return;
      }

      const endpoint = loginMode === 'secret' ? '/admin/login' : '/admin/login-email';
      const body = loginMode === 'secret' 
        ? { secret_code: secretCode }
        : { email, password };

      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setLoginError(data.message || (loginMode === 'secret' ? '密令错误' : '邮箱或密码错误'));
        setLoginLoading(false);
        return;
      }

      const data = await res.json();
      localStorage.setItem('adminToken', data.tokens.accessToken);
      localStorage.setItem('adminRefreshToken', data.tokens.refreshToken);
      setIsLoggedIn(true);
      setLoginLoading(false);
      loadData('stats');
    } catch {
      setLoginError('网络错误，请重试');
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    setSecretCode('');
    setEmail('');
    setPassword('');
  };

  const loadDistributorData = async (
    periodType: DistributorPeriodType = distributorPeriodType,
    period: string = distributorPeriod
  ) => {
    setDistributorLoading(true);
    try {
      const params = new URLSearchParams({
        period_type: periodType,
        period,
      });
      const res = await adminFetch(`${API_BASE_URL}/admin/distributors?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '读取分销商统计失败');
        return;
      }
      setDistributors(data.distributors || []);
      setDistributorSummary(data.summary || null);
    } catch (err) {
      if ((err as Error).message === 'ADMIN_SESSION_EXPIRED') return;
      console.error('Load distributor data failed:', err);
      alert('读取分销商统计失败，请检查网络后重试');
    } finally {
      setDistributorLoading(false);
    }
  };

  const loadDistributorPurchases = async (
    distributorId: string,
    periodType: DistributorPeriodType = distributorPeriodType,
    period: string = distributorPeriod
  ) => {
    try {
      const params = new URLSearchParams({
        period_type: periodType,
        period,
        limit: '500',
      });
      const res = await adminFetch(
        `${API_BASE_URL}/admin/distributors/${distributorId}/purchases?${params.toString()}`,
        { headers: getAuthHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '读取购买明细失败');
        return;
      }
      setSelectedDistributorId(distributorId);
      setDistributorPurchases(data.purchases || []);
    } catch (err) {
      if ((err as Error).message === 'ADMIN_SESSION_EXPIRED') return;
      console.error('Load distributor purchases failed:', err);
      alert('读取购买明细失败，请重试');
    }
  };

  const createDistributor = async () => {
    if (!newDistributor.name.trim()) {
      alert('请填写分销商名称');
      return;
    }

    try {
      const res = await adminFetch(`${API_BASE_URL}/admin/distributors`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...newDistributor,
          invite_code: newDistributor.invite_code.trim() || undefined,
          account_email: newDistributor.account_email.trim() || undefined,
          account_password: newDistributor.account_password || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '创建分销商失败');
        return;
      }
      setNewDistributor({
        name: '',
        invite_code: '',
        contact_name: '',
        contact_phone: '',
        commission_rate: 0,
        notes: '',
        account_email: '',
        account_password: '',
      });
      await loadDistributorData();
    } catch (err) {
      if ((err as Error).message === 'ADMIN_SESSION_EXPIRED') return;
      console.error('Create distributor failed:', err);
      alert('创建分销商失败，请重试');
    }
  };

  const updateDistributor = async (
    distributorId: string,
    updates: Partial<Pick<DistributorItem, 'name' | 'contact_name' | 'contact_phone' | 'commission_rate' | 'status' | 'notes'>>
  ) => {
    try {
      const res = await adminFetch(`${API_BASE_URL}/admin/distributors/${distributorId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '更新分销商失败');
        await loadDistributorData();
        return;
      }
      await loadDistributorData();
      if (selectedDistributorId === distributorId) {
        await loadDistributorPurchases(distributorId);
      }
    } catch (err) {
      if ((err as Error).message === 'ADMIN_SESSION_EXPIRED') return;
      console.error('Update distributor failed:', err);
      alert('更新分销商失败，请重试');
    }
  };

  const updateDistributorAccountDraft = (
    distributor: DistributorItem,
    updates: Partial<{ email: string; password: string; status: 'active' | 'disabled' }>
  ) => {
    setDistributorAccountDrafts((current) => ({
      ...current,
      [distributor.id]: {
        email: current[distributor.id]?.email ?? distributor.account?.email ?? '',
        password: current[distributor.id]?.password ?? '',
        status: current[distributor.id]?.status ?? distributor.account?.status ?? 'active',
        ...updates,
      },
    }));
  };

  const saveDistributorAccount = async (distributor: DistributorItem) => {
    const draft = distributorAccountDrafts[distributor.id];
    const email = (draft?.email ?? distributor.account?.email ?? '').trim();
    const password = (draft?.password ?? '').trim();
    const status = draft?.status ?? distributor.account?.status ?? 'active';

    if (!email) {
      alert('请填写分销商登录邮箱');
      return;
    }
    if (!distributor.account && password.length < 8) {
      alert('首次创建账户必须设置至少 8 位密码');
      return;
    }
    if (password && password.length < 8) {
      alert('新密码至少需要 8 位');
      return;
    }

    try {
      const res = await adminFetch(`${API_BASE_URL}/admin/distributors/${distributor.id}/account`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          email,
          password: password || undefined,
          display_name: distributor.contact_name || distributor.name,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || '保存分销商登录账户失败');
        return;
      }
      setDistributorAccountDrafts((current) => {
        const next = { ...current };
        delete next[distributor.id];
        return next;
      });
      await loadDistributorData();
      alert(distributor.account ? '登录账户已更新' : '登录账户已创建');
    } catch (err) {
      if ((err as Error).message === 'ADMIN_SESSION_EXPIRED') return;
      console.error('Save distributor account failed:', err);
      alert('保存分销商登录账户失败，请重试');
    }
  };

  const copyDistributorCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      alert(`分销商邀请码已复制：${code}`);
    } catch {
      alert(`请手动复制邀请码：${code}`);
    }
  };

  const loadData = async (tab: string) => {
    try {
      if (tab === 'stats') {
        const res = await fetch(`${API_BASE_URL}/admin/stats`, { headers: getAuthHeaders() });
        if (res.ok) setStats(await res.json());
      } else if (tab === 'pricing') {
        const res = await fetch(`${API_BASE_URL}/admin/pricing`, { headers: getAuthHeaders() });
        if (res.ok) setPricing((await res.json()).pricing);
      } else if (tab === 'users') {
        const res = await fetch(`${API_BASE_URL}/admin/users`, { headers: getAuthHeaders() });
        if (res.ok) setUsers((await res.json()).users);
      } else if (tab === 'payments') {
        const res = await fetch(`${API_BASE_URL}/admin/payments`, { headers: getAuthHeaders() });
        if (res.ok) setPayments((await res.json()).payments);
      } else if (tab === 'upstream') {
        const [configsRes, statsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/upstream-configs`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE_URL}/admin/load-balancer/stats`, { headers: getAuthHeaders() }),
        ]);
        if (configsRes.ok) setUpstreamConfigs((await configsRes.json()).configs);
        if (statsRes.ok) setLoadBalancerStats((await statsRes.json()).stats);
      } else if (tab === 'embedding') {
        const [configsRes, statsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/upstream-embedding-configs`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE_URL}/admin/embedding-load-balancer/stats`, { headers: getAuthHeaders() }),
        ]);
        if (configsRes.ok) setUpstreamEmbeddingConfigs((await configsRes.json()).configs);
        if (statsRes.ok) setEmbeddingLoadBalancerStats((await statsRes.json()).stats);
      } else if (tab === 'beta-codes') {
        const [codesRes, statsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/beta-codes`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE_URL}/admin/beta-codes/stats`, { headers: getAuthHeaders() }),
        ]);
        if (codesRes.ok) setBetaCodes((await codesRes.json()).codes || []);
        if (statsRes.ok) setBetaCodeStats((await statsRes.json()).stats);
      } else if (tab === 'distributors') {
        await loadDistributorData();
      } else if (tab === 'feedback') {
        const [feedbackRes, statsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/feedback`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE_URL}/admin/feedback/stats`, { headers: getAuthHeaders() }),
        ]);
        if (feedbackRes.ok) setFeedback((await feedbackRes.json()).feedback || []);
        if (statsRes.ok) setFeedbackStats((await statsRes.json()).stats);
      }
    } catch (err) {
      console.error('Load data failed:', err);
    }
  };

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    loadData(tab);
  };

  const updatePricing = async (id: string, field: string, value: string | number | boolean) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/pricing/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) loadData('pricing');
    } catch (err) {
      console.error('Update pricing failed:', err);
    }
  };

  const addPricing = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/pricing`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(newPricing),
      });
      if (res.ok) {
        setNewPricing({ model_name: '', display_name: '', provider: '', model_ratio: 1, completion_ratio: 1, quota_type: 0, is_active: true, is_listed: true });
        loadData('pricing');
      }
    } catch (err) {
      console.error('Add pricing failed:', err);
    }
  };

  const deletePricing = async (id: string) => {
    if (!confirm('确定要删除此定价配置吗？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/pricing/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) loadData('pricing');
    } catch (err) {
      console.error('Delete pricing failed:', err);
    }
  };

  const addUpstreamConfig = async () => {
    if (!newUpstreamConfig.provider_name || !newUpstreamConfig.api_key) {
      alert('请填写服务提供商名称和API密钥');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-configs`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(newUpstreamConfig),
      });
      if (res.ok) {
        setNewUpstreamConfig({
          provider_name: 'nicerouter',
          api_key: '',
          base_url: 'https://api.nicerouter.com/v1',
          is_default: true,
          description: '',
          lb_strategy: 'round_robin',
          lb_weight: 1,
          lb_priority: 0,
          max_connections: 100,
          rate_limit_per_minute: 60,
        });
        loadData('upstream');
        alert('上游API配置添加成功！');
      } else {
        const data = await res.json();
        alert(data.message || '添加失败');
      }
    } catch (err) {
      console.error('Add upstream config failed:', err);
      alert('添加失败，请重试');
    }
  };

  const setDefaultUpstreamConfig = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-configs/${id}/set-default`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) loadData('upstream');
    } catch (err) {
      console.error('Set default upstream config failed:', err);
    }
  };

  const toggleUpstreamConfig = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-configs/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (res.ok) loadData('upstream');
    } catch (err) {
      console.error('Toggle upstream config failed:', err);
    }
  };

  const deleteUpstreamConfig = async (id: string) => {
    if (!confirm('确定要删除此上游API配置吗？删除后API将无法使用此服务商。')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-configs/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) loadData('upstream');
    } catch (err) {
      console.error('Delete upstream config failed:', err);
    }
  };

  const updateLoadBalancingConfig = async (id: string, updates: Partial<{
    lb_strategy: string;
    lb_weight: number;
    lb_priority: number;
    max_connections: number;
    rate_limit_per_minute: number;
  }>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-configs/${id}/load-balancing`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });
      if (res.ok) loadData('upstream');
    } catch (err) {
      console.error('Update load balancing config failed:', err);
    }
  };

  const resetLoadBalancerStats = async () => {
    if (!confirm('确定要重置所有上游API的统计数据吗？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/load-balancer/reset-stats`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        loadData('upstream');
        alert('统计数据已重置');
      }
    } catch (err) {
      console.error('Reset stats failed:', err);
    }
  };

  const addUpstreamEmbeddingConfig = async () => {
    if (!newEmbeddingUpstreamConfig.provider_name || !newEmbeddingUpstreamConfig.api_key) {
      alert('请填写服务提供商名称和API密钥');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-embedding-configs`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(newEmbeddingUpstreamConfig),
      });
      if (res.ok) {
        setNewEmbeddingUpstreamConfig({
          provider_name: 'nicerouter',
          api_key: '',
          base_url: 'https://api.nicerouter.com/v1',
          is_default: true,
          description: '',
          lb_strategy: 'round_robin',
          lb_weight: 1,
          lb_priority: 0,
          max_connections: 100,
          rate_limit_per_minute: 60,
        });
        loadData('embedding');
        alert('上游Embedding API配置添加成功！');
      } else {
        const data = await res.json();
        alert(data.message || '添加失败');
      }
    } catch (err) {
      console.error('Add upstream embedding config failed:', err);
      alert('添加失败，请重试');
    }
  };

  const setDefaultUpstreamEmbeddingConfig = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-embedding-configs/${id}/set-default`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) loadData('embedding');
    } catch (err) {
      console.error('Set default upstream embedding config failed:', err);
    }
  };

  const toggleUpstreamEmbeddingConfig = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-embedding-configs/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: !currentActive }),
      });
      if (res.ok) loadData('embedding');
    } catch (err) {
      console.error('Toggle upstream embedding config failed:', err);
    }
  };

  const deleteUpstreamEmbeddingConfig = async (id: string) => {
    if (!confirm('确定要删除此上游Embedding API配置吗？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-embedding-configs/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) loadData('embedding');
    } catch (err) {
      console.error('Delete upstream embedding config failed:', err);
    }
  };

  const updateEmbeddingLoadBalancingConfig = async (id: string, updates: Partial<{
    lb_strategy: string;
    lb_weight: number;
    lb_priority: number;
    max_connections: number;
    rate_limit_per_minute: number;
  }>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/upstream-embedding-configs/${id}/load-balancing`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });
      if (res.ok) loadData('embedding');
    } catch (err) {
      console.error('Update embedding load balancing config failed:', err);
    }
  };

  const resetEmbeddingLoadBalancerStats = async () => {
    if (!confirm('确定要重置所有上游Embedding API的统计数据吗？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/embedding-load-balancer/reset-stats`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        loadData('embedding');
        alert('统计数据已重置');
      }
    } catch (err) {
      console.error('Reset embedding stats failed:', err);
    }
  };
  const getLifetimeBetaExpiryDate = () => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 2);
    return expiresAt.toISOString().slice(0, 10);
  };

  const getBetaCodeTypeLabel = (codeType: string) => {
    if (codeType === 'trial') return '试用码';
    if (codeType === 'premium_trial') return '高级试用';
    if (codeType === 'extended_trial') return '延长试用';
    if (codeType === 'lifetime_2d') return '2天限时永久码';
    if (codeType === 'lifetime_once') return '一次性永久码';
    if (codeType === 'limited_trial_2d_15d') return '2天限时15天试用码';
    return codeType;
  };

  const isTwoDayUnlimitedBetaCode = (codeType: string) => (
    codeType === 'lifetime_2d' || codeType === 'limited_trial_2d_15d'
  );

  const isPermanentBetaCode = (codeType: string) => (
    codeType === 'lifetime_2d' || codeType === 'lifetime_once'
  );

  const getBetaCodeValidityDays = (codeType: string, fallbackDays: number) => {
    if (codeType === 'lifetime_2d') return 2;
    if (codeType === 'lifetime_once') return 365;
    if (codeType === 'limited_trial_2d_15d') return 15;
    return fallbackDays;
  };

  const getCommercialBatchName = (planKey: CommercialCardPlanKey) => {
    return `${COMMERCIAL_CARD_PLANS[planKey].batchPrefix}-${getCompactDate()}`;
  };

  const downloadCommercialCodesTxt = (
    codes: BetaCodeItem[],
    planKey: CommercialCardPlanKey
  ) => {
    const content = codes.map((code) => code.code).join('\r\n');
    downloadTextFile(`liandong-${planKey}-${getCompactDate()}.txt`, `${content}\r\n`);
  };

  const generateCommercialCardCodes = async () => {
    const quantity = commercialCardBatch.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      alert('链动小铺卡密生成数量必须在1-500之间');
      return;
    }

    const plan = COMMERCIAL_CARD_PLANS[commercialCardBatch.plan];
    const batchName = commercialCardBatch.batch_name.trim() || getCommercialBatchName(commercialCardBatch.plan);
    const notes = commercialCardBatch.notes.trim() || `链动小铺${plan.label}`;

    setCommercialCardLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/admin/beta-codes/generate`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          quantity,
          code_type: plan.codeType,
          validity_days: plan.validityDays,
          batch_name: batchName,
          expires_at: commercialCardBatch.expires_at || undefined,
          notes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        alert(data.message || '链动小铺卡密生成失败');
        return;
      }

      const data = await res.json() as GeneratedBetaCodesResponse;
      const codes = data.codes || [];
      downloadCommercialCodesTxt(codes, commercialCardBatch.plan);
      setCommercialCardBatch((prev) => ({ ...prev, batch_name: '' }));
      loadData('beta-codes');
      alert(`成功生成 ${data.total || codes.length} 个${plan.label}，TXT 已下载，可导入链动小铺`);
    } catch (err) {
      console.error('Generate commercial card codes failed:', err);
      alert('链动小铺卡密生成失败，请重试');
    } finally {
      setCommercialCardLoading(false);
    }
  };

  const generateBetaCodes = async () => {
    if (newBetaCode.quantity < 1 || newBetaCode.quantity > 100) {
      alert('生成数量必须在1-100之间');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/admin/beta-codes/generate`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          quantity: newBetaCode.quantity,
          code_type: newBetaCode.code_type,
          validity_days: getBetaCodeValidityDays(newBetaCode.code_type, newBetaCode.validity_days),
          batch_name: newBetaCode.batch_name,
          expires_at: newBetaCode.expires_at || (isTwoDayUnlimitedBetaCode(newBetaCode.code_type) ? getLifetimeBetaExpiryDate() : undefined),
          notes: newBetaCode.notes,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewBetaCode({ quantity: 10, code_type: 'trial', validity_days: 30, batch_name: '', expires_at: '', notes: '' });
        loadData('beta-codes');
        alert(`成功生成 ${data.total} 个内测码！`);
      } else {
        const data = await res.json();
        alert(data.message || '生成失败');
      }
    } catch (err) {
      console.error('Generate beta codes failed:', err);
      alert('生成失败，请重试');
    }
  };

  const disableBetaCode = async (id: string) => {
    if (!confirm('确定要禁用此内测码吗？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/admin/beta-codes/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (res.ok) loadData('beta-codes');
    } catch (err) {
      console.error('Disable beta code failed:', err);
    }
  };

  const copyBetaCode = (code: string) => {
    navigator.clipboard.writeText(code);
    alert('内测码已复制: ' + code);
  };

  const getFeedbackCategoryLabel = (category: string) => {
    if (category === 'bug') return 'Bug';
    if (category === 'suggestion') return '功能建议';
    if (category === 'experience') return '使用体验';
    if (category === 'billing') return '账号/权益';
    return '其他';
  };

  const getFeedbackStatusLabel = (status: string) => {
    if (status === 'open') return '待处理';
    if (status === 'reviewing') return '处理中';
    if (status === 'resolved') return '已解决';
    if (status === 'closed') return '已关闭';
    return status;
  };

  const updateFeedback = async (id: string, updates: Partial<{ status: string; priority: string; adminNotes: string }>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/feedback/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        loadData('feedback');
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || '更新反馈状态失败');
      }
    } catch (err) {
      console.error('Update feedback failed:', err);
      alert('更新反馈状态失败');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Login Screen
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-8 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回主页
          </Link>

          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">管理员登录</h1>
              <p className="mt-2 text-sm text-gray-600">选择登录方式</p>
            </div>

            {/* 登录方式切换 */}
            <div className="flex gap-2 mb-6 bg-gray-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setLoginMode('secret')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                  loginMode === 'secret'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                密令登录
              </button>
              <button
                type="button"
                onClick={() => setLoginMode('email')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                  loginMode === 'email'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                邮箱登录
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              {loginMode === 'secret' ? (
                <div>
                  <label htmlFor="secretCode" className="block text-sm font-medium text-gray-700 mb-2">
                    管理员密令
                  </label>
                  <input
                    id="secretCode"
                    type="password"
                    value={secretCode}
                    onChange={(e) => setSecretCode(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition font-mono"
                    placeholder="请输入32位密令"
                    required
                  />
                  <p className="mt-2 text-xs text-gray-500">快捷登录方式，使用预设的32位密令</p>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      管理员邮箱
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                      placeholder="sjs@cau.edu.cn"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                      密码
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                      placeholder="请输入密码"
                      required
                    />
                    <p className="mt-2 text-xs text-gray-500">仅限role=admin的用户登录</p>
                  </div>
                </>
              )}

              {loginError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg py-3 font-medium transition flex items-center justify-center"
              >
                {loginLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    验证中...
                  </>
                ) : (
                  '进入后台'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Admin Dashboard
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 text-gray-900 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2 transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回主页
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">管理后台</h1>
            <p className="mt-1 text-gray-600">管理定价、用户和统计数据</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition"
          >
            退出登录
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow mb-6">
          <div className="flex overflow-x-auto border-b">
            {(['stats', 'pricing', 'users', 'payments', 'upstream', 'embedding', 'beta-codes', 'distributors', 'feedback'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`whitespace-nowrap px-6 py-4 font-medium transition ${
                  activeTab === tab
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab === 'stats' ? '统计概览' : tab === 'pricing' ? '定价管理' : tab === 'users' ? '用户管理' : tab === 'payments' ? '支付记录' : tab === 'upstream' ? '上游API' : tab === 'embedding' ? '上游Embedding' : tab === 'beta-codes' ? '内测码' : tab === 'distributors' ? '分销商' : '意见反馈'}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow p-6">
                <div className="text-sm text-gray-500 mb-2">今日收入</div>
                <div className="text-2xl font-bold text-gray-900">¥{stats.today.revenue.toFixed(2)}</div>
              </div>
              <div className="bg-white rounded-xl shadow p-6">
                <div className="text-sm text-gray-500 mb-2">今日利润</div>
                <div className="text-2xl font-bold text-green-600">¥{stats.today.profit.toFixed(2)}</div>
              </div>
              <div className="bg-white rounded-xl shadow p-6">
                <div className="text-sm text-gray-500 mb-2">本月收入</div>
                <div className="text-2xl font-bold text-gray-900">¥{stats.revenue.month.toFixed(2)}</div>
              </div>
              <div className="bg-white rounded-xl shadow p-6">
                <div className="text-sm text-gray-500 mb-2">新用户（今日）</div>
                <div className="text-2xl font-bold text-blue-600">{stats.today.new_users}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">用户统计</h3>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-gray-600">总用户</span><span className="font-medium">{stats.users.total}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">活跃用户</span><span className="font-medium">{stats.users.active}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">高级用户</span><span className="font-medium">{stats.users.premium}</span></div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">订阅统计</h3>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-gray-600">活跃订阅</span><span className="font-medium">{stats.subscriptions.active}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">月度套餐</span><span className="font-medium">{stats.subscriptions.monthly}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">季度套餐</span><span className="font-medium">{stats.subscriptions.quarterly}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">年度套餐</span><span className="font-medium">{stats.subscriptions.yearly}</span></div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">API 统计</h3>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-gray-600">总收入</span><span className="font-medium">¥{stats.api.revenue.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">总成本</span><span className="font-medium">¥{stats.api.cost.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">总利润</span><span className="font-medium text-green-600">¥{stats.api.profit.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">API 请求数</span><span className="font-medium">{stats.api.requests}</span></div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">收入统计</h3>
                <div className="space-y-3">
                  <div className="flex justify-between"><span className="text-gray-600">总收入</span><span className="font-medium">¥{stats.revenue.total.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">今日收入</span><span className="font-medium">¥{stats.revenue.today.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">本月收入</span><span className="font-medium">¥{stats.revenue.month.toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Tab */}
        {activeTab === 'pricing' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">添加新定价</h3>
              <div className="grid md:grid-cols-3 gap-4">
                <input type="text" placeholder="模型名称 (如 gpt-4o)" value={newPricing.model_name} onChange={(e) => setNewPricing({ ...newPricing, model_name: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input type="text" placeholder="显示名称 (如 GPT-4o)" value={newPricing.display_name} onChange={(e) => setNewPricing({ ...newPricing, display_name: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input type="text" placeholder="提供商 (如 openai)" value={newPricing.provider} onChange={(e) => setNewPricing({ ...newPricing, provider: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input type="number" placeholder="输入倍率" value={newPricing.model_ratio} onChange={(e) => setNewPricing({ ...newPricing, model_ratio: parseFloat(e.target.value) })} className="border rounded-lg px-3 py-2" />
                <input type="number" placeholder="输出倍率" value={newPricing.completion_ratio} onChange={(e) => setNewPricing({ ...newPricing, completion_ratio: parseFloat(e.target.value) })} className="border rounded-lg px-3 py-2" />
                <button onClick={addPricing} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 font-medium">添加</button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">模型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">提供商</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">输入倍率</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">输出倍率</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pricing.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3"><div className="font-medium">{p.display_name}</div><div className="text-xs text-gray-500">{p.model_name}</div></td>
                      <td className="px-4 py-3 text-sm">{p.provider}</td>
                      <td className="px-4 py-3"><input type="number" value={p.model_ratio} onChange={(e) => updatePricing(p.id, 'model_ratio', parseFloat(e.target.value))} className="border rounded px-2 py-1 w-20 text-sm" step="0.01" /></td>
                      <td className="px-4 py-3"><input type="number" value={p.completion_ratio} onChange={(e) => updatePricing(p.id, 'completion_ratio', parseFloat(e.target.value))} className="border rounded px-2 py-1 w-20 text-sm" step="0.01" /></td>
                      <td className="px-4 py-3">
                        <button onClick={() => updatePricing(p.id, 'is_active', !p.is_active)} className={`px-2 py-1 rounded text-xs font-medium ${p.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {p.is_active ? '启用' : '禁用'}
                        </button>
                      </td>
                      <td className="px-4 py-3"><button onClick={() => deletePricing(p.id)} className="text-red-600 hover:text-red-800 text-sm">删除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">邮箱</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户名</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">来源</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">订阅</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">注册时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 text-sm">{u.email}</td>
                    <td className="px-4 py-3 text-sm">{u.username || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${u.role === 'admin' ? 'bg-red-100 text-red-800' : u.role === 'premium' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{u.role}</span>
                    </td>
                    <td className="px-4 py-3 text-sm">{u.source}</td>
                    <td className="px-4 py-3 text-sm">{u.subscription_plan || '-'}</td>
                    <td className="px-4 py-3 text-sm">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">金额</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">支付方式</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-sm">{p.user_email}</td>
                    <td className="px-4 py-3 text-sm">{p.payment_type}</td>
                    <td className="px-4 py-3 text-sm font-medium">¥{p.amount}</td>
                    <td className="px-4 py-3 text-sm">{p.payment_method}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${p.status === 'success' ? 'bg-green-100 text-green-800' : p.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-sm">{new Date(p.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Upstream API Tab */}
        {activeTab === 'upstream' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="font-semibold text-blue-900 mb-1">上游API自动分配系统</h3>
                  <p className="text-sm text-blue-700">
                    系统会根据负载均衡策略自动分配API请求到不同的上游服务商，实现负载分散和高可用。
                    <br />
                    <strong>负载均衡策略：</strong>轮询、加权、最少连接、优先级等。
                  </p>
                </div>
              </div>
            </div>

            {/* 负载均衡统计 */}
            {loadBalancerStats.length > 0 && (
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">负载均衡状态</h3>
                  <button
                    onClick={resetLoadBalancerStats}
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    重置统计
                  </button>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {loadBalancerStats.map((stat) => (
                    <div key={stat.provider_name} className={`p-4 rounded-lg border ${stat.available ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="font-medium text-gray-900">{stat.provider_name}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        连接数: {stat.current_connections} / 总请求: {stat.total_requests}
                      </div>
                      <div className={`text-xs mt-1 ${stat.available ? 'text-green-700' : 'text-red-700'}`}>
                        {stat.available ? '可用' : '不可用'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 添加新配置 */}
            <div className="bg-white rounded-xl shadow p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">添加上游API配置</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">服务提供商名称</label>
                  <input
                    type="text"
                    value={newUpstreamConfig.provider_name}
                    onChange={(e) => setNewUpstreamConfig({ ...newUpstreamConfig, provider_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="nicerouter"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API密钥</label>
                  <input
                    type="password"
                    value={newUpstreamConfig.api_key}
                    onChange={(e) => setNewUpstreamConfig({ ...newUpstreamConfig, api_key: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono"
                    placeholder="sk-..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API基础URL</label>
                  <input
                    type="text"
                    value={newUpstreamConfig.base_url}
                    onChange={(e) => setNewUpstreamConfig({ ...newUpstreamConfig, base_url: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="https://api.nicerouter.com/v1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">负载均衡策略</label>
                  <select
                    value={newUpstreamConfig.lb_strategy}
                    onChange={(e) => setNewUpstreamConfig({ ...newUpstreamConfig, lb_strategy: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="round_robin">轮询分配</option>
                    <option value="weighted">加权轮询</option>
                    <option value="least_connections">最少连接</option>
                    <option value="priority">优先级分配</option>
                    <option value="default_only">仅使用默认</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">权重 (1-100)</label>
                  <input
                    type="number"
                    value={newUpstreamConfig.lb_weight}
                    onChange={(e) => setNewUpstreamConfig({ ...newUpstreamConfig, lb_weight: parseInt(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    min="1"
                    max="100"
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newUpstreamConfig.is_default}
                    onChange={(e) => setNewUpstreamConfig({ ...newUpstreamConfig, is_default: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">设为默认服务商</span>
                </label>
                <button
                  onClick={addUpstreamConfig}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                >
                  添加配置
                </button>
              </div>
            </div>

            {/* 配置列表 */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">服务商</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">API URL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">负载均衡</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态/统计</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">默认</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {upstreamConfigs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        暂无上游API配置，请添加
                      </td>
                    </tr>
                  ) : (
                    upstreamConfigs.map((config) => (
                      <tr key={config.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{config.provider_name}</div>
                          {config.description && <div className="text-xs text-gray-500">{config.description}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{config.base_url}</td>
                        <td className="px-4 py-3">
                          <div className="text-xs space-y-1">
                            <div>策略: {
                              config.lb_strategy === 'round_robin' ? '轮询' :
                              config.lb_strategy === 'weighted' ? '加权' :
                              config.lb_strategy === 'least_connections' ? '最少连接' :
                              config.lb_strategy === 'priority' ? '优先级' : '仅默认'
                            }</div>
                            <div>权重: {config.lb_weight}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <button
                              onClick={() => toggleUpstreamConfig(config.id, config.is_active)}
                              className={`px-2 py-1 rounded text-xs font-medium ${config.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                            >
                              {config.is_active ? '启用' : '禁用'}
                            </button>
                            <div className="text-xs text-gray-500">
                              总请求: {config.total_requests}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {config.is_default ? (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">默认</span>
                          ) : (
                            <button
                              onClick={() => setDefaultUpstreamConfig(config.id)}
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              设为默认
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 space-x-2">
                          <button
                            onClick={() => {
                              const newStrategy = prompt('修改负载均衡策略 (round_robin/weighted/least_connections/priority/default_only):', config.lb_strategy);
                              if (newStrategy) updateLoadBalancingConfig(config.id, { lb_strategy: newStrategy });
                            }}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            编辑LB
                          </button>
                          <button
                            onClick={() => deleteUpstreamConfig(config.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* Embedding API Tab */}
        {activeTab === 'embedding' && (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="font-semibold text-green-900 mb-1">上游Embedding API自动分配系统</h3>
                  <p className="text-sm text-green-700">
                    配置Embedding API服务商，用于文本嵌入、向量生成等服务，支持负载均衡自动分配。
                  </p>
                </div>
              </div>
            </div>

            {embeddingLoadBalancerStats.length > 0 && (
              <div className="bg-white rounded-xl shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">负载均衡状态</h3>
                  <button onClick={resetEmbeddingLoadBalancerStats} className="text-sm text-gray-600 hover:text-gray-900">
                    重置统计
                  </button>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {embeddingLoadBalancerStats.map((stat) => (
                    <div key={stat.provider_name} className={`p-4 rounded-lg border ${stat.available ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                      <div className="font-medium text-gray-900">{stat.provider_name}</div>
                      <div className="text-sm text-gray-600 mt-1">连接数: {stat.current_connections} / 总请求: {stat.total_requests}</div>
                      <div className={`text-xs mt-1 ${stat.available ? 'text-green-700' : 'text-red-700'}`}>
                        {stat.available ? '可用' : '不可用'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">添加上游Embedding API配置</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">服务提供商名称</label>
                  <input type="text" value={newEmbeddingUpstreamConfig.provider_name} onChange={(e) => setNewEmbeddingUpstreamConfig({ ...newEmbeddingUpstreamConfig, provider_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="nicerouter" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API密钥</label>
                  <input type="password" value={newEmbeddingUpstreamConfig.api_key} onChange={(e) => setNewEmbeddingUpstreamConfig({ ...newEmbeddingUpstreamConfig, api_key: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono" placeholder="sk-..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API基础URL</label>
                  <input type="text" value={newEmbeddingUpstreamConfig.base_url} onChange={(e) => setNewEmbeddingUpstreamConfig({ ...newEmbeddingUpstreamConfig, base_url: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="https://api.nicerouter.com/v1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">负载均衡策略</label>
                  <select value={newEmbeddingUpstreamConfig.lb_strategy} onChange={(e) => setNewEmbeddingUpstreamConfig({ ...newEmbeddingUpstreamConfig, lb_strategy: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                    <option value="round_robin">轮询分配</option>
                    <option value="weighted">加权轮询</option>
                    <option value="least_connections">最少连接</option>
                    <option value="priority">优先级分配</option>
                    <option value="default_only">仅使用默认</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">权重 (1-100)</label>
                  <input type="number" value={newEmbeddingUpstreamConfig.lb_weight} onChange={(e) => setNewEmbeddingUpstreamConfig({ ...newEmbeddingUpstreamConfig, lb_weight: parseInt(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" min="1" max="100" />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newEmbeddingUpstreamConfig.is_default} onChange={(e) => setNewEmbeddingUpstreamConfig({ ...newEmbeddingUpstreamConfig, is_default: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm text-gray-700">设为默认服务商</span>
                </label>
                <button onClick={addUpstreamEmbeddingConfig} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium">
                  添加配置
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">服务商</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">API URL</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">负载均衡</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态/统计</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">默认</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {upstreamEmbeddingConfigs.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">暂无上游Embedding API配置，请添加</td></tr>
                  ) : (
                    upstreamEmbeddingConfigs.map((config) => (
                      <tr key={config.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{config.provider_name}</div>
                          {config.description && <div className="text-xs text-gray-500">{config.description}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{config.base_url}</td>
                        <td className="px-4 py-3">
                          <div className="text-xs space-y-1">
                            <div>策略: {
                              config.lb_strategy === 'round_robin' ? '轮询' :
                              config.lb_strategy === 'weighted' ? '加权' :
                              config.lb_strategy === 'least_connections' ? '最少连接' :
                              config.lb_strategy === 'priority' ? '优先级' : '仅默认'
                            }</div>
                            <div>权重: {config.lb_weight}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <button onClick={() => toggleUpstreamEmbeddingConfig(config.id, config.is_active)} className={`px-2 py-1 rounded text-xs font-medium ${config.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                              {config.is_active ? '启用' : '禁用'}
                            </button>
                            <div className="text-xs text-gray-500">总请求: {config.total_requests}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {config.is_default ? (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">默认</span>
                          ) : (
                            <button onClick={() => setDefaultUpstreamEmbeddingConfig(config.id)} className="text-xs text-blue-600 hover:text-blue-800">设为默认</button>
                          )}
                        </td>
                        <td className="px-4 py-3 space-x-2">
                          <button onClick={() => {
                            const newStrategy = prompt('修改负载均衡策略 (round_robin/weighted/least_connections/priority/default_only):', config.lb_strategy);
                            if (newStrategy) updateEmbeddingLoadBalancingConfig(config.id, { lb_strategy: newStrategy });
                          }} className="text-blue-600 hover:text-blue-800 text-sm">编辑LB</button>
                          <button onClick={() => deleteUpstreamEmbeddingConfig(config.id)} className="text-red-600 hover:text-red-800 text-sm">删除</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* Beta Codes Tab */}
        {activeTab === 'beta-codes' && (
          <div className="space-y-6">
            {betaCodeStats && (
              <div className="grid md:grid-cols-5 gap-4">
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">总计</div>
                  <div className="text-2xl font-bold text-gray-900">{betaCodeStats.total}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">未使用</div>
                  <div className="text-2xl font-bold text-blue-600">{betaCodeStats.unused}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">已使用</div>
                  <div className="text-2xl font-bold text-green-600">{betaCodeStats.used}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">已过期</div>
                  <div className="text-2xl font-bold text-yellow-600">{betaCodeStats.expired}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">已禁用</div>
                  <div className="text-2xl font-bold text-red-600">{betaCodeStats.disabled}</div>
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl shadow p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">链动小铺卡密导出</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    按售卖套餐批量生成卡密并下载 TXT；导入链动小铺后，用户购买获得卡密，再填入注册页的卡密/激活码。
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                  复用现有订阅激活链路
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">售卖套餐</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(Object.keys(COMMERCIAL_CARD_PLANS) as CommercialCardPlanKey[]).map((planKey) => {
                      const plan = COMMERCIAL_CARD_PLANS[planKey];
                      const selected = commercialCardBatch.plan === planKey;
                      return (
                        <button
                          key={planKey}
                          type="button"
                          onClick={() => setCommercialCardBatch((prev) => ({ ...prev, plan: planKey }))}
                          className={`rounded-lg border px-3 py-3 text-left transition ${selected ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-white text-gray-700 hover:border-emerald-300'}`}
                        >
                          <span className="block text-sm font-semibold">{plan.label}</span>
                          <span className="mt-1 block text-xs text-gray-500">{plan.durationLabel} · {plan.validityDays}天权益</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">生成数量 (1-500)</label>
                    <input
                      type="number"
                      value={commercialCardBatch.quantity}
                      onChange={(e) => setCommercialCardBatch({ ...commercialCardBatch, quantity: parseInt(e.target.value, 10) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      min="1"
                      max="500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">卡密过期日 (可选)</label>
                    <input
                      type="date"
                      value={commercialCardBatch.expires_at}
                      onChange={(e) => setCommercialCardBatch({ ...commercialCardBatch, expires_at: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">批次名称</label>
                  <input
                    type="text"
                    value={commercialCardBatch.batch_name}
                    onChange={(e) => setCommercialCardBatch({ ...commercialCardBatch, batch_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder={getCommercialBatchName(commercialCardBatch.plan)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input
                    type="text"
                    value={commercialCardBatch.notes}
                    onChange={(e) => setCommercialCardBatch({ ...commercialCardBatch, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="链动小铺导入"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-500">
                  TXT 为一行一个卡密，适配链动小铺卡密池导入。
                </p>
                <button
                  onClick={generateCommercialCardCodes}
                  disabled={commercialCardLoading}
                  className="px-6 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-lg font-medium transition"
                >
                  {commercialCardLoading ? '生成中...' : '生成并下载 TXT'}
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">生成内测码</h3>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-purple-700">
                  内测码用于用户注册或登录时激活权益。一次性永久码每个码只能被一个账号使用；2天限时永久码和2天限时15天试用码在过期前可被不限人数使用。
                </p>
              </div>
              <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">生成数量 (1-100)</label>
                  <input type="number" value={newBetaCode.quantity} onChange={(e) => setNewBetaCode({ ...newBetaCode, quantity: parseInt(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" min="1" max="100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">内测码类型</label>
                  <select value={newBetaCode.code_type} onChange={(e) => {
                    const codeType = e.target.value;
                    setNewBetaCode({
                      ...newBetaCode,
                      code_type: codeType,
                      validity_days: getBetaCodeValidityDays(codeType, newBetaCode.validity_days),
                      expires_at: isTwoDayUnlimitedBetaCode(codeType) ? getLifetimeBetaExpiryDate() : newBetaCode.expires_at,
                    });
                  }} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                    <option value="trial">试用码 (30天)</option>
                    <option value="premium_trial">高级试用 (30天)</option>
                    <option value="extended_trial">延长试用 (90天)</option>
                    <option value="lifetime_2d">2天限时永久码 (不限人数)</option>
                    <option value="lifetime_once">一次性永久码 (每码仅1人)</option>
                    <option value="limited_trial_2d_15d">2天限时15天试用码 (不限人数)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{isPermanentBetaCode(newBetaCode.code_type) ? '权益类型' : '试用天数'}</label>
                  <input type={isPermanentBetaCode(newBetaCode.code_type) ? 'text' : 'number'} value={isPermanentBetaCode(newBetaCode.code_type) ? '永久权限' : newBetaCode.validity_days} onChange={(e) => setNewBetaCode({ ...newBetaCode, validity_days: parseInt(e.target.value, 10) })} className="w-full border border-gray-300 rounded-lg px-3 py-2" min="1" disabled={isPermanentBetaCode(newBetaCode.code_type) || isTwoDayUnlimitedBetaCode(newBetaCode.code_type)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">批次名称</label>
                  <input type="text" value={newBetaCode.batch_name} onChange={(e) => setNewBetaCode({ ...newBetaCode, batch_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="如: 第一批内测用户" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">过期时间 (可选)</label>
                  <input type="date" value={newBetaCode.expires_at} onChange={(e) => setNewBetaCode({ ...newBetaCode, expires_at: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                </div>
                <div className="md:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input type="text" value={newBetaCode.notes} onChange={(e) => setNewBetaCode({ ...newBetaCode, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="备注信息" />
                </div>
              </div>
              <div className="mt-4">
                <button onClick={generateBetaCodes} className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition">
                  生成内测码
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow overflow-hidden text-gray-900">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900">内测码列表</h3>
                <span className="text-sm text-gray-500">共 {betaCodes.length} 条记录</span>
              </div>
              {betaCodes.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">暂无内测码，请生成</div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-gray-900">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">内测码</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">类型</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">试用天数</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">状态</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">批次</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">使用者</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">创建时间</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white text-gray-900">
                    {betaCodes.map((code) => (
                      <tr key={code.id} className="bg-white hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-gray-200 bg-gray-100 px-2 py-1 font-mono text-sm font-semibold text-gray-900">{code.code}</span>
                            <button onClick={() => copyBetaCode(code.code)} className="text-gray-500 hover:text-gray-900" title="复制">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {getBetaCodeTypeLabel(code.code_type)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">{isPermanentBetaCode(code.code_type) ? '永久权限' : `${code.validity_days}天`}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${code.status === 'unused' ? 'bg-blue-100 text-blue-800' : code.status === 'used' ? 'bg-green-100 text-green-800' : code.status === 'expired' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                            {code.status === 'unused' ? '未使用' : code.status === 'used' ? '已使用' : code.status === 'expired' ? '已过期' : '已禁用'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">{code.batch_name || code.batch_id}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{code.used_by || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{new Date(code.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          {code.status === 'unused' && (
                            <button onClick={() => disableBetaCode(code.id)} className="text-red-600 hover:text-red-800 text-sm">禁用</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'distributors' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">分销商邀请码</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    管理员查看全部分销商；分销商通过独立门户仅查看自己邀请码带来的注册、套餐购买和分成。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/distributor"
                    target="_blank"
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
                  >
                    打开分销商门户
                  </Link>
                  <div className="inline-flex rounded-lg border border-gray-200 p-1">
                    {(['month', 'year'] as DistributorPeriodType[]).map((periodType) => (
                      <button
                        key={periodType}
                        type="button"
                        onClick={() => {
                          const nextPeriod = periodType === 'month'
                            ? getCurrentMonth()
                            : String(new Date().getFullYear());
                          setDistributorPeriodType(periodType);
                          setDistributorPeriod(nextPeriod);
                          setSelectedDistributorId(null);
                          setDistributorPurchases([]);
                          void loadDistributorData(periodType, nextPeriod);
                        }}
                        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                          distributorPeriodType === periodType
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {periodType === 'month' ? '月度' : '年度'}
                      </button>
                    ))}
                  </div>
                  <input
                    type={distributorPeriodType === 'month' ? 'month' : 'number'}
                    min={distributorPeriodType === 'year' ? 2000 : undefined}
                    max={distributorPeriodType === 'year' ? 2200 : undefined}
                    value={distributorPeriod}
                    onChange={(event) => {
                      const nextPeriod = event.target.value;
                      setDistributorPeriod(nextPeriod);
                      setSelectedDistributorId(null);
                      setDistributorPurchases([]);
                      if (
                        (distributorPeriodType === 'month' && /^\d{4}-\d{2}$/.test(nextPeriod))
                        || (distributorPeriodType === 'year' && /^\d{4}$/.test(nextPeriod))
                      ) {
                        void loadDistributorData(distributorPeriodType, nextPeriod);
                      }
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void loadDistributorData()}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {distributorLoading ? '统计中...' : '刷新统计'}
                  </button>
                </div>
              </div>
            </div>

            {distributorSummary && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl bg-white p-5 shadow">
                  <div className="text-sm text-gray-500">分销商</div>
                  <div className="mt-2 text-2xl font-bold">{distributorSummary.distributors}</div>
                </div>
                <div className="rounded-xl bg-white p-5 shadow">
                  <div className="text-sm text-gray-500">新增注册</div>
                  <div className="mt-2 text-2xl font-bold text-blue-600">{distributorSummary.registrations}</div>
                </div>
                <div className="rounded-xl bg-white p-5 shadow">
                  <div className="text-sm text-gray-500">购买笔数</div>
                  <div className="mt-2 text-2xl font-bold text-violet-600">{distributorSummary.purchases}</div>
                </div>
                <div className="rounded-xl bg-white p-5 shadow">
                  <div className="text-sm text-gray-500">净销售额</div>
                  <div className="mt-2 text-2xl font-bold text-emerald-700">{formatCurrency(distributorSummary.net_revenue)}</div>
                </div>
                <div className="rounded-xl bg-white p-5 shadow">
                  <div className="text-sm text-gray-500">应计分成</div>
                  <div className="mt-2 text-2xl font-bold text-amber-600">{formatCurrency(distributorSummary.commission_amount)}</div>
                </div>
              </div>
            )}

            <div className="rounded-xl bg-white p-6 shadow">
              <h3 className="text-lg font-bold text-gray-900">新增分销商</h3>
              <p className="mt-1 text-sm text-gray-500">
                邀请码可留空自动生成；登录邮箱和初始密码同时填写后，会一并开通独立门户账户。
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <input
                  value={newDistributor.name}
                  onChange={(event) => setNewDistributor({ ...newDistributor, name: event.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="分销商名称 *"
                />
                <input
                  value={newDistributor.invite_code}
                  onChange={(event) => setNewDistributor({
                    ...newDistributor,
                    invite_code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                  })}
                  className="rounded-lg border border-gray-300 px-3 py-2 font-mono uppercase"
                  placeholder="邀请码（可留空）"
                  maxLength={20}
                />
                <input
                  value={newDistributor.contact_name}
                  onChange={(event) => setNewDistributor({ ...newDistributor, contact_name: event.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="联系人"
                />
                <input
                  value={newDistributor.contact_phone}
                  onChange={(event) => setNewDistributor({ ...newDistributor, contact_phone: event.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="联系方式"
                />
                <label className="flex items-center gap-3 rounded-lg border border-gray-300 px-3 py-2">
                  <span className="whitespace-nowrap text-sm text-gray-600">分成比例</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={newDistributor.commission_rate}
                    onChange={(event) => setNewDistributor({
                      ...newDistributor,
                      commission_rate: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                    })}
                    className="min-w-0 flex-1 border-0 text-right outline-none"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </label>
                <input
                  value={newDistributor.notes}
                  onChange={(event) => setNewDistributor({ ...newDistributor, notes: event.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2 md:col-span-2"
                  placeholder="备注"
                />
                <input
                  type="email"
                  value={newDistributor.account_email}
                  onChange={(event) => setNewDistributor({ ...newDistributor, account_email: event.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="门户登录邮箱（可稍后设置）"
                />
                <input
                  type="password"
                  value={newDistributor.account_password}
                  onChange={(event) => setNewDistributor({ ...newDistributor, account_password: event.target.value })}
                  className="rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="初始密码（至少 8 位）"
                />
                <button
                  type="button"
                  onClick={() => void createDistributor()}
                  className="rounded-lg bg-gray-900 px-5 py-2 font-medium text-white hover:bg-black"
                >
                  生成长期邀请码
                </button>
              </div>
            </div>

            {distributors.length === 0 ? (
              <div className="rounded-xl bg-white px-6 py-14 text-center text-gray-500 shadow">
                {distributorLoading ? '正在读取分销商统计...' : '暂无分销商，请先创建'}
              </div>
            ) : (
              <div className="space-y-4">
                {distributors.map((distributor) => (
                  <div key={distributor.id} className="rounded-xl bg-white p-6 shadow">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-bold text-gray-900">{distributor.name}</h3>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                            distributor.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-gray-200 text-gray-600'
                          }`}>
                            {distributor.status === 'active' ? '启用中' : '已停用'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyDistributorCode(distributor.invite_code)}
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm font-semibold text-gray-900 hover:border-gray-400"
                        >
                          {distributor.invite_code}
                          <span className="font-sans text-xs font-normal text-gray-500">复制</span>
                        </button>
                        <div className="mt-2 text-sm text-gray-500">
                          {distributor.contact_name || '未填写联系人'}
                          {distributor.contact_phone ? ` · ${distributor.contact_phone}` : ''}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-end gap-3">
                        <label className="block">
                          <span className="mb-1 block text-xs text-gray-500">分成比例（自动保存）</span>
                          <div className="flex items-center rounded-lg border border-gray-300 px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={distributor.commission_rate}
                              onChange={(event) => {
                                const rate = Math.min(100, Math.max(0, Number(event.target.value) || 0));
                                setDistributors((items) => items.map((item) => (
                                  item.id === distributor.id
                                    ? {
                                        ...item,
                                        commission_rate: rate,
                                        metrics: {
                                          ...item.metrics,
                                          commission_amount: Math.round(item.metrics.net_revenue * rate) / 100,
                                        },
                                      }
                                    : item
                                )));
                              }}
                              onBlur={(event) => void updateDistributor(distributor.id, {
                                commission_rate: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                              })}
                              className="w-20 border-0 text-right font-semibold outline-none"
                            />
                            <span className="ml-1 text-sm text-gray-500">%</span>
                          </div>
                        </label>
                        <button
                          type="button"
                          onClick={() => void updateDistributor(distributor.id, {
                            status: distributor.status === 'active' ? 'disabled' : 'active',
                          })}
                          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {distributor.status === 'active' ? '停用邀请码' : '重新启用'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">本期注册</div>
                        <div className="mt-1 text-lg font-bold">{distributor.metrics.period_registrations}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">累计注册</div>
                        <div className="mt-1 text-lg font-bold">{distributor.metrics.total_registrations}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">本期购买</div>
                        <div className="mt-1 text-lg font-bold">{distributor.metrics.period_purchases}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">销售额</div>
                        <div className="mt-1 font-bold">{formatCurrency(distributor.metrics.gross_revenue)}</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="text-xs text-gray-500">净销售额</div>
                        <div className="mt-1 font-bold text-emerald-700">{formatCurrency(distributor.metrics.net_revenue)}</div>
                      </div>
                      <div className="rounded-lg bg-amber-50 p-3">
                        <div className="text-xs text-amber-700">本期应计分成</div>
                        <div className="mt-1 font-bold text-amber-700">{formatCurrency(distributor.metrics.commission_amount)}</div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold text-gray-900">分销商门户账户</h4>
                          <p className="mt-1 text-xs text-gray-500">
                            该账户登录后只能读取当前分销商的数据；密码留空表示不修改。
                          </p>
                        </div>
                        <div className="text-right text-xs text-gray-500">
                          {distributor.account?.last_login_at
                            ? `最近登录：${new Date(distributor.account.last_login_at).toLocaleString()}`
                            : distributor.account ? '尚未登录' : '尚未开通'}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_140px_auto]">
                        <input
                          type="email"
                          value={distributorAccountDrafts[distributor.id]?.email ?? distributor.account?.email ?? ''}
                          onChange={(event) => updateDistributorAccountDraft(distributor, { email: event.target.value })}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          placeholder="登录邮箱"
                        />
                        <input
                          type="password"
                          value={distributorAccountDrafts[distributor.id]?.password ?? ''}
                          onChange={(event) => updateDistributorAccountDraft(distributor, { password: event.target.value })}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          placeholder={distributor.account ? '新密码（留空不修改）' : '初始密码（至少 8 位）'}
                        />
                        <select
                          value={distributorAccountDrafts[distributor.id]?.status ?? distributor.account?.status ?? 'active'}
                          onChange={(event) => updateDistributorAccountDraft(distributor, {
                            status: event.target.value as 'active' | 'disabled',
                          })}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="active">允许登录</option>
                          <option value="disabled">禁止登录</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void saveDistributorAccount(distributor)}
                          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
                        >
                          {distributor.account ? '保存账户' : '开通账户'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold text-gray-900">套餐购买统计</h4>
                          <p className="text-xs text-gray-500">同一用户多次购买会逐笔计数，不做首次购买去重。</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedDistributorId === distributor.id) {
                              setSelectedDistributorId(null);
                              setDistributorPurchases([]);
                            } else {
                              void loadDistributorPurchases(distributor.id);
                            }
                          }}
                          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
                        >
                          {selectedDistributorId === distributor.id ? '收起购买明细' : '查看逐笔购买'}
                        </button>
                      </div>

                      {distributor.package_breakdown.length === 0 ? (
                        <div className="mt-3 rounded-lg border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                          本期暂无成功购买
                        </div>
                      ) : (
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {distributor.package_breakdown.map((packageItem) => (
                            <div key={packageItem.package_type} className="rounded-lg border border-gray-200 p-4">
                              <div className="font-semibold text-gray-900">{packageItem.package_type}</div>
                              <div className="mt-2 flex justify-between text-sm text-gray-600">
                                <span>{packageItem.purchase_count} 笔</span>
                                <span>{formatCurrency(packageItem.net_revenue)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {selectedDistributorId === distributor.id && (
                      <div className="mt-5 overflow-hidden rounded-lg border border-gray-200">
                        {distributorPurchases.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-gray-500">本期暂无购买明细</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left font-semibold text-gray-700">购买时间</th>
                                  <th className="px-4 py-3 text-left font-semibold text-gray-700">用户</th>
                                  <th className="px-4 py-3 text-left font-semibold text-gray-700">套餐类型</th>
                                  <th className="px-4 py-3 text-left font-semibold text-gray-700">支付方式</th>
                                  <th className="px-4 py-3 text-right font-semibold text-gray-700">金额</th>
                                  <th className="px-4 py-3 text-right font-semibold text-gray-700">退款</th>
                                  <th className="px-4 py-3 text-right font-semibold text-gray-700">净收入</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 bg-white">
                                {distributorPurchases.map((purchase) => (
                                  <tr key={purchase.id}>
                                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                                      {new Date(purchase.paid_at || purchase.created_at).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="font-medium text-gray-900">{purchase.username || purchase.user_email}</div>
                                      {purchase.username && <div className="text-xs text-gray-500">{purchase.user_email}</div>}
                                    </td>
                                    <td className="px-4 py-3 font-medium text-gray-900">{purchase.package_type}</td>
                                    <td className="px-4 py-3 text-gray-600">{purchase.payment_method}</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(purchase.amount)}</td>
                                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(purchase.refund_amount)}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatCurrency(purchase.net_revenue)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-6">
            {feedbackStats && (
              <div className="grid md:grid-cols-5 gap-4">
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">总反馈</div>
                  <div className="text-2xl font-bold text-gray-900">{feedbackStats.total}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">待处理</div>
                  <div className="text-2xl font-bold text-red-600">{feedbackStats.open}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">处理中</div>
                  <div className="text-2xl font-bold text-blue-600">{feedbackStats.reviewing}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">已解决</div>
                  <div className="text-2xl font-bold text-green-600">{feedbackStats.resolved}</div>
                </div>
                <div className="bg-white rounded-xl shadow p-4">
                  <div className="text-sm text-gray-500">已关闭</div>
                  <div className="text-2xl font-bold text-gray-600">{feedbackStats.closed}</div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">意见反馈</h3>
                  <p className="text-sm text-gray-500 mt-1">来自桌面端左侧边栏“意见反馈”的提交记录</p>
                </div>
                <button onClick={() => loadData('feedback')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
                  刷新
                </button>
              </div>

              {feedback.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">暂无意见反馈</div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {feedback.map((item) => (
                    <div key={item.id} className="p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              item.status === 'open' ? 'bg-red-100 text-red-800' :
                              item.status === 'reviewing' ? 'bg-blue-100 text-blue-800' :
                              item.status === 'resolved' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {getFeedbackStatusLabel(item.status)}
                            </span>
                            <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-800">
                              {getFeedbackCategoryLabel(item.category)}
                            </span>
                            <span className="text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</span>
                          </div>
                          <h4 className="text-base font-bold text-gray-900 break-words">{item.title || '未命名反馈'}</h4>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700 break-words">{item.content}</p>
                          <div className="mt-4 grid md:grid-cols-2 gap-2 text-xs text-gray-500">
                            <div>用户：{item.userEmail || item.username || item.userId || '未登录/未知'}</div>
                            <div>联系方式：{item.contact || '-'}</div>
                            <div>来源：{item.source || '-'} {item.appVersion ? `· ${item.appVersion}` : ''}</div>
                            <div>设备：{item.machineId || '-'}</div>
                          </div>
                          {item.adminNotes && (
                            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
                              <div className="text-xs font-medium text-gray-500 mb-1">处理备注</div>
                              <div className="whitespace-pre-wrap">{item.adminNotes}</div>
                            </div>
                          )}
                        </div>
                        <div className="w-full sm:w-56 space-y-2">
                          <select
                            value={item.status}
                            onChange={(e) => updateFeedback(item.id, { status: e.target.value, priority: item.priority, adminNotes: item.adminNotes || '' })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="open">待处理</option>
                            <option value="reviewing">处理中</option>
                            <option value="resolved">已解决</option>
                            <option value="closed">已关闭</option>
                          </select>
                          <button
                            onClick={() => {
                              const note = prompt('处理备注：', item.adminNotes || '');
                              if (note !== null) updateFeedback(item.id, { status: item.status, priority: item.priority, adminNotes: note });
                            }}
                            className="w-full px-3 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm text-gray-700"
                          >
                            编辑备注
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
