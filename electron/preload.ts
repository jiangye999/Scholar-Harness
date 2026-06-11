/**
 * Electron Preload Script
 * 在渲染进程和主进程之间建立安全的通信桥梁
 */

import { contextBridge, ipcRenderer, shell } from 'electron';

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 登录相关
  login: (credentials: { email: string; password: string; beta_code?: string }) => 
    ipcRenderer.invoke('login', credentials),
  
  // 打开外部链接 (通过 IPC 用主进程，更可靠)
  openExternal: (url: string) => 
    ipcRenderer.invoke('open-external', url),
  
  // 监听登录错误
  onLoginError: (callback: (error: string) => void) => {
    ipcRenderer.on('login-error', (_event, error) => callback(error));
  },
  
  // 移除登录错误监听
  removeLoginErrorListener: () => {
    ipcRenderer.removeAllListeners('login-error');
  },
  
  // 检查激活状态
  checkActivation: () => 
    ipcRenderer.invoke('check-activation'),
  
  // 获取设备ID
  getDeviceId: () => 
    ipcRenderer.invoke('get-device-id'),
  
  // 激活完成
  activationComplete: () => 
    ipcRenderer.invoke('activation-complete'),
  
  // === 套餐验证相关（新增）===
  
  // 刷新验证套餐状态
  refreshSubscription: () => 
    ipcRenderer.invoke('refresh-subscription'),
  
  // 套餐验证成功后启动主窗口
  subscriptionValidated: () => 
    ipcRenderer.invoke('subscription-validated'),
  
  // 退出登录
  logout: () => 
    ipcRenderer.invoke('logout'),
  
  // 监听购买原因
  onPurchaseReason: (callback: (reason: string) => void) => {
    ipcRenderer.on('purchase-reason', (_event, reason) => callback(reason));
  },
  
  // === 用户信息相关 ===
  
  // 获取用户信息
  getUserInfo: () => 
    ipcRenderer.invoke('get-user-info'),
  
  // 获取用量统计（用于柱状图）
  getDailyStats: () => 
    ipcRenderer.invoke('get-daily-stats'),
  
  // 获取充值链接
  getPurchaseUrl: (amountCNY: number) => 
    ipcRenderer.invoke('get-purchase-url', amountCNY),
  
  // 打开充值网页
  openPurchasePage: (amountCNY: number) => 
    ipcRenderer.invoke('open-purchase-page', amountCNY),
  
  // 打开用户信息窗口
  openUserInfoWindow: () => 
    ipcRenderer.invoke('open-user-info-window'),
  
  // === R 代码文件保存相关 ===
  
  // 保存文件到桌面
  saveFileToDesktop: (filename: string, content: string) => 
    ipcRenderer.invoke('save-file-to-desktop', filename, content),
  
  // 获取桌面路径
  getDesktopPath: () => 
    ipcRenderer.invoke('get-desktop-path'),
  
  // === 内测码激活（已登录用户）===
  
  // 激活内测码（通过云服务器 API）
  activateBetaCode: (code: string) => 
    ipcRenderer.invoke('activate-beta-code', code),
});

// 类型声明（供 TypeScript 使用）
export interface ElectronAPI {
  login: (credentials: { email: string; password: string; beta_code?: string }) => Promise<{
    success: boolean;
    user?: {
      id: string;
      email: string;
      username?: string;
      avatar_url?: string;
      referral_code?: string;
    };
    error?: string;
    needPurchase?: boolean;
    subscription?: { plan_type: string; status: string; end_date: string };
    trial_info?: {
      success: boolean;
      trial_days?: number;
      access_type?: string;
      message: string;
    };
    referral_trial_info?: {
      success: boolean;
      code?: string;
      trial_days?: number;
      access_type?: string;
      message: string;
      referral_count?: number;
      required_referrals?: number;
      remaining_referrals?: number;
    };
  }>;
  openExternal: (url: string) => Promise<void>;
  onLoginError: (callback: (error: string) => void) => void;
  removeLoginErrorListener: () => void;
  checkActivation: () => Promise<{ valid: boolean; message: string }>;
  getDeviceId: () => Promise<string>;
  activationComplete: () => Promise<{ success: boolean }>;
  // 套餐验证相关
  refreshSubscription: () => Promise<{ valid: boolean; reason?: string; subscription?: any }>;
  subscriptionValidated: () => Promise<{ success: boolean }>;
  logout: () => Promise<{ success: boolean }>;
  onPurchaseReason: (callback: (reason: string) => void) => void;
  // 用户信息
  getUserInfo: () => Promise<{
    user?: {
      id: string;
      email: string;
      username?: string;
      avatar_url?: string;
    };
    subscription?: {
      plan_type: string;
      status: string;
      quota_remaining: number;
      quota_total: number;
    };
    error?: string;
  }>;
  getDailyStats: () => Promise<{
    daily_stats?: Array<{ date: string; word_count: number; file_count: number }>;
    subscription?: {
      plan_type: string;
      quota_remaining: number;
      quota_total: number;
    };
    error?: string;
  }>;
  getPurchaseUrl: (amountCNY: number) => Promise<{
    pay_url?: string;
    credits?: number;
    error?: string;
  }>;
  openPurchasePage: (amountCNY: number) => Promise<{ success: boolean; error?: string }>;
  openUserInfoWindow: () => Promise<{ success: boolean }>;
  // R 代码文件保存
  saveFileToDesktop: (filename: string, content: string) => Promise<{
    success: boolean;
    filepath?: string;
    error?: string;
  }>;
  getDesktopPath: () => Promise<{ path: string }>;
  // 内测码激活
  activateBetaCode: (code: string) => Promise<{
    success: boolean;
    trial_days?: number;
    access_type?: string;
    message?: string;
    reason?: string;
  }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
