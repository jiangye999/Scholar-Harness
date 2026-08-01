'use client';

import { useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!email) {
      setError('请输入邮箱地址');
      return;
    }
    if (!validateEmail(email)) {
      setError('邮箱格式不正确');
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发送失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          {/* Header */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">验证码已发送</h2>
            <p className="text-gray-600 mb-6">
              密码重置验证码已发送到您的邮箱，请在下一步输入验证码
            </p>
            <Link
              href={`/reset-password?email=${encodeURIComponent(email)}`}
              className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
            >
              输入验证码并重置密码
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              S
            </div>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">忘记密码</h2>
          <p className="mt-2 text-sm text-gray-600">
            输入您的邮箱地址，我们将发送密码重置验证码
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="your@email.com"
                required
              />
            </div>

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
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition flex items-center justify-center"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  发送中...
                </>
              ) : (
                '发送重置链接'
              )}
            </button>
          </form>

          {/* Footer Link */}
          <div className="mt-6 text-center text-sm text-gray-600">
            <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
              返回登录
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
