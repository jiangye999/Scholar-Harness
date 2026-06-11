'use client';

import { useState } from 'react';
import Link from 'next/link';

const faqs = [
  {
    question: 'ScholarHarness 是什么？',
    answer: 'ScholarHarness 是一个对话式学术论文写作助手，通过两级AI协作帮助研究者更高效地完成学术论文写作。Primary Agent负责规划与质控，Secondary Agent执行写作任务。'
  },
  {
    question: '支持哪些AI模型？',
    answer: '我们支持所有主流AI模型，包括 GPT-4、Claude、通义千问等。您可以使用自己的API Key，也可以通过我们的云端服务按需付费。'
  },
  {
    question: '如何开始使用？',
    answer: '1) 注册账号并登录\n2) 选择合适的套餐\n3) 配置API（或使用云端服务）\n4) 开始对话式写作\n\n详细步骤请查看使用指南。'
  },
  {
    question: '文献引用如何保证真实性？',
    answer: '我们的句子级文献检索系统确保所有引用100%真实。系统会自动验证引用来源，拒绝任何虚构内容。支持WoS和CNKI导出格式。'
  },
  {
    question: '数据安全如何保障？',
    answer: '我们采用端到端加密传输，所有数据存储在安全服务器。您的论文内容不会用于训练AI模型。详见隐私政策。'
  },
  {
    question: '支持哪些操作系统？',
    answer: 'ScholarHarness 支持Windows、macOS和Linux三大平台，提供Electron桌面应用。也可以通过Web浏览器使用云端版本。'
  },
  {
    question: '如何获取技术支持？',
    answer: '您可以通过以下方式获取帮助：\n• 邮箱：sjs@cau.edu.cn\n• GitHub Issues\n• 查看在线文档'
  },
  {
    question: '是否支持团队协作？',
    answer: '目前ScholarHarness主要为个人用户设计。团队协作功能正在开发中，敬请期待。'
  },
  {
    question: '如何升级或降级套餐？',
    answer: '登录后进入个人中心，在订阅管理中可以随时升级或降级套餐。升级后额度立即生效，降级将在当前套餐到期后生效。'
  },
  {
    question: '字数额度如何计算？',
    answer: '字数额度包含所有AI生成的文本内容。每次使用AI功能时，系统会自动扣除相应字数。您可以在使用记录中查看详细统计。'
  }
];

export default function HelpPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">帮助中心</h1>
          <p className="text-gray-600 text-lg">常见问题解答与使用指南</p>
        </div>

        {/* Quick Links */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white rounded-xl shadow p-6 text-center hover:shadow-lg transition">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">使用指南</h3>
            <p className="text-sm text-gray-600">快速上手教程</p>
          </div>

          <div className="bg-white rounded-xl shadow p-6 text-center hover:shadow-lg transition">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">常见问题</h3>
            <p className="text-sm text-gray-600">快速找到答案</p>
          </div>

          <div className="bg-white rounded-xl shadow p-6 text-center hover:shadow-lg transition">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">联系我们</h3>
            <p className="text-sm text-gray-600">获取专业支持</p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="bg-white rounded-xl shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-xl font-bold text-gray-900">常见问题</h2>
          </div>

          <div className="divide-y divide-gray-200">
            {faqs.map((faq, index) => (
              <div key={index}>
                <button
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-50 transition"
                >
                  <span className="font-medium text-gray-900">{faq.question}</span>
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition ${
                      openIndex === index ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openIndex === index && (
                  <div className="px-6 pb-4">
                    <div className="bg-gray-50 rounded-lg p-4 text-gray-700 whitespace-pre-line">
                      {faq.answer}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">还有其他问题？</p>
          <div className="flex justify-center gap-4">
            <Link
              href="/contact"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
            >
              联系我们
            </Link>
            <a
              href="mailto:sjs@cau.edu.cn"
              className="px-6 py-3 border border-gray-300 hover:border-gray-400 text-gray-700 rounded-lg font-medium transition"
            >
              发送邮件
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}