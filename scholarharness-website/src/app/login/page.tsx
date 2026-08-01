'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { login, validateBetaCode } from '@/lib/auth';
import Link from 'next/link';

function LoginPageContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [betaCode, setBetaCode] = useState('');
  const [betaCodeValid, setBetaCodeValid] = useState<boolean | null>(null);
  const [betaCodeMessage, setBetaCodeMessage] = useState('');
  const [betaCodeLoading, setBetaCodeLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trialMessage, setTrialMessage] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedEmail = localStorage.getItem('rememberedEmail');
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 验证内测码
  const handleBetaCodeValidation = async () => {
    if (!betaCode.trim()) {
      setBetaCodeValid(null);
      setBetaCodeMessage('');
      return;
    }

    setBetaCodeLoading(true);
    try {
      const result = await validateBetaCode(betaCode.trim().toUpperCase());
      setBetaCodeValid(result.valid);
      if (result.valid) {
        setBetaCodeMessage(result.message || (result.access_type === 'lifetime'
          ? '有效 - 限时永久内测码'
          : `有效 - ${result.validity_days}天免费试用`));
      } else {
        setBetaCodeMessage(result.reason || '内测码无效');
      }
    } catch {
      setBetaCodeValid(false);
      setBetaCodeMessage('验证失败，请稍后重试');
    } finally {
      setBetaCodeLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setTrialMessage('');

    // Validation
    if (!email) {
      setError('请输入邮箱地址');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    try {
      const result = await login(email, password, betaCode.trim() || undefined);
      
      // 显示内测码激活结果
      if (result.trial_info) {
        setTrialMessage(result.trial_info.message);
      }
      
      // Save email if remember me is checked
      if (rememberMe) {
        localStorage.setItem('rememberedEmail', email);
      } else {
        localStorage.removeItem('rememberedEmail');
      }
      
      // 如果激活了试用，短暂显示成功消息后跳转
      if (result.trial_info?.success) {
        setTimeout(() => {
          const redirectTo = searchParams.get('redirect') || '/dashboard';
          router.push(redirectTo);
        }, 1500);
      } else {
        // Redirect to dashboard or previous page
        const redirectTo = searchParams.get('redirect') || '/dashboard';
        router.push(redirectTo);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center text-gray-900 font-bold text-xl">
              S
            </div>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">登录账号</h2>
          <p className="mt-2 text-sm text-gray-600">
            使用您的 ScholarHarness 账号登录
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-[0_10px_32px_rgba(17,24,39,0.08)] border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                邮箱地址 <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                placeholder="your@email.com"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                密码 <span className="text-red-500">*</span>
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                placeholder="输入密码"
                required
              />
            </div>

            {/* Beta Code */}
            <div>
              <label htmlFor="betaCode" className="block text-sm font-medium text-gray-700 mb-2">
                内测码 <span className="text-gray-400">(可选)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="betaCode"
                  type="text"
                  value={betaCode}
                  onChange={(e) => {
                    setBetaCode(e.target.value.toUpperCase());
                    setBetaCodeValid(null);
                    setBetaCodeMessage('');
                  }}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition font-mono uppercase"
                  placeholder="输入内测码"
                  maxLength={20}
                />
                <button
                  type="button"
                  onClick={handleBetaCodeValidation}
                  disabled={!betaCode.trim() || betaCodeLoading}
                  className="px-4 py-3 bg-gray-100 hover:bg-white border border-gray-300 hover:border-emerald-700 disabled:bg-gray-50 text-gray-700 hover:text-emerald-700 rounded-md transition text-sm font-medium"
                >
                  {betaCodeLoading ? '验证中...' : '验证'}
                </button>
              </div>
              {/* Beta Code Validation Result */}
              {betaCodeMessage && (
                <p className={`mt-2 text-sm ${betaCodeValid ? 'text-green-600' : 'text-red-600'}`}>
                  {betaCodeValid ? '✓ ' : '✗ '}{betaCodeMessage}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                如已有账号但未激活试用，可填写内测码登录时激活
              </p>
            </div>

            {/* Remember Me */}
            <div className="flex items-center">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 text-emerald-700 focus:ring-emerald-700 border-gray-300 rounded"
              />
              <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-700">
                记住我
              </label>
            </div>

            {/* Trial Success Message */}
            {trialMessage && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {trialMessage}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-md font-medium transition flex items-center justify-center shadow-[0_8px_18px_rgba(0,136,110,0.16)] disabled:shadow-none"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  登录中...
                </>
              ) : (
                '登录'
              )}
            </button>
          </form>

          {/* Footer Links */}
          <div className="mt-6 space-y-2 text-center text-sm text-gray-600">
            <Link href="/forgot-password" className="text-emerald-700 hover:text-emerald-800 font-medium">
              忘记密码？
            </Link>
            <div>
              还没有账号？{' '}
              <Link href="/register" className="text-emerald-700 hover:text-emerald-800 font-medium">
                立即注册
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-600">加载中...</div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
