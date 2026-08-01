'use client';

import { useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  claimInviteTrialReward,
  getCurrentUser,
  getInviteTrialStatus,
  getStoredUser,
  getSubscription,
  logout,
} from '@/lib/auth';
import type { InviteTrialStatus, Subscription, User } from '@/lib/auth';
import Link from 'next/link';
import Image from 'next/image';

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteStatus, setInviteStatus] = useState<InviteTrialStatus | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [inviteCopyMessage, setInviteCopyMessage] = useState('');
  const router = useRouter();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load user data
      const userData = await getCurrentUser();
      if (!userData) {
        router.push('/login?redirect=/dashboard');
        return;
      }
      setUser(userData);
      setInviteStatus(await getInviteTrialStatus());

      // Load subscription data
      const subData = await getSubscription();
      setSubscription(subData);
    } catch (error) {
      console.error('Load data error:', error);
      // Use stored user if API fails
      const storedUser = getStoredUser();
      if (storedUser) {
        setUser(storedUser);
      } else {
        router.push('/login');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getPlanName = (planType: string) => {
    const names: Record<string, string> = {
      monthly: '月度套餐',
      quarterly: '季度套餐',
      yearly: '年度套餐',
      lifetime: '永久套餐',
      trial: '试用套餐',
    };
    return names[planType] || planType;
  };

  const getDaysRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  };

  const getInviteLink = () => {
    if (!user?.referral_code || typeof window === 'undefined') return '';
    return `${window.location.origin}/register?ref=${encodeURIComponent(user.referral_code)}`;
  };

  const handleCopyInviteLink = async () => {
    const inviteLink = getInviteLink();
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopyMessage('邀请链接已复制');
    } catch {
      setInviteCopyMessage(inviteLink);
    }
  };

  const handleClaimInviteReward = async () => {
    setClaimLoading(true);
    setInviteCopyMessage('');
    try {
      const result = await claimInviteTrialReward();
      setInviteCopyMessage(result.message || '邀请奖励已领取');
      setInviteStatus(await getInviteTrialStatus());
      if (result.subscription) {
        setSubscription(result.subscription);
      } else {
        setSubscription(await getSubscription());
      }
    } catch (error: unknown) {
      setInviteCopyMessage(error instanceof Error ? error.message : '领取失败，请稍后重试');
    } finally {
      setClaimLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">个人中心</h1>
          <p className="mt-2 text-gray-600">管理您的账号信息和订阅套餐</p>
        </div>

        {/* Grid Layout */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* User Info Card */}
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">用户信息</h2>
              {/* 用户头像 */}
              <div className="relative w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center overflow-hidden">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt="用户头像"
                    fill
                    sizes="48px"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-500">邮箱</label>
                <p className="text-gray-900 font-medium">{user.email}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">用户名</label>
                <p className="text-gray-900 font-medium">{user.username || user.email.split('@')[0]}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">角色</label>
                <p className="text-gray-900 font-medium">{user.role === 'admin' ? '管理员' : '普通用户'}</p>
              </div>
            </div>
          </div>

          {/* Referral Reward Card */}
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 lg:col-span-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">邀请奖励</h2>
                <p className="mt-1 text-sm text-gray-600">
                  邀请 3 位新用户注册并完成邮箱验证，可领取一次 30 天免费使用时长。
                </p>
              </div>
              <button
                onClick={handleClaimInviteReward}
                disabled={!inviteStatus?.eligible || claimLoading}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:bg-gray-300"
              >
                {claimLoading ? '领取中...' : inviteStatus?.claimed_by_user ? '已领取' : '领取30天'}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm text-gray-500">我的邀请码</div>
                <div className="mt-2 font-mono text-2xl font-bold tracking-wide text-gray-900">
                  {user.referral_code || '-'}
                </div>
                <button
                  onClick={handleCopyInviteLink}
                  disabled={!user.referral_code}
                  className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-emerald-700 hover:text-emerald-700 disabled:text-gray-400"
                >
                  复制邀请链接
                </button>
                {inviteCopyMessage && (
                  <p className={`mt-2 text-xs ${inviteCopyMessage.startsWith('http') || inviteCopyMessage.includes('失败') ? 'text-red-600' : 'text-emerald-700'}`}>
                    {inviteCopyMessage}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">邀请进度</span>
                  <span className="font-medium text-gray-900">
                    {inviteStatus?.referral_count ?? 0} / {inviteStatus?.required_referrals ?? 3}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((inviteStatus?.referral_count ?? 0) / (inviteStatus?.required_referrals ?? 3)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  {inviteStatus?.claimed_by_user
                    ? '该账号已经领取过邀请奖励，后续邀请不再重复赠送。'
                    : inviteStatus?.eligible
                      ? '已满足条件，可以领取 30 天免费使用时长。'
                      : `还需邀请 ${inviteStatus?.remaining_referrals ?? 3} 位完成邮箱验证的新用户。`}
                </div>
              </div>
            </div>
          </div>

          {/* Subscription Card */}
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">订阅状态</h2>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            
            {subscription ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-500">套餐类型</label>
                  <p className="text-gray-900 font-medium">{getPlanName(subscription.plan_type)}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">状态</label>
                  <p className={`font-medium ${subscription.status === 'active' || subscription.status === 'trial' ? 'text-green-600' : 'text-gray-600'}`}>
                    {subscription.status === 'active'
                      ? '✓ 活跃'
                      : subscription.status === 'trial'
                        ? '✓ 试用中'
                        : subscription.status}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-500">有效期至</label>
                  {subscription.plan_type === 'lifetime' ? (
                    <>
                      <p className="text-gray-900 font-medium">永久</p>
                      <p className="text-sm mt-1 text-green-600">永久有效</p>
                    </>
                  ) : (
                    <>
                      <p className="text-gray-900 font-medium">{formatDate(subscription.end_date)}</p>
                      <p className={`text-sm mt-1 ${getDaysRemaining(subscription.end_date) < 7 ? 'text-red-600' : 'text-gray-600'}`}>
                        剩余 {getDaysRemaining(subscription.end_date)} 天
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-gray-500 mb-4">尚未购买套餐</p>
                <Link
                  href="/pricing"
                  className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
                >
                  立即购买
                </Link>
              </div>
            )}
          </div>

          {/* Quick Actions Card */}
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 lg:col-span-2">
            <h2 className="text-xl font-bold text-gray-900 mb-6">快捷操作</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Link
                href="/pricing"
                className="flex items-center gap-3 p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1h-2m5 0H12" />
                </svg>
                <span className="text-gray-900 font-medium">购买套餐</span>
              </Link>

              <Link
                href="#"
                className="flex items-center gap-3 p-4 bg-green-50 hover:bg-green-100 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-gray-900 font-medium">续费套餐</span>
              </Link>

              <Link
                href="#"
                className="flex items-center gap-3 p-4 bg-purple-50 hover:bg-purple-100 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <span className="text-gray-900 font-medium">升级套餐</span>
              </Link>

              <button
                onClick={handleLogout}
                className="flex items-center gap-3 p-4 bg-red-50 hover:bg-red-100 rounded-lg transition text-left"
              >
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-gray-900 font-medium">退出登录</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
