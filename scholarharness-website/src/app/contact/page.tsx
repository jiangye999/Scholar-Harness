'use client';

import { useState } from 'react';
import Link from 'next/link';

const supportEmail = 'sjs@cau.edu.cn';

const subjectLabels: Record<string, string> = {
  technical: '技术支持',
  billing: '账单问题',
  feature: '功能建议',
  bug: 'Bug反馈',
  other: '其他'
};

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const subject = `ScholarHarness ${subjectLabels[formData.subject] || '咨询'}`;
    const body = [
      `姓名：${formData.name}`,
      `邮箱：${formData.email}`,
      `主题：${subjectLabels[formData.subject] || formData.subject}`,
      '',
      '消息内容：',
      formData.message
    ].join('\n');

    window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">邮件已准备好</h2>
          <p className="text-gray-600 mb-6">
            请在弹出的邮件客户端中确认发送。如果没有弹出，也可以直接发送邮件到 {supportEmail}。
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a
              href={`mailto:${supportEmail}`}
              className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
            >
              打开邮箱
            </a>
            <Link
              href="/help"
              className="inline-block px-6 py-3 border border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg font-medium transition"
            >
              返回帮助中心
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">联系我们</h1>
          <p className="text-gray-600 text-lg">有任何问题或建议？我们很乐意听取您的意见</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Contact Info */}
          <div>
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6">联系方式</h2>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">邮箱</h3>
                    <a href={`mailto:${supportEmail}`} className="text-blue-600 hover:text-blue-700">
                      {supportEmail}
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">GitHub</h3>
                    <a
                      href="https://github.com/scholarharness"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700"
                    >
                      github.com/scholarharness
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-6">
              <h3 className="font-semibold text-blue-900 mb-2">响应时间</h3>
              <p className="text-blue-700 text-sm">
                我们通常会在1-2个工作日内回复您的邮件。如果是紧急问题，
                请在邮件主题中标注“【紧急】”。
              </p>
            </div>
          </div>

          {/* Contact Form */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">发送消息</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  姓名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  邮箱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                  主题 <span className="text-red-500">*</span>
                </label>
                <select
                  id="subject"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">请选择主题</option>
                  <option value="technical">技术支持</option>
                  <option value="billing">账单问题</option>
                  <option value="feature">功能建议</option>
                  <option value="bug">Bug反馈</option>
                  <option value="other">其他</option>
                </select>
              </div>

              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                  消息内容 <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="message"
                  required
                  rows={5}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请详细描述您的问题或建议..."
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition"
              >
                {loading ? '发送中...' : '发送消息'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
