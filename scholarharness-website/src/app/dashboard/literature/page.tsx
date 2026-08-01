'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import Link from 'next/link';

interface Literature {
  id: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  uploadDate: string;
  fileSize: string;
}

export default function LiteraturePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');

  // 文献全文当前只由桌面端保存在用户本地。云端同步 API 上线前，
  // 这里保持真实空状态，避免用演示数据冒充用户文献。
  const literature: Literature[] = [];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!isAuthenticated()) {
        router.push('/login');
        return;
      }
      setLoading(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  const filteredLiterature = literature.filter(lit =>
    lit.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lit.authors.some(author => author.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">文献管理</h1>
          </div>
          <p className="text-gray-600">管理您的云端文献库</p>
        </div>

        {/* Upload and Search */}
        <div className="bg-white rounded-xl shadow mb-6 p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <input
                  type="text"
                  placeholder="搜索文献标题、作者..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <svg
                  className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <button
              type="button"
              disabled
              title="文献全文当前在桌面端本地管理，云端同步尚未开放"
              className="px-6 py-3 bg-gray-300 text-gray-600 rounded-lg font-medium flex items-center justify-center gap-2 cursor-not-allowed">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              请在桌面端导入
            </button>
          </div>
          
          {/* 文献来源合法性提示 */}
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              ⚠️ <strong>版权合规提示：</strong>请确保您上传的文献来自合法授权渠道（如机构订阅、个人购买等）。不得上传未经授权获取的文献，如盗版数据库下载的文献。
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {['all', 'recent', 'favorites'].map((filter) => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                selectedFilter === filter
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {filter === 'all' ? '全部' : filter === 'recent' ? '最近上传' : '收藏'}
            </button>
          ))}
        </div>

        {/* Literature List */}
        <div className="bg-white rounded-xl shadow">
          <div className="divide-y divide-gray-200">
            {filteredLiterature.map((lit) => (
              <div key={lit.id} className="p-6 hover:bg-gray-50 transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{lit.title}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mb-2">
                      <span>{lit.authors.join(', ')}</span>
                      <span>•</span>
                      <span>{lit.year}</span>
                      <span>•</span>
                      <span>{lit.journal}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>上传于 {lit.uploadDate}</span>
                      <span>•</span>
                      <span>{lit.fileSize}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button className="p-2 text-gray-400 hover:text-blue-600 transition">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>
                    <button className="p-2 text-gray-400 hover:text-red-600 transition">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
                      查看
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredLiterature.length === 0 && (
            <div className="p-12 text-center">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">云端文献同步尚未开放</h3>
              <p className="text-gray-600">请在 Scholar Harness 桌面端导入和管理文献，文件默认保存在您的本地工作目录。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
