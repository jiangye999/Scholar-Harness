'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://scholarharness.com/api/v1';

type PeriodType = 'month' | 'year';

interface DashboardData {
  period: {
    type: PeriodType;
    key: string;
    label: string;
  };
  distributor: {
    name: string;
    invite_code: string;
    display_name?: string;
    contact_name?: string;
    commission_rate: number;
  };
  metrics: {
    period_registrations: number;
    total_registrations: number;
    period_purchases: number;
    gross_revenue: number;
    refund_amount: number;
    net_revenue: number;
    commission_amount: number;
  };
  package_breakdown: Array<{
    package_type: string;
    purchase_count: number;
    gross_revenue: number;
    refund_amount: number;
    net_revenue: number;
  }>;
  customers: Array<{
    id: string;
    email: string;
    username?: string;
    registered_at: string;
    purchase_count: number;
    net_revenue: number;
    last_purchase_at?: string;
  }>;
  purchases: Array<{
    id: string;
    customer_email: string;
    package_type: string;
    amount: number;
    currency: string;
    status: string;
    refund_amount: number;
    net_revenue: number;
    paid_at: string;
  }>;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currency(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function dateTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('zh-CN');
}

export default function DistributorPortalPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const [period, setPeriod] = useState(currentMonth());
  const [copied, setCopied] = useState(false);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  function clearSession() {
    localStorage.removeItem('distributorAccessToken');
    localStorage.removeItem('distributorRefreshToken');
    setIsLoggedIn(false);
    setDashboard(null);
  }

