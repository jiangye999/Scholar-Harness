'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, getSubscription, getDailyStats, formatWordCount } from '@/lib/auth';
import type { Subscription, DailyStat } from '@/lib/auth';
import Link from 'next/link';

export default function UsagePage() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        // 获取订阅信息
        const sub = await getSubscription();
        setSubscription(sub);
        
        // 获取每日用量统计
        const stats = await getDailyStats();
        if (stats && stats.daily_stats) {
          setDailyStats(stats.daily_stats);
        }
      } catch (error) {
        console.error('获取数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  // 绘制柱状图
  useEffect(() => {
    if (!chartRef.current || dailyStats.length === 0 || loading) return;
    
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // 清空画布
    ctx.clearRect(0, 0, width, height);
    
    // 计算最大值
    const maxWordCount = Math.max(...dailyStats.map(s => s.word_count), 1000);
    
    // 绘制参数
    const barWidth = 14;
    const gap = 3;
    const chartHeight = height - 30;
    const startX = 20;
    const startY = 10;
    
    // 绘制背景网格线
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = startY + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(width - 10, y);
      ctx.stroke();
    }
    
    // 绘制柱状图
    dailyStats.forEach((stat, index) => {
      const x = startX + index * (barWidth + gap);
      const barHeight = (stat.word_count / maxWordCount) * (chartHeight - 20);
      const y = startY + chartHeight - barHeight;
      
      // 柱子颜色渐变
      const gradient = ctx.createLinearGradient(x, y, x, startY + chartHeight);
      gradient.addColorStop(0, '#667eea');
      gradient.addColorStop(1, '#764ba2');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);
    });
    
    // 绘制日期标签（只显示部分）
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    
    const labelPositions = [0, 7, 14, 21, 29];
    labelPositions.forEach(pos => {
      if (pos < dailyStats.length) {
        const x = startX + pos * (barWidth + gap) + barWidth / 2;
        const date = new Date(dailyStats[pos].date);
        const label = `${date.getMonth() + 1}/${date.getDate()}`;
        ctx.fillText(label, x, height - 5);
      }
    });
  }, [dailyStats, loading]);

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

  // 计算统计数据
  const totalWordsUsed = dailyStats.reduce((sum: number, record: DailyStat) => sum + record.word_count, 0);
  const todayStat = dailyStats.find(s => s.date === new Date().toISOString().split('T')[0]);
  const monthTotal = dailyStats.reduce((sum: number, s: DailyStat) => {
    const date = new Date(s.date);
    if (date.getMonth() === new Date().getMonth()) {
      return sum + s.word_count;
    }
    return sum;
  }, 0);

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
            <h1 className="text-3xl font-bold text-gray-900">使用记录</h1>
          </div>
          <p className="text-gray-600">查看您的历史使用记录</p>
        </div>

        {/* Stats Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-sm text-gray-500">今日</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{formatWordCount(todayStat?.word_count || 0)}</div>
            <div className="text-sm text-gray-600">字数使用</div>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <span className="text-sm text-gray-500">本月</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{formatWordCount(monthTotal)}</div>
            <div className="text-sm text-gray-600">字数使用</div>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-sm text-gray-500">30天</span>
            </div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{formatWordCount(totalWordsUsed)}</div>
            <div className="text-sm text-gray-600">总字数</div>
          </div>
        </div>

        {/* 用量柱状图 */}
        <div className="bg-white rounded-xl shadow mb-6">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">用量趋势（最近30天）</h2>
          </div>
          <div className="p-6">
            {dailyStats.length > 0 ? (
              <canvas 
                ref={chartRef} 
                width={520} 
                height={200}
                className="w-full max-w-lg"
              />
            ) : (
              <div className="text-center py-8 text-gray-500">
                暂无用量数据
              </div>
            )}
          </div>
        </div>

        {/* Time Range Selector */}
        <div className="bg-white rounded-xl shadow mb-6">
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">详细记录</h2>
              <div className="flex gap-2">
                {['daily', 'weekly', 'monthly'].map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range as typeof timeRange)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                      timeRange === range
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {range === 'daily' ? '每日' : range === 'weekly' ? '每周' : '每月'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Usage Table */}
          <div className="overflow-x-auto">
            {dailyStats.length > 0 ? (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">字数使用</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">文件上传</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {dailyStats.slice(-10).reverse().map((record: DailyStat, index: number) => (
                    <tr key={index} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.date}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatWordCount(record.word_count)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{record.file_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500">
                暂无使用记录
              </div>
            )}
          </div>
        </div>

        {/* Subscription Info */}
        {subscription && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">当前套餐</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-blue-700">套餐类型：</span>
                <span className="font-medium text-blue-900 ml-1">{subscription.plan_type}</span>
              </div>
              <div>
                <span className="text-blue-700">有效期至：</span>
                <span className="font-medium text-blue-900 ml-1">{new Date(subscription.end_date).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