  async function refreshSession(): Promise<string | null> {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    refreshPromiseRef.current = (async () => {
      const refreshToken = localStorage.getItem('distributorRefreshToken');
      if (!refreshToken) return null;
      try {
        const response = await fetch(`${API_BASE_URL}/distributor/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.tokens?.accessToken || !data?.tokens?.refreshToken) return null;
        localStorage.setItem('distributorAccessToken', data.tokens.accessToken);
        localStorage.setItem('distributorRefreshToken', data.tokens.refreshToken);
        return data.tokens.accessToken as string;
      } catch {
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    return refreshPromiseRef.current;
  }

  async function portalFetch(url: string): Promise<Response> {
    const request = (token: string | null) => fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    let token = localStorage.getItem('distributorAccessToken');
    let response = await request(token);
    if (response.status !== 401) return response;
    token = await refreshSession();
    if (token) response = await request(token);
    if (response.status === 401 || response.status === 403) clearSession();
    return response;
  }

  async function loadDashboard(nextType = periodType, nextPeriod = period) {
    setLoading(true);
    setDashboardError('');
    try {
      const params = new URLSearchParams({
        period_type: nextType,
        period: nextPeriod,
      });
      const response = await portalFetch(`${API_BASE_URL}/distributor/dashboard?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDashboardError(data.message || '读取分销数据失败');
        return;
      }
      setDashboard(data);
      setIsLoggedIn(true);
    } catch {
      setDashboardError('网络连接失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (
        localStorage.getItem('distributorAccessToken')
        || localStorage.getItem('distributorRefreshToken')
      ) {
        void loadDashboard('month', currentMonth());
      } else {
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // Initial restore runs only once; later period changes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const response = await fetch(`${API_BASE_URL}/distributor/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoginError(data.message || '登录失败');
        return;
      }
      localStorage.setItem('distributorAccessToken', data.tokens.accessToken);
      localStorage.setItem('distributorRefreshToken', data.tokens.refreshToken);
      setIsLoggedIn(true);
      setPassword('');
      await loadDashboard('month', currentMonth());
    } catch {
      setLoginError('网络连接失败，请稍后重试');
    } finally {
      setLoginLoading(false);
    }
  }

  async function copyInviteCode() {
    if (!dashboard?.distributor.invite_code) return;
    try {
      await navigator.clipboard.writeText(dashboard.distributor.invite_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (loading && !isLoggedIn && !dashboard) {
    return (
      <main id="main-content" className="grid min-h-screen place-items-center bg-[#f4f5f1] text-[#1d2420]">
        <div className="text-sm text-[#68716c]">正在读取分销合作中心…</div>
      </main>
    );
  }

  if (!isLoggedIn || !dashboard) {
    return (
      <main id="main-content" className="min-h-screen bg-[#f4f5f1] px-5 py-10 text-[#1d2420]">
        <div className="mx-auto grid min-h-[72vh] max-w-5xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <section>
            <div className="text-sm font-semibold tracking-[0.18em] text-[#68716c]">SCHOLAR HARNESS</div>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              分销合作中心
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-[#5f6963]">
              查看自己邀请码带来的注册记录、套餐购买、退款、净销售额与应计分成。
              数据与 Scholar Harness 管理后台使用同一套归因记录。
            </p>
            <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
              {['客户归因清晰', '购买逐笔记录', '月度年度汇总'].map((item) => (
                <div key={item} className="border-t border-[#cbd0cc] pt-3 text-sm font-medium">
                  {item}
                </div>
              ))}
            </div>
          </section>
          <form onSubmit={handleLogin} className="rounded-2xl border border-[#d9ddd9] bg-white p-7 shadow-[0_18px_50px_rgba(37,45,40,0.08)] sm:p-9">
            <h2 className="text-xl font-semibold">分销商登录</h2>
            <p className="mt-2 text-sm leading-6 text-[#68716c]">账户由 Scholar Harness 管理员开通。</p>
            <label className="mt-7 block text-sm font-medium">
              登录邮箱
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#cfd5d0] bg-white px-4 py-3 outline-none transition focus:border-[#202923] focus:ring-2 focus:ring-[#202923]/10"
                placeholder="partner@example.com"
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              密码
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[#cfd5d0] bg-white px-4 py-3 outline-none transition focus:border-[#202923] focus:ring-2 focus:ring-[#202923]/10"
                placeholder="至少 8 位"
              />
            </label>
            {loginError && (
              <div className="mt-4 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#9d3225]">{loginError}</div>
            )}
            <button
              type="submit"
              disabled={loginLoading}
              className="mt-6 w-full rounded-xl bg-[#1d2420] px-5 py-3 font-semibold text-white transition hover:bg-[#0d110f] disabled:cursor-wait disabled:opacity-60"
            >
              {loginLoading ? '正在登录…' : '登录合作中心'}
            </button>
            <p className="mt-5 text-xs leading-5 text-[#7a827d]">
              忘记密码或账户被停用，请联系 Scholar Harness 管理员。
            </p>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen bg-[#f4f5f1] text-[#1d2420]">
      <header className="border-b border-[#dfe3df] bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-5 px-5 py-5 lg:px-8">
          <div>
            <div className="text-xs font-semibold tracking-[0.18em] text-[#78807b]">SCHOLAR HARNESS</div>
            <h1 className="mt-1 text-2xl font-semibold">分销合作中心</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-[#d7dcd8] bg-[#f7f8f6] px-4 py-2">
              <div className="text-[11px] text-[#78807b]">当前分销商</div>
              <div className="text-sm font-semibold">{dashboard.distributor.name}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                clearSession();
                setLoginError('');
              }}
              className="rounded-xl border border-[#cdd3ce] px-4 py-3 text-sm font-medium hover:bg-[#f2f4f1]"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">
        <section className="grid gap-4 rounded-2xl bg-[#1d2420] p-6 text-white lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="text-xs font-medium tracking-[0.16em] text-white/55">长期有效邀请码</div>
            <div className="mt-2 font-mono text-3xl font-semibold tracking-[0.12em]">
              {dashboard.distributor.invite_code}
            </div>
            <p className="mt-3 text-sm text-white/65">
              客户注册时填写该邀请码后，其后续成功购买会持续归属到你的统计中。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyInviteCode()}
            className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold hover:bg-white hover:text-[#1d2420]"
          >
            {copied ? '已复制' : '复制邀请码'}
          </button>
        </section>

        <section className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">经营概览</h2>
            <p className="mt-1 text-sm text-[#6e7771]">
              当前统计周期：{dashboard.period.label}；分成按净销售额 × {dashboard.distributor.commission_rate}% 计算。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-[#cfd5d0] bg-white p-1">
              {(['month', 'year'] as PeriodType[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    const nextPeriod = item === 'month' ? currentMonth() : String(new Date().getFullYear());
                    setPeriodType(item);
                    setPeriod(nextPeriod);
                    void loadDashboard(item, nextPeriod);
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    periodType === item ? 'bg-[#1d2420] text-white' : 'text-[#68716c] hover:bg-[#f1f3f0]'
                  }`}
                >
                  {item === 'month' ? '月度' : '年度'}
                </button>
              ))}
            </div>
            <input
              type={periodType === 'month' ? 'month' : 'number'}
              min={periodType === 'year' ? 2000 : undefined}
              max={periodType === 'year' ? 2200 : undefined}
              value={period}
              onChange={(event) => {
                const next = event.target.value;
                setPeriod(next);
                if (
                  (periodType === 'month' && /^\d{4}-\d{2}$/.test(next))
                  || (periodType === 'year' && /^\d{4}$/.test(next))
                ) {
                  void loadDashboard(periodType, next);
                }
              }}
              className="rounded-xl border border-[#cfd5d0] bg-white px-4 py-3 text-sm outline-none"
            />
          </div>
        </section>

        {dashboardError && (
          <div className="mt-5 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#9d3225]">{dashboardError}</div>
        )}

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ['本期新增注册', dashboard.metrics.period_registrations, '人'],
            ['累计邀请注册', dashboard.metrics.total_registrations, '人'],
            ['本期购买', dashboard.metrics.period_purchases, '笔'],
            ['本期净销售额', currency(dashboard.metrics.net_revenue), ''],
            ['本期应计分成', currency(dashboard.metrics.commission_amount), ''],
          ].map(([label, value, unit], index) => (
            <div
              key={String(label)}
              className={`rounded-2xl border p-5 ${
                index === 4 ? 'border-[#e6c892] bg-[#fff8e8]' : 'border-[#dfe3df] bg-white'
              }`}
            >
              <div className="text-sm text-[#707872]">{label}</div>
              <div className="mt-3 text-2xl font-semibold">
                {value}<span className="ml-1 text-sm font-normal text-[#778079]">{unit}</span>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-[#dfe3df] bg-white p-6">
            <h2 className="text-lg font-semibold">套餐消费构成</h2>
            <p className="mt-1 text-sm text-[#727b75]">同一客户重复购买会逐笔计入。</p>
            {dashboard.package_breakdown.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-[#d1d6d2] px-4 py-10 text-center text-sm text-[#7a827d]">
                本期暂无成功购买
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {dashboard.package_breakdown.map((item) => (
                  <div key={item.package_type} className="rounded-xl bg-[#f4f6f3] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="font-medium">{item.package_type}</div>
                      <div className="whitespace-nowrap text-sm font-semibold">{currency(item.net_revenue)}</div>
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-[#707972]">
                      <span>{item.purchase_count} 笔</span>
                      {item.refund_amount > 0 && <span>退款 {currency(item.refund_amount)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#dfe3df] bg-white">
            <div className="border-b border-[#e4e7e4] px-6 py-5">
              <h2 className="text-lg font-semibold">邀请客户记录</h2>
              <p className="mt-1 text-sm text-[#727b75]">为保护客户隐私，邮箱只展示脱敏结果。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[#f5f6f4] text-xs text-[#68716c]">
                  <tr>
                    <th className="px-5 py-3 font-medium">客户</th>
                    <th className="px-5 py-3 font-medium">注册时间</th>
                    <th className="px-5 py-3 text-right font-medium">购买笔数</th>
                    <th className="px-5 py-3 text-right font-medium">累计净消费</th>
                    <th className="px-5 py-3 font-medium">最近购买</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eceeec]">
                  {dashboard.customers.length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-[#7a827d]">暂无邀请注册记录</td></tr>
                  ) : dashboard.customers.map((customer) => (
                    <tr key={customer.id}>
                      <td className="px-5 py-4">
                        <div className="font-medium">{customer.username || customer.email}</div>
                        {customer.username && <div className="mt-0.5 text-xs text-[#7a827d]">{customer.email}</div>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-[#5f6963]">{dateTime(customer.registered_at)}</td>
                      <td className="px-5 py-4 text-right">{customer.purchase_count}</td>
                      <td className="px-5 py-4 text-right font-medium">{currency(customer.net_revenue)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-[#5f6963]">{dateTime(customer.last_purchase_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-[#dfe3df] bg-white">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4e7e4] px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold">本期逐笔购买</h2>
              <p className="mt-1 text-sm text-[#727b75]">退款会从净销售额和应计分成中扣除。</p>
            </div>
            <div className="text-sm text-[#68716c]">
              销售 {currency(dashboard.metrics.gross_revenue)} · 退款 {currency(dashboard.metrics.refund_amount)}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#f5f6f4] text-xs text-[#68716c]">
                <tr>
                  <th className="px-5 py-3 font-medium">购买时间</th>
                  <th className="px-5 py-3 font-medium">客户</th>
                  <th className="px-5 py-3 font-medium">套餐</th>
                  <th className="px-5 py-3 text-right font-medium">支付</th>
                  <th className="px-5 py-3 text-right font-medium">退款</th>
                  <th className="px-5 py-3 text-right font-medium">净额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eceeec]">
                {dashboard.purchases.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-[#7a827d]">本期暂无购买记录</td></tr>
                ) : dashboard.purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="whitespace-nowrap px-5 py-4 text-[#5f6963]">{dateTime(purchase.paid_at)}</td>
                    <td className="px-5 py-4">{purchase.customer_email}</td>
                    <td className="px-5 py-4 font-medium">{purchase.package_type}</td>
                    <td className="px-5 py-4 text-right">{currency(purchase.amount)}</td>
                    <td className="px-5 py-4 text-right text-[#a13e33]">{currency(purchase.refund_amount)}</td>
                    <td className="px-5 py-4 text-right font-semibold">{currency(purchase.net_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="mt-5 text-xs leading-5 text-[#7a827d]">
          “应计分成”为按当前分成比例计算的对账参考值，最终结算以 Scholar Harness 管理员确认结果为准。
        </p>
      </div>
    </main>
  );
}
